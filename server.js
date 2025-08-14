const express = require('express');
const cors = require('cors');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { createClient } = require('@supabase/supabase-js');
const nodemailer = require('nodemailer');
const cron = require('node-cron');
const ExcelJS = require('exceljs');
const path = require('path');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors());
app.use(express.json());

// Serve static files from build directory
app.use('/texon-inventory-comparison/static', express.static(path.join(__dirname, 'build/static')));

console.log('🚀 Starting Texon Inventory Comparison Server...');

// Global debug logging flag (will be updated from database)
let debugLoggingEnabled = false;

// Global API performance settings (will be updated from database)
let apiTimeoutSeconds = 60;
let maxConcurrentRequests = 5;

// Debug logging helper function
function debugLog(...args) {
    if (debugLoggingEnabled) {
        console.log('🐛 [DEBUG]', ...args);
    }
}

// Function to update performance settings from database
async function updatePerformanceSettings() {
    try {
        const { data: settings, error } = await supabaseService
            .from('app_settings')
            .select('key, value')
            .in('key', ['debug_logging', 'api_timeout_seconds', 'max_concurrent_requests']);

        if (!error && settings) {
            settings.forEach(setting => {
                switch (setting.key) {
                    case 'debug_logging':
                        const newDebugValue = setting.value === 'true';
                        if (debugLoggingEnabled !== newDebugValue) {
                            debugLoggingEnabled = newDebugValue;
                            console.log(`🐛 Debug logging ${debugLoggingEnabled ? 'enabled' : 'disabled'}`);
                        }
                        break;
                    case 'api_timeout_seconds':
                        const newTimeout = parseInt(setting.value) || 60;
                        if (apiTimeoutSeconds !== newTimeout) {
                            apiTimeoutSeconds = newTimeout;
                            console.log(`⏱️ API timeout updated to ${apiTimeoutSeconds} seconds`);
                        }
                        break;
                    case 'max_concurrent_requests':
                        const newMaxConcurrent = parseInt(setting.value) || 5;
                        if (maxConcurrentRequests !== newMaxConcurrent) {
                            maxConcurrentRequests = newMaxConcurrent;
                            console.log(`🚦 Max concurrent requests updated to ${maxConcurrentRequests}`);
                        }
                        break;
                }
            });
        }
    } catch (error) {
        // Silently ignore errors - these settings are not critical
        debugLog('Error updating performance settings:', error);
    }
}

// Alias for backward compatibility
async function updateDebugLoggingSetting() {
    await updatePerformanceSettings();
}

// Helper function for fetch with timeout
async function fetchWithTimeout(url, options = {}) {
    const timeoutMs = (apiTimeoutSeconds || 60) * 1000;
    debugLog(`Making request with ${timeoutMs}ms timeout:`, url);
    
    return Promise.race([
        fetch(url, options),
        new Promise((_, reject) =>
            setTimeout(() => reject(new Error(`Request timeout after ${apiTimeoutSeconds}s`)), timeoutMs)
        )
    ]);
}

// Environment variables validation
const requiredEnvVars = ['SUPABASE_URL', 'SUPABASE_ANON_KEY', 'JWT_SECRET'];
const missingVars = requiredEnvVars.filter(varName => !process.env[varName]);

if (missingVars.length > 0) {
    console.error(`❌ Missing required environment variables: ${missingVars.join(', ')}`);
    console.error('Please check your .env file');
    process.exit(1);
}

// Supabase client
const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_ANON_KEY
);

// Supabase service client (bypasses RLS)
const supabaseService = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY,
    {
        auth: {
            autoRefreshToken: false,
            persistSession: false
        }
    }
);

console.log('✅ Supabase clients initialized');

const JWT_SECRET = process.env.JWT_SECRET;

// Helper functions
async function getUserByUsername(username) {
    const { data, error } = await supabaseService
        .from('app_users')
        .select('*')
        .eq('username', username)
        .single();
    
    if (error) return null;
    return data;
}

// Authentication middleware
const authenticateToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
        return res.status(401).json({ error: 'Access token required' });
    }

    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) {
            return res.status(403).json({ error: 'Invalid or expired token' });
        }
        req.user = user;
        next();
    });
};

// Simple Email Service (without constructor issues)
let emailTransporter = null;

async function initializeEmailService() {
    try {
        if (!process.env.SMTP_HOST || !process.env.SMTP_USER || !process.env.SMTP_PASS) {
            console.warn('⚠️ Email configuration incomplete');
            return;
        }

        emailTransporter = nodemailer.createTransport({
            host: process.env.SMTP_HOST,
            port: parseInt(process.env.SMTP_PORT) || 587,
            secure: process.env.SMTP_SECURE === 'true',
            auth: {
                user: process.env.SMTP_USER,
                pass: process.env.SMTP_PASS
            }
        });

        await emailTransporter.verify();
        console.log('✅ Email service configured successfully');
    } catch (error) {
        console.error('❌ Email service configuration failed:', error.message);
    }
}

// Initialize email service
initializeEmailService();

// Basic API Routes
app.get('/texon-inventory-comparison/api/health', (req, res) => {
    res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

// Authentication routes
// Enhanced login route to include first_name and last_name
app.post('/texon-inventory-comparison/api/auth/login', async (req, res) => {
    try {
        const { username, password } = req.body;
        console.log('🔐 Login attempt for username:', username);

        if (!username || !password) {
            return res.status(400).json({ error: 'Username and password required' });
        }

        // Enhanced user selection to include new fields
        const { data: user, error } = await supabaseService
            .from('app_users')
            .select('*')
            .eq('username', username)
            .single();

        if (error || !user) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }

        // Check if user is active
        if (!user.is_active) {
            return res.status(401).json({ error: 'Account is deactivated' });
        }

        const isValidPassword = await bcrypt.compare(password, user.password_hash);
        if (!isValidPassword) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }

        // Update last login
        await supabaseService
            .from('app_users')
            .update({ last_login: new Date().toISOString() })
            .eq('id', user.id);

        const token = jwt.sign(
            { userId: user.id, username: user.username, role: user.role },
            JWT_SECRET,
            { expiresIn: '24h' }
        );

        res.json({
            token,
            user: {
                id: user.id,
                username: user.username,
                email: user.email,
                first_name: user.first_name,
                last_name: user.last_name,
                role: user.role
            }
        });

    } catch (error) {
        console.error('❌ Login error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

app.get('/texon-inventory-comparison/api/auth/verify', authenticateToken, (req, res) => {
    res.json({ 
        valid: true, 
        user: {
            id: req.user.userId,
            username: req.user.username,
            role: req.user.role
        }
    });
});

// Configuration status
app.get('/texon-inventory-comparison/api/config-status', authenticateToken, (req, res) => {
    const brightpearlConfigured = !!(
        process.env.BRIGHTPEARL_ACCOUNT && 
        process.env.BRIGHTPEARL_APP_REF && 
        process.env.BRIGHTPEARL_TOKEN
    );
    const infoplusConfigured = !!process.env.INFOPLUS_API_KEY;
    const emailConfigured = !!(
        process.env.SMTP_HOST && 
        process.env.SMTP_USER && 
        process.env.SMTP_PASS
    );

    res.json({
        brightpearl_configured: brightpearlConfigured,
        infoplus_configured: infoplusConfigured,
        email_configured: emailConfigured,
        supabase_configured: !!supabase,
        overall_ready: brightpearlConfigured && infoplusConfigured && emailConfigured
    });
});

// Replace the mock inventory comparison in your server.js with this real version:

// Final Corrected BrightpearlAPI Class - Replace in your server.js

class BrightpearlAPI {
    constructor() {
        // CORRECT: Use the public API endpoint
        this.baseUrl = 'https://use1.brightpearlconnect.com/public-api';
        this.account = process.env.BRIGHTPEARL_ACCOUNT;
        this.appRef = process.env.BRIGHTPEARL_APP_REF;
        this.token = process.env.BRIGHTPEARL_TOKEN;
        
        console.log('🔧 Brightpearl API Configuration:');
        console.log(`Base URL: ${this.baseUrl}`);
        console.log(`Account: ${this.account}`);
        console.log(`App Ref: ${this.appRef ? '✅ Set' : '❌ Missing'}`);
        console.log(`Token: ${this.token ? '✅ Set' : '❌ Missing'}`);
    }

    async makeRequest(endpoint, retries = 2) {
        for (let attempt = 1; attempt <= retries + 1; attempt++) {
            try {
                const url = `${this.baseUrl}/${this.account}/${endpoint}`;
                console.log(`🔄 Brightpearl API Request (attempt ${attempt}): ${url}`);
                debugLog('Brightpearl request headers:', {
                    'brightpearl-app-ref': this.appRef,
                    'brightpearl-staff-token': this.token?.substring(0, 8) + '***'
                });
                
                const response = await fetchWithTimeout(url, {
                    headers: {
                        'brightpearl-app-ref': this.appRef,
                        'brightpearl-staff-token': this.token,  // Correct header name
                        'Content-Type': 'application/json'
                    }
                });

                console.log(`📊 Response: ${response.status} ${response.statusText}`);
                console.log(`📈 Rate Limit - Requests Remaining: ${response.headers.get('brightpearl-requests-remaining') || 'N/A'}`);

                if (!response.ok) {
                    const errorText = await response.text();
                    console.error(`❌ Brightpearl API Error: ${errorText}`);
                    
                    // If it's a server error (5xx), retry
                    if (response.status >= 500 && attempt <= retries) {
                        console.log(`⏳ Server error, retrying in ${attempt * 2} seconds...`);
                        await new Promise(resolve => setTimeout(resolve, attempt * 2000));
                        continue;
                    }
                    
                    throw new Error(`Brightpearl API error: ${response.status} ${response.statusText} - ${errorText}`);
                }

                const data = await response.json();
                console.log(`✅ Brightpearl request successful`);
                return data.response || data;
                
            } catch (error) {
                if (attempt <= retries && (error.name === 'TypeError' || error.message.includes('fetch'))) {
                    console.log(`⏳ Network error, retrying in ${attempt * 2} seconds...`);
                    await new Promise(resolve => setTimeout(resolve, attempt * 2000));
                    continue;
                }
                throw error;
            }
        }
    }

    // Final corrected getProducts method for BrightpearlAPI:
    
    async getProducts() {
        try {
            console.log('📊 Fetching Brightpearl products...');
            
            // Use product-search with filter for stock-tracked products with SKUs
            let allProducts = [];
            let page = 1;
            const pageSize = 500;
            let hasMorePages = true;
            
            // Column indices based on the debug output
            const productIdIndex = 0;    // productId
            const productNameIndex = 1;  // productName  
            const skuIndex = 2;          // SKU
            const stockTrackedIndex = 8; // stockTracked
            const brandIdIndex = 14;     // brandId
            
            while (hasMorePages && page <= 10) { // Limit to 10 pages initially
                console.log(`📦 Fetching Brightpearl products page ${page}...`);
                
                const firstResult = (page - 1) * pageSize + 1;
                
                // Filter for stock-tracked products only (these should have SKUs)
                const productsData = await this.makeRequest(
                    `product-service/product-search?pageSize=${pageSize}&firstResult=${firstResult}&filter=stockTracked eq true`
                );
                
                if (productsData && productsData.results && productsData.results.length > 0) {
                    allProducts = allProducts.concat(productsData.results);
                    
                    // Check if there are more pages
                    hasMorePages = productsData.metaData?.morePagesAvailable || false;
                    
                    console.log(`✅ Page ${page}: ${productsData.results.length} products (Total so far: ${allProducts.length})`);
                    page++;
                    
                    // Rate limiting
                    if (hasMorePages) {
                        await new Promise(resolve => setTimeout(resolve, 200));
                    }
                } else {
                    hasMorePages = false;
                }
            }
            
            console.log(`✅ Found ${allProducts.length} stock-tracked Brightpearl products`);
            
            // Process products using the correct column indices
            const products = {};
            let skippedCount = 0;
            
            allProducts.forEach((productArray, index) => {
                const productId = productArray[productIdIndex];
                const sku = productArray[skuIndex];
                const productName = productArray[productNameIndex];
                const stockTracked = productArray[stockTrackedIndex];
                
                // Only include products with actual SKUs
                if (productId && sku && sku.trim() !== '' && stockTracked) {
                    products[productId] = {
                        id: productId,
                        sku: sku.trim(),
                        name: productName || 'Unknown Product',
                        brand: 'Unknown'
                    };
                    
                    // Show first few for debugging
                    if (Object.keys(products).length <= 5) {
                        console.log(`🔍 Product ${Object.keys(products).length}: ID="${productId}", SKU="${sku}", Name="${productName}"`);
                    }
                } else {
                    skippedCount++;
                }
            });
            
            console.log(`✅ Processed ${Object.keys(products).length} Brightpearl products with valid SKUs`);
            console.log(`⚠️ Skipped ${skippedCount} products without SKUs`);
            
            // Show sample of final products
            const sampleSkus = Object.values(products).slice(0, 5).map(p => p.sku);
            console.log('📊 Sample Brightpearl SKUs:', sampleSkus);
            
            return products;
            
        } catch (error) {
            console.error('❌ Error fetching Brightpearl products:', error);
            throw error;
        }
    }

    // Replace the getInventoryLevels method in your BrightpearlAPI class with this CORRECTED version:
    
    async getInventoryLevels(productIds) {
        try {
            console.log('📦 Fetching Brightpearl inventory levels...');
            
            const inventory = {};
            const batchSize = 50; // Smaller batch size for inventory
            const productIdArray = Array.isArray(productIds) ? productIds : Object.keys(productIds);
            
            for (let i = 0; i < productIdArray.length; i += batchSize) {
                const batch = productIdArray.slice(i, i + batchSize);
                const idRange = batch.join(',');
                
                console.log(`📦 Fetching inventory batch ${Math.floor(i/batchSize) + 1}/${Math.ceil(productIdArray.length/batchSize)} (${batch.length} products)`);
                
                try {
                    const inventoryData = await this.makeRequest(`warehouse-service/product-availability/${idRange}`);
                    
                    // IMPORTANT: The response is NOT wrapped in .results - it's the direct data
                    if (inventoryData && typeof inventoryData === 'object') {
                        console.log(`✅ Got inventory data for ${Object.keys(inventoryData).length} products in batch`);
                        
                        Object.entries(inventoryData).forEach(([productId, productInventory]) => {
                            let totalAvailable = 0;
                            
                            // Based on debug output, the structure is:
                            // { "productId": { "total": { "inStock": 183, "onHand": 183, ... }, "warehouses": {...} } }
                            
                            if (productInventory && typeof productInventory === 'object') {
                                if (productInventory.total && typeof productInventory.total === 'object') {
                                    // Use inStock as the primary available quantity
                                    totalAvailable = productInventory.total.inStock || 0;
                                    
                                    // Debug first few items
                                    if (Object.keys(inventory).length < 5) {
                                        console.log(`🔍 Product ${productId}: inStock=${productInventory.total.inStock}, onHand=${productInventory.total.onHand}, allocated=${productInventory.total.allocated}`);
                                    }
                                } else {
                                    // Fallback: if no total object, try to sum warehouse data
                                    if (productInventory.warehouses && typeof productInventory.warehouses === 'object') {
                                        Object.values(productInventory.warehouses).forEach(warehouseStock => {
                                            if (typeof warehouseStock === 'object' && warehouseStock.inStock !== undefined) {
                                                totalAvailable += warehouseStock.inStock || 0;
                                            }
                                        });
                                    }
                                }
                            }
                            
                            inventory[productId] = {
                                available: totalAvailable
                            };
                            
                            // Log some sample results for verification
                            if (Object.keys(inventory).length <= 3) {
                                console.log(`📊 Product ${productId} final available: ${totalAvailable}`);
                            }
                        });
                    } else {
                        console.warn(`⚠️ No inventory data in response for batch ${Math.floor(i/batchSize) + 1}`);
                        console.warn(`⚠️ Response type: ${typeof inventoryData}, Keys: ${inventoryData ? Object.keys(inventoryData) : 'none'}`);
                    }
                } catch (batchError) {
                    console.warn(`⚠️ Failed to fetch inventory for batch ${Math.floor(i/batchSize) + 1}: ${batchError.message}`);
                    // Set zero inventory for this batch to continue processing
                    batch.forEach(productId => {
                        inventory[productId] = { available: 0 };
                    });
                }
                
                // Rate limiting delay
                if (i + batchSize < productIdArray.length) {
                    await new Promise(resolve => setTimeout(resolve, 500));
                }
            }
            
            console.log(`✅ Processed inventory for ${Object.keys(inventory).length} products`);
            
            // Show statistics for verification
            const inventoryValues = Object.values(inventory).map(inv => inv.available);
            const totalStock = inventoryValues.reduce((sum, stock) => sum + stock, 0);
            const itemsWithStock = inventoryValues.filter(stock => stock > 0).length;
            
            console.log(`📊 Brightpearl inventory summary:`);
            console.log(`   - Items processed: ${Object.keys(inventory).length}`);
            console.log(`   - Items with stock > 0: ${itemsWithStock}`);
            console.log(`   - Total stock: ${totalStock}`);
            
            // Show some sample final values
            const sampleEntries = Object.entries(inventory).slice(0, 5);
            console.log(`📦 Sample final inventory:`, sampleEntries.map(([id, data]) => `${id}:${data.available}`).join(', '));
            
            return inventory;
            
        } catch (error) {
            console.error('❌ Error fetching Brightpearl inventory:', error);
            throw error;
        }
    }

    async getInventory() {
        try {
            console.log('🚀 Starting Brightpearl inventory fetch...');
            
            const products = await this.getProducts();
            const productCount = Object.keys(products).length;
            
            if (productCount === 0) {
                console.warn('⚠️ No products found in Brightpearl');
                return {};
            }
            
            console.log(`📊 Found ${productCount} Brightpearl products, fetching inventory...`);
            
            const inventoryLevels = await this.getInventoryLevels(Object.keys(products));
            
            const inventory = {};
            Object.entries(products).forEach(([productId, product]) => {
                const stock = inventoryLevels[productId] || { available: 0 };
                inventory[product.sku] = {
                    sku: product.sku,
                    productName: product.name,
                    brand: product.brand,
                    quantity: stock.available
                };
            });
            
            console.log(`✅ Successfully processed ${Object.keys(inventory).length} Brightpearl inventory items`);
            return inventory;
            
        } catch (error) {
            console.error('❌ Error in Brightpearl getInventory:', error);
            throw error;
        }
    }

    async testConnection() {
        try {
            console.log('🧪 Testing Brightpearl connection...');
            
            // Test with the product search endpoint we know works
            const testData = await this.makeRequest('product-service/product-search?pageSize=1');
            
            if (testData && (testData.results || testData.metaData)) {
                const totalProducts = testData.metaData?.resultsAvailable || 0;
                return { 
                    success: true, 
                    message: `Brightpearl connection successful! Found ${totalProducts} products available.` 
                };
            } else {
                return { 
                    success: false, 
                    message: 'Connected but received unexpected response format' 
                };
            }
            
        } catch (error) {
            console.error('❌ Brightpearl connection test failed:', error.message);
            return { 
                success: false, 
                message: `Connection failed: ${error.message}` 
            };
        }
    }
    
    // Replace the debugCurrentInventoryStructure method in your BrightpearlAPI class with this corrected version:
    
    async debugCurrentInventoryStructure() {
        try {
            console.log('🔍 Debugging current Brightpearl inventory structure...');
            
            // Get test products using the same method as your main code
            const productData = await this.makeRequest('product-service/product-search?pageSize=5&filter=stockTracked eq true');
            
            if (!productData || !productData.results || productData.results.length === 0) {
                console.log('❌ No products found for testing');
                return null;
            }
            
            console.log(`🧪 Found ${productData.results.length} test products`);
            
            // Show the raw structure of the first few products
            console.log('📊 Raw product data structure:');
            productData.results.slice(0, 3).forEach((product, index) => {
                console.log(`Product ${index + 1} (raw array):`, product);
                
                // Based on your getProducts method, extract the data correctly
                const productIdIndex = 0;    // productId
                const productNameIndex = 1;  // productName  
                const skuIndex = 2;          // SKU
                const stockTrackedIndex = 8; // stockTracked
                
                const productId = product[productIdIndex];
                const productName = product[productNameIndex];
                const sku = product[skuIndex];
                const stockTracked = product[stockTrackedIndex];
                
                console.log(`📦 Parsed Product ${index + 1}:`);
                console.log(`   - ID: ${productId}`);
                console.log(`   - Name: ${productName}`);
                console.log(`   - SKU: ${sku}`);
                console.log(`   - Stock Tracked: ${stockTracked}`);
            });
            
            // Test inventory endpoints with the first valid product
            for (let i = 0; i < Math.min(3, productData.results.length); i++) {
                const product = productData.results[i];
                const productId = product[0]; // productId is at index 0
                const sku = product[2];       // SKU is at index 2
                
                // Skip if productId is undefined or null
                if (!productId) {
                    console.log(`⚠️ Skipping product ${i + 1} - no valid product ID`);
                    continue;
                }
                
                console.log(`\n🔍 === Testing Product ID: ${productId}, SKU: ${sku} ===`);
                
                // Test warehouse-service endpoint
                try {
                    const inventoryData = await this.makeRequest(`warehouse-service/product-availability/${productId}`);
                    console.log('📦 Raw warehouse-service response:');
                    console.log(JSON.stringify(inventoryData, null, 2));
                    
                    // Show how your current code would parse this
                    if (inventoryData && inventoryData.results) {
                        const productInventory = inventoryData.results[productId];
                        console.log(`🔍 Product inventory data:`, productInventory);
                        
                        if (typeof productInventory === 'object') {
                            let totalAvailable = 0;
                            Object.values(productInventory).forEach(warehouseStock => {
                                if (typeof warehouseStock === 'object' && warehouseStock.availableStock !== undefined) {
                                    console.log(`   - Warehouse stock:`, warehouseStock);
                                    totalAvailable += warehouseStock.availableStock || 0;
                                }
                            });
                            console.log(`🔍 Calculated total available: ${totalAvailable}`);
                        }
                    }
                } catch (error) {
                    console.log(`❌ warehouse-service failed for ${productId}:`, error.message);
                }
                
                // Test alternative endpoints
                try {
                    const altData = await this.makeRequest(`product-service/product/${productId}/availability`);
                    console.log('📊 Raw product-service/availability response:');
                    console.log(JSON.stringify(altData, null, 2));
                } catch (error) {
                    console.log(`❌ product-service/availability failed for ${productId}:`, error.message);
                }
            }
            
            // Search for the specific SKUs more thoroughly
            console.log('\n🎯 Searching for specific target SKUs...');
            const targetSkus = ['ZIP1519BLK', 'ZIP1519GREY', 'LB1519WCID'];
            
            // Search through more products to find the target SKUs
            for (let page = 1; page <= 5; page++) {
                const firstResult = (page - 1) * 100 + 1;
                console.log(`🔍 Searching page ${page} for target SKUs...`);
                
                try {
                    const searchData = await this.makeRequest(`product-service/product-search?pageSize=100&firstResult=${firstResult}&filter=stockTracked eq true`);
                    
                    if (searchData && searchData.results) {
                        for (const product of searchData.results) {
                            const productId = product[0];
                            const sku = product[2];
                            
                            if (targetSkus.includes(sku)) {
                                console.log(`\n🎯 FOUND TARGET SKU: ${sku} - Product ID: ${productId}`);
                                
                                // Test inventory for this specific SKU
                                try {
                                    const inventoryData = await this.makeRequest(`warehouse-service/product-availability/${productId}`);
                                    console.log(`📦 Inventory data for ${sku}:`, JSON.stringify(inventoryData, null, 2));
                                    
                                    // Parse the inventory data
                                    if (inventoryData && inventoryData.results && inventoryData.results[productId]) {
                                        const productInventory = inventoryData.results[productId];
                                        let totalAvailable = 0;
                                        
                                        if (typeof productInventory === 'object') {
                                            Object.values(productInventory).forEach(warehouseStock => {
                                                if (typeof warehouseStock === 'object' && warehouseStock.availableStock !== undefined) {
                                                    totalAvailable += warehouseStock.availableStock || 0;
                                                }
                                            });
                                        }
                                        
                                        console.log(`🔍 ${sku} calculated stock: ${totalAvailable}`);
                                        
                                        if (totalAvailable === 0) {
                                            console.log(`⚠️ ${sku} shows 0 stock - this explains the issue!`);
                                            console.log(`🔍 Raw inventory structure:`, JSON.stringify(productInventory, null, 2));
                                        }
                                    }
                                } catch (error) {
                                    console.log(`❌ Failed to get inventory for ${sku}:`, error.message);
                                }
                            }
                        }
                    }
                    
                    // Add delay between pages to avoid rate limiting
                    if (page < 5) {
                        await new Promise(resolve => setTimeout(resolve, 300));
                    }
                } catch (error) {
                    console.log(`❌ Search page ${page} failed:`, error.message);
                    break;
                }
            }
            
            return true;
            
        } catch (error) {
            console.error('❌ Debug failed:', error);
            return false;
        }
    }
}

// Replace the InfoplusAPI class with this corrected version using proper pagination:

class InfoplusAPI {
    constructor() {
        this.companyId = process.env.INFOPLUS_COMPANY_ID || 'texon';
        this.baseUrl = `https://${this.companyId}.infopluswms.com/infoplus-wms/api`;
        this.apiKey = process.env.INFOPLUS_API_KEY;
        this.lobId = process.env.INFOPLUS_LOB_ID || 19693;
        this.version = 'beta';
        
        console.log('🔧 Infoplus API Configuration:');
        console.log(`Base URL: ${this.baseUrl}`);
        console.log(`Company ID: ${this.companyId}`);
        console.log(`LOB ID: ${this.lobId}`);
        console.log(`API Key: ${this.apiKey ? '✅ Set' : '❌ Missing'}`);
    }

    async makeRequest(endpoint, options = {}) {
        try {
            const url = `${this.baseUrl}/${this.version}/${endpoint}`;
            console.log(`🔄 Infoplus API Request: ${url}`);
            debugLog('Infoplus request headers:', {
                'API-Key': this.apiKey?.substring(0, 8) + '***'
            });
            
            const response = await fetchWithTimeout(url, {
                headers: {
                    'API-Key': this.apiKey,
                    'Content-Type': 'application/json',
                    'Accept': 'application/json'
                },
                ...options
            });

            console.log(`📊 Infoplus Response: ${response.status} ${response.statusText}`);

            if (!response.ok) {
                const errorText = await response.text();
                console.error(`❌ Infoplus API Error: ${errorText}`);
                throw new Error(`Infoplus API error: ${response.status} ${response.statusText} - ${errorText}`);
            }

            const data = await response.json();
            console.log(`✅ Infoplus request successful - returned ${Array.isArray(data) ? data.length : 'non-array'} items`);
            return data;
            
        } catch (error) {
            console.error('❌ Infoplus API Error:', error);
            throw error;
        }
    }

    async getInventory() {
        try {
            console.log('📊 Fetching Infoplus inventory using correct pagination (page parameter)...');
            
            let allItems = [];
            let page = 1; // Start with page 1 (not 0)
            const limit = 250; // Items per page
            let hasMore = true;
            const maxPages = 100; // Safety limit to prevent infinite loops
            
            while (hasMore && page <= maxPages) {
                console.log(`📦 Fetching Infoplus items page ${page}...`);
                
                // Use correct pagination parameters: limit and page
                const searchParams = new URLSearchParams({
                    limit: limit,
                    page: page // This is the key change - using 'page' instead of 'offset'
                    // No filters to avoid the parsing errors
                });
                
                try {
                    const itemData = await this.makeRequest(
                        `item/search?${searchParams.toString()}`
                    );
                    
                    if (itemData && itemData.length > 0) {
                        // Filter by LOB locally after fetching to avoid filter parsing issues
                        const lobFilteredItems = itemData.filter(item => 
                            item.lobId === this.lobId || item.lobId === parseInt(this.lobId)
                        );
                        
                        allItems = allItems.concat(lobFilteredItems);
                        
                        // Check if we should continue - if we got fewer items than requested, we're done
                        hasMore = itemData.length === limit;
                        
                        console.log(`✅ Page ${page}: ${itemData.length} total items, ${lobFilteredItems.length} for LOB ${this.lobId} (Running total: ${allItems.length})`);
                        
                        // Show first few item IDs to verify pagination is working
                        if (itemData.length > 0) {
                            const firstFewIds = itemData.slice(0, 3).map(item => item.id);
                            console.log(`   📋 Item IDs on this page: ${firstFewIds.join(', ')}...`);
                        }
                        
                        page++;
                        
                        // Rate limiting to be nice to the API
                        if (hasMore) {
                            await new Promise(resolve => setTimeout(resolve, 300));
                        }
                    } else {
                        console.log(`📋 Page ${page}: No items returned - end of data`);
                        hasMore = false;
                    }
                } catch (error) {
                    console.error(`❌ Failed to fetch page ${page}:`, error.message);
                    // Don't stop entirely - try next page in case it was a temporary error
                    if (error.message.includes('filter')) {
                        // If it's a filter error, stop trying
                        hasMore = false;
                    } else {
                        page++;
                        if (page > maxPages) hasMore = false;
                    }
                }
            }
            
            console.log(`✅ Pagination complete: ${allItems.length} total items from ${page - 1} pages`);
            
            // Verify no duplicates by checking unique IDs
            const uniqueIds = new Set(allItems.map(item => item.id));
            console.log(`🔍 Uniqueness check: ${allItems.length} records, ${uniqueIds.size} unique IDs`);
            
            if (allItems.length !== uniqueIds.size) {
                console.warn(`⚠️ Found ${allItems.length - uniqueIds.size} duplicate records - deduplicating...`);
                
                // Deduplicate by ID
                const seenIds = new Set();
                allItems = allItems.filter(item => {
                    if (seenIds.has(item.id)) {
                        return false;
                    }
                    seenIds.add(item.id);
                    return true;
                });
                
                console.log(`✅ After deduplication: ${allItems.length} unique items`);
            }
            
            // Process items into inventory format
            const inventory = {};
            let validSkuCount = 0;
            let invalidSkuCount = 0;
            let zeroQuantityCount = 0;
            let positiveQuantityCount = 0;
            
            allItems.forEach((item, index) => {
                const sku = item.sku;
                
                // Skip records without valid SKUs
                if (!sku || sku.trim() === '') {
                    invalidSkuCount++;
                    return;
                }
                
                const cleanSku = sku.trim();
                const quantity = this.parseQuantity(item.availableQuantity);
                const description = item.itemDescription || 'Unknown Product';
                
                // Track quantity statistics
                if (quantity === 0) {
                    zeroQuantityCount++;
                } else {
                    positiveQuantityCount++;
                }
                
                inventory[cleanSku] = {
                    sku: cleanSku,
                    productName: description,
                    quantity: quantity
                };
                
                validSkuCount++;
                
                // Debug first few items to verify data structure
                if (index < 5) {
                    console.log(`🔍 Item ${index + 1}: ID=${item.id}, SKU="${sku}", LOB=${item.lobId}, AvailableQty=${item.availableQuantity}`);
                }
            });
            
            console.log(`📊 Processing complete:`);
            console.log(`   - Total items processed: ${allItems.length}`);
            console.log(`   - Valid SKUs: ${validSkuCount}`);
            console.log(`   - Invalid/missing SKUs: ${invalidSkuCount}`);
            console.log(`   - SKUs with zero quantity: ${zeroQuantityCount}`);
            console.log(`   - SKUs with positive quantity: ${positiveQuantityCount}`);
            console.log(`   - Final unique SKUs: ${Object.keys(inventory).length}`);
            
            // Show sample of final inventory
            const sampleSkus = Object.keys(inventory).slice(0, 10);
            console.log('📦 Sample final Infoplus SKUs:', sampleSkus);
            
            // Show some statistics
            const quantities = Object.values(inventory).map(item => item.quantity);
            const totalQuantity = quantities.reduce((sum, qty) => sum + qty, 0);
            const nonZeroItems = quantities.filter(qty => qty > 0).length;
            
            console.log(`📊 Final inventory statistics:`);
            console.log(`   - Total quantity across all SKUs: ${totalQuantity}`);
            console.log(`   - SKUs with stock > 0: ${nonZeroItems}`);
            console.log(`   - SKUs with zero stock: ${Object.keys(inventory).length - nonZeroItems}`);
            
            // Check for specific test SKUs
            const testSkus = ['ZIP1519BLK', 'ZIP1519GREY', 'LB1519WCID', '092010S-3-GREY', '092010S-4-GREY'];
            console.log(`🎯 Looking for test SKUs:`);
            testSkus.forEach(testSku => {
                if (inventory[testSku]) {
                    console.log(`   ✅ ${testSku}: ${inventory[testSku].quantity} units`);
                } else {
                    console.log(`   ❌ ${testSku}: not found`);
                }
            });
            
            console.log(`✅ Successfully processed ${Object.keys(inventory).length} unique Infoplus SKUs`);
            return inventory;
            
        } catch (error) {
            console.error('❌ Error fetching Infoplus inventory:', error);
            throw error;
        }
    }

    // Helper method to safely parse quantity values
    parseQuantity(value) {
        if (value === null || value === undefined || value === '') {
            return 0;
        }
        
        const parsed = parseFloat(value);
        return isNaN(parsed) ? 0 : Math.max(0, parsed); // Ensure non-negative
    }

    async testConnection() {
        try {
            console.log('🧪 Testing Infoplus connection...');
            
            // Test with correct pagination parameters
            const testData = await this.makeRequest(`item/search?limit=5&page=1`);
            
            if (testData && Array.isArray(testData)) {
                console.log(`✅ Test successful - received ${testData.length} items`);
                
                if (testData.length > 0) {
                    const testItem = testData[0];
                    console.log(`📦 Sample item: ID=${testItem.id}, SKU="${testItem.sku}", LOB=${testItem.lobId}, Available=${testItem.availableQuantity}`);
                }
                
                return { 
                    success: true, 
                    message: `Infoplus connection successful! Test returned ${testData.length} items.` 
                };
            } else {
                return { 
                    success: false, 
                    message: 'Connected but received unexpected response format' 
                };
            }
            
        } catch (error) {
            console.error('❌ Infoplus connection test failed:', error.message);
            
            if (error.message.includes('401') || error.message.includes('403')) {
                return { 
                    success: false, 
                    message: 'Authentication failed - check API key and permissions' 
                };
            }
            
            return { 
                success: false, 
                message: `Connection failed: ${error.message}` 
            };
        }
    }

    // Test method to verify pagination is working correctly
    async testPagination() {
        try {
            console.log('🔍 Testing Infoplus pagination...');
            
            // Get first page
            const page1 = await this.makeRequest(`item/search?limit=5&page=1`);
            console.log('Page 1 first item ID:', page1[0]?.id);
            console.log('Page 1 last item ID:', page1[page1.length - 1]?.id);
            
            // Get second page
            const page2 = await this.makeRequest(`item/search?limit=5&page=2`);
            console.log('Page 2 first item ID:', page2[0]?.id);
            console.log('Page 2 last item ID:', page2[page2.length - 1]?.id);
            
            // Check if pagination is working
            const page1Ids = new Set(page1.map(item => item.id));
            const page2Ids = new Set(page2.map(item => item.id));
            const hasOverlap = [...page1Ids].some(id => page2Ids.has(id));
            
            if (hasOverlap) {
                console.log('❌ PAGINATION ISSUE - Found overlapping IDs between pages');
                return false;
            } else {
                console.log('✅ Pagination working correctly - no overlapping IDs');
                return true;
            }
            
        } catch (error) {
            console.error('❌ Pagination test failed:', error);
            return false;
        }
    }
}

// Initialize API clients
const brightpearlAPI = new BrightpearlAPI();
const infoplusAPI = new InfoplusAPI();

// Add this SKU normalization function to your server.js file (before the performRealInventoryComparison function):

function normalizeSku(sku) {
    if (!sku || typeof sku !== 'string') {
        return '';
    }
    
    return sku
        .toLowerCase()           // Convert to lowercase (main difference)
        .trim();                 // Remove leading/trailing whitespace
    
    // Keep all separators (-_) and other characters intact
    // This will handle: "2XL-407-SINGLE" ↔ "2xl-407-SINGLE" 
    // But preserve: "QB-TOWELS" vs "QBTowels" as different SKUs
}

// Add this SKU normalization function to your server.js file (before the performRealInventoryComparison function):

function normalizeSku(sku) {
    if (!sku || typeof sku !== 'string') {
        return '';
    }
    
    return sku
        .toLowerCase()           // Convert to lowercase for case-insensitive matching
        .trim();                 // Remove leading/trailing whitespace
}

// Additional function for "loose" matching that removes separators
function normalizeSkuLoose(sku) {
    if (!sku || typeof sku !== 'string') {
        return '';
    }
    
    return sku
        .toLowerCase()           // Convert to lowercase
        .replace(/[-_\s]/g, '')  // Remove hyphens, underscores, and spaces
        .replace(/[^a-z0-9]/g, '') // Remove any other special characters
        .trim();
}

// Helper function to create SKU mapping with both strict and loose normalization
function createNormalizedSkuMap(inventory) {
    const strictMap = new Map();  // Case-insensitive only: "2XL-407-SINGLE" ↔ "2xl-407-SINGLE"
    const looseMap = new Map();   // Also removes separators: "QB-TOWELS" ↔ "QBTowels"
    const skuMap = new Map();     // Maps normalized SKU back to original SKU
    
    Object.entries(inventory).forEach(([originalSku, data]) => {
        const strictNormalized = normalizeSku(originalSku);
        const looseNormalized = normalizeSkuLoose(originalSku);
        
        if (strictNormalized && strictNormalized.length > 0) {
            // Store in strict map (preserves separators)
            if (!strictMap.has(strictNormalized)) {
                strictMap.set(strictNormalized, {
                    ...data,
                    originalSku: originalSku,
                    matchType: 'strict'
                });
                skuMap.set(strictNormalized, originalSku);
            }
            
            // Also store in loose map (removes separators) if different from strict
            if (looseNormalized !== strictNormalized && !looseMap.has(looseNormalized)) {
                looseMap.set(looseNormalized, {
                    ...data,
                    originalSku: originalSku,
                    matchType: 'loose'
                });
                skuMap.set(looseNormalized, originalSku);
            }
        }
    });
    
    return { strictMap, looseMap, skuMap };
}

// Replace your performRealInventoryComparison function with this enhanced version:

async function performRealInventoryComparison() {
    try {
        console.log('🔄 Starting REAL inventory comparison with SKU normalization...');
        
        // Fetch inventory from both systems in parallel
        console.log('📊 Fetching inventory from both systems...');
        const [brightpearlInventory, infoplusInventory] = await Promise.all([
            brightpearlAPI.getInventory(),
            infoplusAPI.getInventory()
        ]);

        console.log(`📊 Brightpearl items: ${Object.keys(brightpearlInventory).length}`);
        console.log(`📊 Infoplus items: ${Object.keys(infoplusInventory).length}`);
        
        // Get ignored SKUs from settings
        let ignoredSkus = [];
        try {
            const { data: ignoredSkusSetting, error: ignoredError } = await supabaseService
                .from('app_settings')
                .select('value')
                .eq('key', 'ignored_skus')
                .single();
            
            if (!ignoredError && ignoredSkusSetting && ignoredSkusSetting.value) {
                ignoredSkus = ignoredSkusSetting.value
                    .split('\n')
                    .map(sku => sku.trim())
                    .filter(sku => sku.length > 0);
                
                if (ignoredSkus.length > 0) {
                    console.log(`🔍 Ignored SKUs loaded: ${ignoredSkus.join(', ')}`);
                }
            }
        } catch (error) {
            console.error('⚠️ Error fetching ignored SKUs:', error);
        }
        
        // Create normalized SKU maps for both systems
        console.log('🔄 Normalizing SKUs for better matching...');
        
        const brightpearlNormalized = createNormalizedSkuMap(brightpearlInventory);
        const infoplusNormalized = createNormalizedSkuMap(infoplusInventory);
        
        console.log(`📊 After normalization:`);
        console.log(`   - Brightpearl: ${Object.keys(brightpearlInventory).length} original SKUs`);
        console.log(`     → ${brightpearlNormalized.strictMap.size} strict normalized, ${brightpearlNormalized.looseMap.size} loose normalized`);
        console.log(`   - Infoplus: ${Object.keys(infoplusInventory).length} original SKUs`);
        console.log(`     → ${infoplusNormalized.strictMap.size} strict normalized, ${infoplusNormalized.looseMap.size} loose normalized`);
        
        // Find matches using a two-tier approach: strict first, then loose
        const processedSkus = new Set();
        const exactMatches = [];
        const brightpearlOnlySkus = [];
        const infoplusOnlySkus = [];
        const discrepancies = [];
        
        // Function to process a match
        const processMatch = (brightpearlItem, infoplusItem, matchType, normalizedSku) => {
            const brightpearlStock = brightpearlItem?.quantity || 0;
            const infoplusStock = infoplusItem?.quantity || 0;
            const difference = brightpearlStock - infoplusStock;
            
            const displaySku = brightpearlItem?.originalSku || infoplusItem?.originalSku || normalizedSku;
            const productName = brightpearlItem?.productName || infoplusItem?.productName || 'Unknown Product';
            
            // Skip if this SKU is in the ignored list
            if (ignoredSkus.includes(displaySku)) {
                console.log(`🚫 Skipping ignored SKU: ${displaySku}`);
                return;
            }
            
            // Mark both original SKUs as processed
            if (brightpearlItem) processedSkus.add(brightpearlItem.originalSku);
            if (infoplusItem) processedSkus.add(infoplusItem.originalSku);
            
            if (brightpearlItem && infoplusItem) {
                if (difference === 0) {
                    exactMatches.push({
                        normalizedSku,
                        displaySku,
                        brightpearlSku: brightpearlItem.originalSku,
                        infoplusSku: infoplusItem.originalSku,
                        quantity: brightpearlStock,
                        matchType
                    });
                } else {
                    const percentageDiff = infoplusStock > 0 
                        ? Math.round((Math.abs(difference) / infoplusStock) * 100 * 10) / 10 
                        : 100;

                    discrepancies.push({
                        sku: displaySku,
                        normalizedSku: normalizedSku,
                        productName: productName,
                        brightpearl_stock: brightpearlStock,
                        infoplus_stock: infoplusStock,
                        difference,
                        percentage_diff: percentageDiff,
                        brand: brightpearlItem?.brand || 'Unknown',
                        brightpearlSku: brightpearlItem?.originalSku,
                        infoplusSku: infoplusItem?.originalSku,
                        matchType
                    });
                }
            }
        };
        
        // First pass: Strict matching (case-insensitive, preserves separators)
        console.log('🔍 Phase 1: Strict matching (case-insensitive only)...');
        const allStrictSkus = new Set([
            ...brightpearlNormalized.strictMap.keys(),
            ...infoplusNormalized.strictMap.keys()
        ]);
        
        let strictMatches = 0;
        allStrictSkus.forEach(strictSku => {
            const brightpearlItem = brightpearlNormalized.strictMap.get(strictSku);
            const infoplusItem = infoplusNormalized.strictMap.get(strictSku);
            
            if (brightpearlItem && infoplusItem) {
                processMatch(brightpearlItem, infoplusItem, 'strict', strictSku);
                strictMatches++;
            }
        });
        
        // Second pass: Loose matching (removes separators) for unmatched SKUs only
        console.log('🔍 Phase 2: Loose matching (removes separators) for remaining SKUs...');
        const allLooseSkus = new Set([
            ...brightpearlNormalized.looseMap.keys(),
            ...infoplusNormalized.looseMap.keys()
        ]);
        
        let looseMatches = 0;
        allLooseSkus.forEach(looseSku => {
            const brightpearlItem = brightpearlNormalized.looseMap.get(looseSku);
            const infoplusItem = infoplusNormalized.looseMap.get(looseSku);
            
            // Only process if both original SKUs haven't been matched yet
            if (brightpearlItem && infoplusItem && 
                !processedSkus.has(brightpearlItem.originalSku) && 
                !processedSkus.has(infoplusItem.originalSku)) {
                processMatch(brightpearlItem, infoplusItem, 'loose', looseSku);
                looseMatches++;
            }
        });
        
        // Third pass: Handle unmatched SKUs
        Object.entries(brightpearlInventory).forEach(([sku, data]) => {
            if (!processedSkus.has(sku)) {
                brightpearlOnlySkus.push({
                    sku: sku,
                    quantity: data.quantity,
                    productName: data.productName
                });
            }
        });
        
        Object.entries(infoplusInventory).forEach(([sku, data]) => {
            if (!processedSkus.has(sku)) {
                infoplusOnlySkus.push({
                    sku: sku,
                    quantity: data.quantity,
                    productName: data.productName
                });
            }
        });

        console.log(`📊 Matching results:`);
        console.log(`   - Strict matches: ${strictMatches} (e.g., "2XL-407-SINGLE" ↔ "2xl-407-SINGLE")`);
        console.log(`   - Loose matches: ${looseMatches} (e.g., "QB-TOWELS" ↔ "QBTowels")`);
        console.log(`   - Total exact matches: ${exactMatches.length}`);
        console.log(`   - Discrepancies: ${discrepancies.length}`);
        console.log(`   - Brightpearl only: ${brightpearlOnlySkus.length}`);
        console.log(`   - Infoplus only: ${infoplusOnlySkus.length}`);
        
        // Sort discrepancies by absolute difference (largest first)
        discrepancies.sort((a, b) => Math.abs(b.difference) - Math.abs(a.difference));
        
        // Show some examples of successful matches
        if (exactMatches.length > 0) {
            console.log('✅ Sample exact matches:');
            exactMatches.slice(0, 3).forEach(match => {
                const matchTypeLabel = match.matchType === 'strict' ? '(case diff)' : '(separator diff)';
                console.log(`   - "${match.brightpearlSku}" ↔ "${match.infoplusSku}" ${matchTypeLabel} (${match.quantity} units)`);
            });
        }
        
        // Show some examples of discrepancies with original SKUs
        if (discrepancies.length > 0) {
            console.log('⚠️ Sample discrepancies:');
            discrepancies.slice(0, 3).forEach(disc => {
                const matchTypeLabel = disc.matchType === 'strict' ? '(case diff)' : '(separator diff)';
                console.log(`   - "${disc.brightpearlSku || disc.sku}" ↔ "${disc.infoplusSku || disc.sku}" ${matchTypeLabel}: BP=${disc.brightpearl_stock}, IP=${disc.infoplus_stock}, Diff=${disc.difference}`);
            });
        }

        const totalMatches = exactMatches.length + discrepancies.length;
        console.log(`✅ Found ${discrepancies.length} discrepancies out of ${totalMatches} matched SKUs`);

        // Save report to database (FIXED - only use existing columns)
        let reportId = null;
        try {
            const reportData = {
                date: new Date().toISOString().split('T')[0],
                total_discrepancies: discrepancies.length,
                discrepancies: JSON.stringify(discrepancies),
                created_at: new Date().toISOString(),
                brightpearl_total_items: Object.keys(brightpearlInventory).length,
                infoplus_total_items: Object.keys(infoplusInventory).length
            };

            const { data, error } = await supabaseService
                .from('inventory_reports')
                .insert([reportData])
                .select()
                .single();

            if (error) {
                console.error('❌ Database save failed:', error);
                console.log('⚠️ Continuing without saving to database...');
            } else {
                reportId = data.id;
                console.log('✅ Report saved to database with ID:', reportId);
            }
        } catch (dbError) {
            console.error('❌ Database save exception:', dbError);
            console.log('⚠️ Continuing without saving to database...');
        }

        // Send email if configured (fetch email settings from database)
        if (emailTransporter) {
            try {
                // Get email settings from database
                const { data: emailSettings, error: emailError } = await supabaseService
                    .from('app_settings')
                    .select('key, value')
                    .in('key', ['email_recipients', 'email_notifications', 'email_on_zero_discrepancies', 'max_discrepancies_in_email']);

                if (emailError) {
                    console.error('❌ Error fetching email settings:', emailError);
                    return;
                }

                // Convert to object
                const settings = {};
                emailSettings.forEach(setting => {
                    if (setting.value === 'true') settings[setting.key] = true;
                    else if (setting.value === 'false') settings[setting.key] = false;
                    else if (!isNaN(setting.value) && setting.value !== '') settings[setting.key] = parseInt(setting.value);
                    else settings[setting.key] = setting.value;
                });

                const emailRecipients = settings.email_recipients;
                const emailNotifications = settings.email_notifications !== false; // Default to true
                const emailOnZeroDiscrepancies = settings.email_on_zero_discrepancies === true;
                const maxDiscrepanciesInEmail = settings.max_discrepancies_in_email || 25;

                // Check if we should send email
                const shouldSendEmail = emailNotifications && emailRecipients && emailRecipients.trim() && 
                                      (discrepancies.length > 0 || emailOnZeroDiscrepancies);
                
                if (shouldSendEmail) {
                    await sendInventoryReportEmail({
                        date: new Date().toISOString().split('T')[0],
                        totalDiscrepancies: discrepancies.length,
                        discrepancies: discrepancies.slice(0, maxDiscrepanciesInEmail), // Limit discrepancies in email
                        brightpearlTotalItems: Object.keys(brightpearlInventory).length,
                        infoplusTotalItems: Object.keys(infoplusInventory).length
                    }, emailRecipients);
                    
                    const discrepancyMsg = discrepancies.length > maxDiscrepanciesInEmail ? 
                        `${maxDiscrepanciesInEmail} of ${discrepancies.length} discrepancies` : 
                        `${discrepancies.length} discrepancies`;
                    
                    console.log(`✅ Email report sent successfully to: ${emailRecipients} (${discrepancyMsg})`);
                } else if (!emailNotifications) {
                    console.log('📧 Email notifications disabled in settings');
                } else if (!emailRecipients) {
                    console.log('⚠️ No email recipients configured in settings');
                } else if (discrepancies.length === 0 && !emailOnZeroDiscrepancies) {
                    console.log('📧 Skipping email - no discrepancies and zero-discrepancy emails disabled');
                }
            } catch (emailError) {
                console.error('❌ Failed to send email report:', emailError);
            }
        } else {
            console.log('⚠️ Email service not configured');
        }

        // Return success response even if database save failed
        return {
            success: true,
            totalDiscrepancies: discrepancies.length,
            discrepancies: discrepancies.slice(0, 50), // Limit response size
            exactMatches: exactMatches.length,
            strictMatches: strictMatches,
            looseMatches: looseMatches,
            brightpearlOnly: brightpearlOnlySkus.length,
            infoplusOnly: infoplusOnlySkus.length,
            message: `Inventory comparison completed successfully! ${strictMatches} strict + ${looseMatches} loose matches found. Only ${discrepancies.length} real discrepancies need attention.`,
            reportId: reportId,
            brightpearlItems: Object.keys(brightpearlInventory).length,
            infoplusItems: Object.keys(infoplusInventory).length,
            totalMatches: totalMatches,
            timestamp: new Date().toISOString()
        };

    } catch (error) {
        console.error('❌ Real inventory comparison failed:', error);
        throw error;
    }
}

// Helper function to generate Excel report buffer
async function generateExcelReportBuffer(reportData) {
    const { discrepancies, totalDiscrepancies, date, brightpearlTotalItems, infoplusTotalItems } = reportData;
    
    // Create Excel workbook
    const workbook = new ExcelJS.Workbook();
    
    // Report Summary Sheet
    const summarySheet = workbook.addWorksheet('Report Summary');
    
    // Add summary header
    summarySheet.addRow(['Texon Inventory Comparison Report']);
    summarySheet.addRow([]);
    summarySheet.addRow(['Report Date:', date]);
    summarySheet.addRow(['Generated:', new Date().toLocaleString()]);
    summarySheet.addRow(['Total Discrepancies:', totalDiscrepancies]);
    summarySheet.addRow(['Brightpearl Items:', brightpearlTotalItems || 'N/A']);
    summarySheet.addRow(['Infoplus Items:', infoplusTotalItems || 'N/A']);
    summarySheet.addRow([]);
    
    // Style the summary header
    summarySheet.getCell('A1').font = { bold: true, size: 16 };
    summarySheet.getCell('A1').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE6F3FF' } };
    
    // Make summary labels bold
    for (let row = 3; row <= 7; row++) {
        summarySheet.getCell(`A${row}`).font = { bold: true };
    }
    
    // Discrepancies Sheet
    const discrepanciesSheet = workbook.addWorksheet('Discrepancies');
    
    // Add discrepancies header
    const headerRow = discrepanciesSheet.addRow([
        'SKU',
        'Product Name',
        'Brightpearl Stock',
        'Infoplus Stock', 
        'Difference',
        'Percentage Difference',
        'Brand',
        'Match Type'
    ]);
    
    // Style header row
    headerRow.eachCell((cell) => {
        cell.font = { bold: true };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD9EDF7' } };
        cell.border = {
            top: { style: 'thin' },
            left: { style: 'thin' },
            bottom: { style: 'thin' },
            right: { style: 'thin' }
        };
    });
    
    // Add discrepancy data
    discrepancies.forEach((item, index) => {
        const row = discrepanciesSheet.addRow([
            item.sku || '',
            item.productName || 'N/A',
            item.brightpearl_stock || 0,
            item.infoplus_stock || 0,
            item.difference || 0,
            item.percentage_diff ? `${item.percentage_diff}%` : 'N/A',
            item.brand || 'Unknown',
            item.matchType || item.match_type || 'N/A'
        ]);
        
        // Color code the difference column
        const diffCell = row.getCell(5);
        if (item.difference > 0) {
            diffCell.font = { color: { argb: 'FF006400' } }; // Green for positive
        } else if (item.difference < 0) {
            diffCell.font = { color: { argb: 'FFDC143C' } }; // Red for negative
        }
        
        // Add borders
        row.eachCell((cell) => {
            cell.border = {
                top: { style: 'thin' },
                left: { style: 'thin' },
                bottom: { style: 'thin' },
                right: { style: 'thin' }
            };
        });
        
        // Alternate row colors
        if (index % 2 === 0) {
            row.eachCell((cell) => {
                cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF8F9FA' } };
            });
        }
    });
    
    // Auto-fit columns
    discrepanciesSheet.columns = [
        { width: 20 }, // SKU
        { width: 40 }, // Product Name
        { width: 15 }, // Brightpearl Stock
        { width: 15 }, // Infoplus Stock
        { width: 12 }, // Difference
        { width: 18 }, // Percentage Difference
        { width: 15 }, // Brand
        { width: 12 }  // Match Type
    ];
    
    summarySheet.columns = [
        { width: 25 },
        { width: 20 }
    ];
    
    // If there are no discrepancies, add a note
    if (discrepancies.length === 0) {
        discrepanciesSheet.addRow([]);
        const noDiscrepanciesRow = discrepanciesSheet.addRow(['No discrepancies found - all inventory matches!']);
        noDiscrepanciesRow.getCell(1).font = { bold: true, color: { argb: 'FF006400' } };
    }

    // Add statistics sheet if there are discrepancies
    if (discrepancies.length > 0) {
        const statsSheet = workbook.addWorksheet('Statistics');
        
        // Calculate statistics
        const totalAbsDiff = discrepancies.reduce((sum, item) => sum + Math.abs(item.difference || 0), 0);
        const avgAbsDiff = totalAbsDiff / discrepancies.length;
        const maxDiff = Math.max(...discrepancies.map(item => Math.abs(item.difference || 0)));
        const positiveDiscrepancies = discrepancies.filter(item => (item.difference || 0) > 0).length;
        const negativeDiscrepancies = discrepancies.filter(item => (item.difference || 0) < 0).length;
        
        statsSheet.addRow(['Inventory Discrepancy Statistics']);
        statsSheet.addRow([]);
        statsSheet.addRow(['Total Discrepancies:', discrepancies.length]);
        statsSheet.addRow(['Positive Discrepancies (Brightpearl > Infoplus):', positiveDiscrepancies]);
        statsSheet.addRow(['Negative Discrepancies (Infoplus > Brightpearl):', negativeDiscrepancies]);
        statsSheet.addRow(['Total Absolute Difference:', totalAbsDiff]);
        statsSheet.addRow(['Average Absolute Difference:', Math.round(avgAbsDiff * 100) / 100]);
        statsSheet.addRow(['Largest Absolute Difference:', maxDiff]);
        
        // Style statistics
        statsSheet.getCell('A1').font = { bold: true, size: 14 };
        for (let row = 3; row <= 8; row++) {
            statsSheet.getCell(`A${row}`).font = { bold: true };
        }
        
        statsSheet.columns = [{ width: 35 }, { width: 20 }];
    }
    
    // Generate buffer
    const buffer = await workbook.xlsx.writeBuffer();
    return buffer;
}

// Email function with Excel attachment
async function sendInventoryReportEmail(reportData, recipients) {
    if (!emailTransporter) {
        throw new Error('Email service not configured');
    }

    try {
        const { discrepancies, totalDiscrepancies, date } = reportData;
        
        const subject = `Texon Inventory Comparison Report - ${date} (${totalDiscrepancies} discrepancies)`;
        
        let htmlContent = `
            <h2>Texon Inventory Comparison Report</h2>
            <p><strong>Date:</strong> ${date}</p>
            <p><strong>Total Discrepancies:</strong> ${totalDiscrepancies}</p>
            
            ${totalDiscrepancies > 0 ? `
            <h3>Top Discrepancies:</h3>
            <table border="1" cellpadding="8" cellspacing="0" style="border-collapse: collapse;">
                <thead>
                    <tr style="background-color: #f0f0f0;">
                        <th>SKU</th>
                        <th>Product Name</th>
                        <th>Brightpearl Stock</th>
                        <th>Infoplus Stock</th>
                        <th>Difference</th>
                    </tr>
                </thead>
                <tbody>
                    ${discrepancies.slice(0, 20).map(item => `
                        <tr>
                            <td><strong>${item.sku}</strong></td>
                            <td>${item.productName || 'N/A'}</td>
                            <td style="text-align: right;">${item.brightpearl_stock}</td>
                            <td style="text-align: right;">${item.infoplus_stock}</td>
                            <td style="text-align: right; color: ${item.difference < 0 ? 'red' : 'green'};">
                                ${item.difference > 0 ? '+' : ''}${item.difference}
                            </td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
            ` : '<p style="color: green;"><strong>✅ No discrepancies found!</strong></p>'}
            
            <p><strong>📎 Complete report attached as Excel file</strong></p>
            <p><em>Automated report from Texon Inventory Comparison system.</em></p>
        `;

        // Generate Excel attachment
        const excelBuffer = await generateExcelReportBuffer(reportData);
        const filename = `inventory-report-${date}.xlsx`;

        const mailOptions = {
            from: process.env.SMTP_FROM || process.env.SMTP_USER,
            to: recipients,
            subject: subject,
            html: htmlContent,
            attachments: [
                {
                    filename: filename,
                    content: excelBuffer,
                    contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
                }
            ]
        };

        const result = await emailTransporter.sendMail(mailOptions);
        return result;
    } catch (error) {
        console.error('❌ Failed to send email:', error);
        throw error;
    }
}

// Welcome email function
async function sendWelcomeEmail(user, temporaryPassword) {
    if (!emailTransporter) {
        throw new Error('Email service not configured');
    }

    try {
        const subject = 'Welcome to Texon Inventory Comparison System';
        
        const htmlContent = `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
                <h2 style="color: #333;">Welcome to Texon Inventory Comparison!</h2>
                
                <p>Hello ${user.first_name} ${user.last_name},</p>
                
                <p>Your account has been created for the Texon Inventory Comparison system. Here are your login credentials:</p>
                
                <div style="background: #f8f9fa; padding: 20px; border-radius: 8px; margin: 20px 0;">
                    <p><strong>Username:</strong> ${user.username}</p>
                    <p><strong>Email:</strong> ${user.email}</p>
                    <p><strong>Temporary Password:</strong> ${temporaryPassword}</p>
                    <p><strong>Role:</strong> ${user.role}</p>
                </div>
                
                <p><strong>Important Security Notice:</strong></p>
                <ul>
                    <li>Please change your password after your first login</li>
                    <li>Keep your login credentials secure</li>
                    <li>Do not share your account with others</li>
                </ul>
                
                <p>You can access the system at: <a href="https://collegesportsdirectory.com/texon-inventory-comparison">Texon Inventory Comparison</a></p>
                
                <p>If you have any questions or need assistance, please contact your system administrator.</p>
                
                <p>Best regards,<br>Texon Inventory Management Team</p>
                
                <hr style="margin: 30px 0; border: none; border-top: 1px solid #eee;">
                <p style="font-size: 12px; color: #666;">
                    This is an automated message. Please do not reply to this email.
                </p>
            </div>
        `;

        const mailOptions = {
            from: process.env.SMTP_FROM || process.env.SMTP_USER,
            to: user.email,
            subject: subject,
            html: htmlContent
        };

        const result = await emailTransporter.sendMail(mailOptions);
        return result;
    } catch (error) {
        console.error('❌ Failed to send welcome email:', error);
        throw error;
    }
}

// Helper functions
function isValidCronExpression(cron) {
    // Basic cron validation - checks for 5 parts separated by spaces
    const parts = cron.trim().split(/\s+/);
    if (parts.length !== 5) return false;
    
    // More thorough validation could be added here
    const validExpressions = [
        '0 9 * * *', '0 12 * * *', '0 17 * * *', '0 18 * * *', 
        '0 19 * * *', '0 20 * * *', '0 19 * * 1-5', '0 19 * * 0'
    ];
    
    return validExpressions.includes(cron);
}

function isValidEmail(email) {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
}

// Cron job management
let currentCronJob = null;

// Report cleanup function
async function cleanupOldReports() {
    try {
        console.log('🧹 Starting report cleanup process...');
        
        // Get cleanup settings from database
        const { data: cleanupSettings, error } = await supabaseService
            .from('app_settings')
            .select('key, value')
            .in('key', ['auto_cleanup_enabled', 'report_retention_days']);

        if (error) {
            console.error('❌ Error fetching cleanup settings:', error);
            return;
        }

        // Convert to object
        const settings = {};
        cleanupSettings.forEach(setting => {
            if (setting.value === 'true') settings[setting.key] = true;
            else if (setting.value === 'false') settings[setting.key] = false;
            else if (!isNaN(setting.value) && setting.value !== '') settings[setting.key] = parseInt(setting.value);
            else settings[setting.key] = setting.value;
        });

        const autoCleanupEnabled = settings.auto_cleanup_enabled === true;
        const retentionDays = settings.report_retention_days || 30;

        if (!autoCleanupEnabled) {
            console.log('🧹 Auto cleanup disabled');
            return;
        }

        // Calculate cutoff date
        const cutoffDate = new Date();
        cutoffDate.setDate(cutoffDate.getDate() - retentionDays);
        const cutoffISOString = cutoffDate.toISOString();

        console.log(`🧹 Cleaning reports older than ${retentionDays} days (before ${cutoffDate.toDateString()})`);

        // First, count how many reports we have total
        const { count: totalReports, error: countError } = await supabaseService
            .from('inventory_reports')
            .select('*', { count: 'exact', head: true });

        if (countError) {
            console.error('❌ Error counting reports:', countError);
            return;
        }

        // Get reports to delete (but keep at least the most recent one)
        const { data: reportsToDelete, error: fetchError } = await supabaseService
            .from('inventory_reports')
            .select('id, date, created_at')
            .lt('created_at', cutoffISOString)
            .order('created_at', { ascending: false });

        if (fetchError) {
            console.error('❌ Error fetching old reports:', fetchError);
            return;
        }

        // Only delete if we have more than 1 report total (keep at least the most recent)
        if (totalReports <= 1) {
            console.log('🧹 Skipping cleanup - keeping at least one report');
            return;
        }

        // Keep at least 1 report, so only delete if we would have reports remaining
        const reportsToKeep = totalReports - reportsToDelete.length;
        if (reportsToKeep < 1) {
            // Only delete some of the old reports to keep at least 1
            const deleteCount = reportsToDelete.length - 1;
            reportsToDelete.splice(deleteCount);
            console.log(`🧹 Modified cleanup to keep at least 1 report (deleting ${deleteCount} instead of ${reportsToDelete.length})`);
        }

        if (reportsToDelete.length === 0) {
            console.log('🧹 No old reports to cleanup');
            return;
        }

        // Delete old reports
        const reportIds = reportsToDelete.map(r => r.id);
        const { error: deleteError } = await supabaseService
            .from('inventory_reports')
            .delete()
            .in('id', reportIds);

        if (deleteError) {
            console.error('❌ Error deleting old reports:', deleteError);
            return;
        }

        console.log(`✅ Cleanup completed: deleted ${reportsToDelete.length} old reports`);
        
    } catch (error) {
        console.error('❌ Error during report cleanup:', error);
    }
}

function updateCronJob(enabled, schedule, timezone) {
    try {
        // Stop existing cron job
        if (currentCronJob) {
            currentCronJob.destroy();
            currentCronJob = null;
            console.log('🔄 Stopped existing cron job');
        }

        // Start new cron job if enabled
        if (enabled && schedule) {
            currentCronJob = cron.schedule(schedule, async () => {
                console.log('⏰ Running scheduled inventory comparison...');
                try {
                    await performRealInventoryComparison();
                    console.log('✅ Scheduled comparison completed successfully');
                    
                    // Run cleanup after successful comparison
                    await cleanupOldReports();
                } catch (error) {
                    console.error('❌ Scheduled comparison failed:', error);
                }
            }, {
                scheduled: true,
                timezone: timezone || 'America/New_York'
            });

            console.log(`✅ Cron job scheduled: ${schedule} (${timezone || 'America/New_York'})`);
        } else {
            console.log('⏸️ Cron job disabled');
        }
    } catch (error) {
        console.error('❌ Error updating cron job:', error);
    }
}

// Initialize cron job on server start
async function initializeCronJob() {
    try {
        const { data: settings, error } = await supabaseService
            .from('app_settings')
            .select('*')
            .in('key', ['cron_enabled', 'cron_schedule', 'cron_timezone']);

        if (error) {
            console.log('⚠️ Could not load cron settings from database');
            return;
        }

        const settingsObj = {};
        settings.forEach(setting => {
            settingsObj[setting.key] = setting.value === 'true' ? true : setting.value;
        });

        if (settingsObj.cron_enabled === true && settingsObj.cron_schedule) {
            updateCronJob(true, settingsObj.cron_schedule, settingsObj.cron_timezone);
        }
    } catch (error) {
        console.log('⚠️ Error initializing cron job:', error);
    }
}

// Initialize performance settings and cron job after database connection
async function initializeAppFeatures() {
    await updatePerformanceSettings();
    initializeCronJob();
}

// Call this after supabase client is ready
initializeAppFeatures();

app.post('/texon-inventory-comparison/api/run-comparison', authenticateToken, async (req, res) => {
    try {
        console.log('🔄 Starting manual inventory comparison...');
        const result = await performRealInventoryComparison();
        
        console.log('✅ Comparison completed successfully');
        res.json(result);
        
    } catch (error) {
        console.error('❌ Manual comparison failed:', error);
        
        // Always return JSON, never let Express return HTML error pages
        res.status(500).json({ 
            success: false,
            error: error.message || 'Unknown error occurred',
            details: error.code || 'INTERNAL_ERROR',
            timestamp: new Date().toISOString(),
            message: 'Inventory comparison failed. Please check the server logs for details.'
        });
    }
});

// UPDATE the test endpoint to test real APIs:
app.get('/texon-inventory-comparison/api/test', authenticateToken, async (req, res) => {
    try {
        const brightpearlTest = await brightpearlAPI.testConnection();
        const infoplusTest = await infoplusAPI.testConnection();
        
        res.json({
            message: 'API test completed',
            brightpearl: brightpearlTest,
            infoplus: infoplusTest,
            user: req.user,
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Enable the scheduled comparison (uncomment this when ready):
// cron.schedule('0 19 * * *', async () => {
//     console.log('⏰ Running scheduled inventory comparison...');
//     try {
//         await performRealInventoryComparison();
//     } catch (error) {
//         console.error('❌ Scheduled comparison failed:', error);
//     }
// }, {
//     timezone: "America/New_York"
// });

// Reports routes
app.get('/texon-inventory-comparison/api/reports', authenticateToken, async (req, res) => {
    try {
        const { data, error } = await supabaseService
            .from('inventory_reports')
            .select('*')
            .order('created_at', { ascending: false })
            .limit(30);

        if (error) throw error;

        const reports = data.map(report => ({
            ...report,
            discrepancies: JSON.parse(report.discrepancies || '[]')
        }));

        res.json(reports);
    } catch (error) {
        console.error('❌ Reports fetch error:', error);
        res.json([]);
    }
});

// Get latest report
app.get('/texon-inventory-comparison/api/latest-report', authenticateToken, async (req, res) => {
    try {
        const { data, error } = await supabaseService
            .from('inventory_reports')
            .select('*')
            .order('created_at', { ascending: false })
            .limit(1);

        if (error) throw error;

        if (data && data.length > 0) {
            const report = {
                ...data[0],
                discrepancies: JSON.parse(data[0].discrepancies || '[]')
            };
            res.json(report);
        } else {
            res.json(null);
        }
    } catch (error) {
        console.error('❌ Latest report fetch error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Add this new route to your server.js file (after your existing reports routes):

// Excel download route for reports
app.get('/texon-inventory-comparison/api/reports/:reportId/excel', authenticateToken, async (req, res) => {
    try {
        const { reportId } = req.params;
        
        console.log(`📊 Generating Excel report for ID: ${reportId}`);
        
        // Get the report from database
        const { data: report, error } = await supabaseService
            .from('inventory_reports')
            .select('*')
            .eq('id', reportId)
            .single();

        if (error || !report) {
            console.error('❌ Report not found:', error);
            return res.status(404).json({ error: 'Report not found' });
        }

        // Parse discrepancies
        let discrepancies = [];
        try {
            if (report.discrepancies) {
                if (typeof report.discrepancies === 'string') {
                    discrepancies = JSON.parse(report.discrepancies);
                } else if (Array.isArray(report.discrepancies)) {
                    discrepancies = report.discrepancies;
                }
            }
        } catch (parseError) {
            console.error('❌ Error parsing discrepancies:', parseError);
            return res.status(400).json({ error: 'Invalid report data' });
        }

        // Create Excel workbook
        const workbook = new ExcelJS.Workbook();
        
        // Report Summary Sheet
        const summarySheet = workbook.addWorksheet('Report Summary');
        
        // Add summary header
        summarySheet.addRow(['Texon Inventory Comparison Report']);
        summarySheet.addRow([]);
        summarySheet.addRow(['Report Date:', report.date]);
        summarySheet.addRow(['Generated:', new Date(report.created_at).toLocaleString()]);
        summarySheet.addRow(['Total Discrepancies:', report.total_discrepancies]);
        summarySheet.addRow(['Brightpearl Items:', report.brightpearl_total_items]);
        summarySheet.addRow(['Infoplus Items:', report.infoplus_total_items]);
        summarySheet.addRow([]);
        
        // Style the summary header
        summarySheet.getCell('A1').font = { bold: true, size: 16 };
        summarySheet.getCell('A1').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE6F3FF' } };
        
        // Make summary labels bold
        for (let row = 3; row <= 7; row++) {
            summarySheet.getCell(`A${row}`).font = { bold: true };
        }

        // Discrepancies Sheet
        const discrepanciesSheet = workbook.addWorksheet('Discrepancies');
        
        // Add discrepancies header
        const headerRow = discrepanciesSheet.addRow([
            'SKU',
            'Product Name',
            'Brightpearl Stock',
            'Infoplus Stock', 
            'Difference',
            'Percentage Difference',
            'Brand',
            'Match Type'
        ]);
        
        // Style header row
        headerRow.eachCell((cell) => {
            cell.font = { bold: true };
            cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD9EDF7' } };
            cell.border = {
                top: { style: 'thin' },
                left: { style: 'thin' },
                bottom: { style: 'thin' },
                right: { style: 'thin' }
            };
        });

        // Add discrepancy data
        discrepancies.forEach((item, index) => {
            const row = discrepanciesSheet.addRow([
                item.sku || '',
                item.productName || 'N/A',
                item.brightpearl_stock || 0,
                item.infoplus_stock || 0,
                item.difference || 0,
                item.percentage_diff ? `${item.percentage_diff}%` : 'N/A',
                item.brand || 'Unknown',
                item.matchType || item.match_type || 'N/A'
            ]);
            
            // Color code the difference column
            const diffCell = row.getCell(5);
            if (item.difference > 0) {
                diffCell.font = { color: { argb: 'FF006400' } }; // Green for positive
            } else if (item.difference < 0) {
                diffCell.font = { color: { argb: 'FFDC143C' } }; // Red for negative
            }
            
            // Add borders
            row.eachCell((cell) => {
                cell.border = {
                    top: { style: 'thin' },
                    left: { style: 'thin' },
                    bottom: { style: 'thin' },
                    right: { style: 'thin' }
                };
            });
            
            // Alternate row colors
            if (index % 2 === 0) {
                row.eachCell((cell) => {
                    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF8F9FA' } };
                });
            }
        });

        // Auto-fit columns
        discrepanciesSheet.columns = [
            { width: 20 }, // SKU
            { width: 40 }, // Product Name
            { width: 15 }, // Brightpearl Stock
            { width: 15 }, // Infoplus Stock
            { width: 12 }, // Difference
            { width: 18 }, // Percentage Difference
            { width: 15 }, // Brand
            { width: 12 }  // Match Type
        ];

        summarySheet.columns = [
            { width: 25 },
            { width: 20 }
        ];

        // If there are no discrepancies, add a note
        if (discrepancies.length === 0) {
            discrepanciesSheet.addRow([]);
            const noDiscrepanciesRow = discrepanciesSheet.addRow(['No discrepancies found - all inventory matches!']);
            noDiscrepanciesRow.getCell(1).font = { bold: true, color: { argb: 'FF006400' } };
        }

        // Add statistics sheet if there are discrepancies
        if (discrepancies.length > 0) {
            const statsSheet = workbook.addWorksheet('Statistics');
            
            // Calculate statistics
            const totalAbsDiff = discrepancies.reduce((sum, item) => sum + Math.abs(item.difference || 0), 0);
            const avgAbsDiff = totalAbsDiff / discrepancies.length;
            const maxDiff = Math.max(...discrepancies.map(item => Math.abs(item.difference || 0)));
            const positiveDiscrepancies = discrepancies.filter(item => (item.difference || 0) > 0).length;
            const negativeDiscrepancies = discrepancies.filter(item => (item.difference || 0) < 0).length;
            
            statsSheet.addRow(['Inventory Discrepancy Statistics']);
            statsSheet.addRow([]);
            statsSheet.addRow(['Total Discrepancies:', discrepancies.length]);
            statsSheet.addRow(['Positive Discrepancies (Brightpearl > Infoplus):', positiveDiscrepancies]);
            statsSheet.addRow(['Negative Discrepancies (Infoplus > Brightpearl):', negativeDiscrepancies]);
            statsSheet.addRow(['Total Absolute Difference:', totalAbsDiff]);
            statsSheet.addRow(['Average Absolute Difference:', Math.round(avgAbsDiff * 100) / 100]);
            statsSheet.addRow(['Largest Absolute Difference:', maxDiff]);
            
            // Style statistics
            statsSheet.getCell('A1').font = { bold: true, size: 14 };
            for (let row = 3; row <= 8; row++) {
                statsSheet.getCell(`A${row}`).font = { bold: true };
            }
            
            statsSheet.columns = [{ width: 35 }, { width: 20 }];
        }

        // Set response headers for Excel download
        const filename = `inventory-report-${report.date}-${reportId}.xlsx`;
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

        // Write workbook to response
        await workbook.xlsx.write(res);
        res.end();
        
        console.log(`✅ Excel report generated successfully: ${filename}`);

    } catch (error) {
        console.error('❌ Error generating Excel report:', error);
        res.status(500).json({ 
            error: 'Failed to generate Excel report',
            details: error.message 
        });
    }
});

// Delete a specific report by ID (Admin only)
app.delete('/texon-inventory-comparison/api/reports/:reportId', authenticateToken, async (req, res) => {
    try {
        // Check if user is admin
        if (req.user.role !== 'admin') {
            return res.status(403).json({
                success: false,
                error: 'Admin access required to delete reports'
            });
        }

        const { reportId } = req.params;
        
        console.log(`🗑️ Admin ${req.user.username} deleting report ID: ${reportId}`);

        // Check if report exists
        const { data: report, error: fetchError } = await supabaseService
            .from('inventory_reports')
            .select('id, date, created_at, total_discrepancies')
            .eq('id', reportId)
            .single();

        if (fetchError) {
            if (fetchError.code === 'PGRST116') {
                return res.status(404).json({
                    success: false,
                    error: 'Report not found'
                });
            }
            throw fetchError;
        }

        // Delete the report
        const { error: deleteError } = await supabaseService
            .from('inventory_reports')
            .delete()
            .eq('id', reportId);

        if (deleteError) throw deleteError;

        console.log(`✅ Successfully deleted report ${reportId} from ${report.date}`);

        res.json({
            success: true,
            message: `Successfully deleted report from ${report.date}`,
            deleted_report: {
                id: reportId,
                date: report.date,
                created_at: report.created_at,
                total_discrepancies: report.total_discrepancies
            }
        });

    } catch (error) {
        console.error('❌ Error deleting report:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Enhanced Settings routes with full CRUD functionality

// Get all settings
app.get('/texon-inventory-comparison/api/settings', authenticateToken, async (req, res) => {
    if (req.user.role !== 'admin') {
        return res.status(403).json({ error: 'Admin access required' });
    }

    try {
        const { data, error } = await supabaseService
            .from('app_settings')
            .select('*');

        if (error) throw error;

        // Convert array of settings to object
        const settings = {};
        data.forEach(setting => {
            // Handle boolean conversion
            if (setting.value === 'true') {
                settings[setting.key] = true;
            } else if (setting.value === 'false') {
                settings[setting.key] = false;
            } else if (!isNaN(setting.value) && setting.value !== '') {
                settings[setting.key] = Number(setting.value);
            } else {
                settings[setting.key] = setting.value;
            }
        });

        res.json(settings);
    } catch (error) {
        console.error('❌ Settings fetch error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Update settings
app.put('/texon-inventory-comparison/api/settings', authenticateToken, async (req, res) => {
    if (req.user.role !== 'admin') {
        return res.status(403).json({ error: 'Admin access required' });
    }

    try {
        const newSettings = req.body;
        console.log(`⚙️ Admin ${req.user.username} updating settings:`, Object.keys(newSettings));

        // Validate cron expression if provided
        if (newSettings.cron_schedule) {
            if (!isValidCronExpression(newSettings.cron_schedule)) {
                return res.status(400).json({
                    success: false,
                    error: 'Invalid cron expression'
                });
            }
        }

        // Validate email recipients if provided
        if (newSettings.email_recipients) {
            const emails = newSettings.email_recipients.split(',').map(e => e.trim());
            for (const email of emails) {
                if (email && !isValidEmail(email)) {
                    return res.status(400).json({
                        success: false,
                        error: `Invalid email address: ${email}`
                    });
                }
            }
        }

        // Update each setting
        for (const [key, value] of Object.entries(newSettings)) {
            // Convert value to string for storage
            const stringValue = String(value);

            // Check if setting exists
            const { data: existingSetting, error: checkError } = await supabaseService
                .from('app_settings')
                .select('key')
                .eq('key', key)
                .single();

            if (existingSetting) {
                // Update existing setting
                const { error: updateError } = await supabaseService
                    .from('app_settings')
                    .update({
                        value: stringValue,
                        updated_at: new Date().toISOString(),
                        updated_by: req.user.username
                    })
                    .eq('key', key);

                if (updateError) throw updateError;
            } else {
                // Create new setting
                const { error: insertError } = await supabaseService
                    .from('app_settings')
                    .insert([{
                        key: key,
                        value: stringValue,
                        created_at: new Date().toISOString(),
                        updated_at: new Date().toISOString(),
                        created_by: req.user.username,
                        updated_by: req.user.username
                    }]);

                if (insertError) throw insertError;
            }
        }

        // Update cron job if schedule changed
        if (newSettings.cron_enabled !== undefined || newSettings.cron_schedule) {
            updateCronJob(newSettings.cron_enabled, newSettings.cron_schedule, newSettings.cron_timezone);
        }

        // Update performance settings if changed
        if (newSettings.debug_logging !== undefined || 
            newSettings.api_timeout_seconds !== undefined || 
            newSettings.max_concurrent_requests !== undefined) {
            await updatePerformanceSettings();
        }

        console.log(`✅ Settings updated successfully by ${req.user.username}`);

        res.json({
            success: true,
            message: 'Settings updated successfully'
        });

    } catch (error) {
        console.error('❌ Settings update error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Test email configuration
app.post('/texon-inventory-comparison/api/test-email', authenticateToken, async (req, res) => {
    if (req.user.role !== 'admin') {
        return res.status(403).json({ error: 'Admin access required' });
    }

    try {
        const { recipients } = req.body;

        if (!recipients || !recipients.trim()) {
            return res.status(400).json({
                success: false,
                error: 'Email recipients required'
            });
        }

        if (!emailTransporter) {
            return res.status(400).json({
                success: false,
                error: 'Email service not configured. Check SMTP settings in environment variables.'
            });
        }

        console.log(`📧 Admin ${req.user.username} testing email to: ${recipients}`);

        const subject = 'Texon Inventory Comparison - Test Email';
        const htmlContent = `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
                <h2 style="color: #333;">📧 Email Configuration Test</h2>
                
                <p>Hello!</p>
                
                <p>This is a test email from the Texon Inventory Comparison system to verify that email notifications are working correctly.</p>
                
                <div style="background: #f8f9fa; padding: 20px; border-radius: 8px; margin: 20px 0;">
                    <h3 style="margin: 0 0 10px 0; color: #495057;">Test Details:</h3>
                    <p><strong>Sent by:</strong> ${req.user.username}</p>
                    <p><strong>Timestamp:</strong> ${new Date().toLocaleString()}</p>
                    <p><strong>System:</strong> Texon Inventory Comparison</p>
                </div>
                
                <p><strong>✅ Success!</strong> If you're reading this email, your email configuration is working properly.</p>
                
                <p>You can expect to receive inventory comparison reports when:</p>
                <ul>
                    <li>Scheduled comparisons complete</li>
                    <li>Discrepancies are found between systems</li>
                    <li>Manual comparisons are run (if configured)</li>
                </ul>
                
                <p>Best regards,<br>Texon Inventory Management System</p>
                
                <hr style="margin: 30px 0; border: none; border-top: 1px solid #eee;">
                <p style="font-size: 12px; color: #666;">
                    This is a test message sent from the system settings page.
                </p>
            </div>
        `;

        const mailOptions = {
            from: process.env.SMTP_FROM || process.env.SMTP_USER,
            to: recipients,
            subject: subject,
            html: htmlContent
        };

        await emailTransporter.sendMail(mailOptions);

        console.log(`✅ Test email sent successfully to: ${recipients}`);

        res.json({
            success: true,
            message: 'Test email sent successfully!'
        });

    } catch (error) {
        console.error('❌ Test email error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Get all users (enhanced with new fields)
app.get('/texon-inventory-comparison/api/users', authenticateToken, async (req, res) => {
    if (req.user.role !== 'admin') {
        return res.status(403).json({ error: 'Admin access required' });
    }
    
    try {
        const { data, error } = await supabaseService
            .from('app_users')
            .select('id, username, email, first_name, last_name, role, created_at, last_login, is_active')
            .order('created_at', { ascending: false });

        if (error) throw error;
        res.json(data);
    } catch (error) {
        console.error('❌ Users fetch error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Create new user
app.post('/texon-inventory-comparison/api/users', authenticateToken, async (req, res) => {
    if (req.user.role !== 'admin') {
        return res.status(403).json({ error: 'Admin access required' });
    }

    try {
        const { username, email, first_name, last_name, password, role = 'user', is_active = true } = req.body;

        // Validation
        if (!username || !email || !first_name || !last_name || !password) {
            return res.status(400).json({ 
                success: false, 
                error: 'Username, email, first name, last name, and password are required' 
            });
        }

        if (password.length < 6) {
            return res.status(400).json({ 
                success: false, 
                error: 'Password must be at least 6 characters long' 
            });
        }

        // Check if username already exists
        const { data: existingUser, error: checkError } = await supabaseService
            .from('app_users')
            .select('id')
            .eq('username', username)
            .single();

        if (existingUser) {
            return res.status(400).json({ 
                success: false, 
                error: 'Username already exists' 
            });
        }

        // Check if email already exists
        const { data: existingEmail, error: emailCheckError } = await supabaseService
            .from('app_users')
            .select('id')
            .eq('email', email)
            .single();

        if (existingEmail) {
            return res.status(400).json({ 
                success: false, 
                error: 'Email already exists' 
            });
        }

        // Hash password
        const saltRounds = 10;
        const hashedPassword = await bcrypt.hash(password, saltRounds);

        // Create user
        const { data: newUser, error: insertError } = await supabaseService
            .from('app_users')
            .insert([{
                username: username.trim(),
                email: email.trim(),
                first_name: first_name.trim(),
                last_name: last_name.trim(),
                password_hash: hashedPassword,
                role: role,
                is_active: is_active,
                created_at: new Date().toISOString()
            }])
            .select('id, username, email, first_name, last_name, role, is_active, created_at')
            .single();

        if (insertError) throw insertError;

        console.log(`✅ New user created: ${username} by admin ${req.user.username}`);

        // Send welcome email if email service is configured
        if (emailTransporter) {
            try {
                await sendWelcomeEmail(newUser, password);
                console.log(`📧 Welcome email sent to ${email}`);
            } catch (emailError) {
                console.error('❌ Failed to send welcome email:', emailError);
                // Don't fail the user creation if email fails
            }
        }

        res.json({
            success: true,
            message: 'User created successfully',
            user: newUser
        });

    } catch (error) {
        console.error('❌ User creation error:', error);
        res.status(500).json({ 
            success: false, 
            error: error.message 
        });
    }
});

// Update user
app.put('/texon-inventory-comparison/api/users/:userId', authenticateToken, async (req, res) => {
    if (req.user.role !== 'admin') {
        return res.status(403).json({ error: 'Admin access required' });
    }

    try {
        const { userId } = req.params;
        const { email, first_name, last_name, password, role, is_active } = req.body;

        // Validation
        if (!email || !first_name || !last_name) {
            return res.status(400).json({ 
                success: false, 
                error: 'Email, first name, and last name are required' 
            });
        }

        // Check if user exists
        const { data: existingUser, error: checkError } = await supabaseService
            .from('app_users')
            .select('id, username, email')
            .eq('id', userId)
            .single();

        if (checkError || !existingUser) {
            return res.status(404).json({ 
                success: false, 
                error: 'User not found' 
            });
        }

        // Check if email is being changed and if new email already exists
        if (email !== existingUser.email) {
            const { data: emailExists, error: emailCheckError } = await supabaseService
                .from('app_users')
                .select('id')
                .eq('email', email)
                .neq('id', userId)
                .single();

            if (emailExists) {
                return res.status(400).json({ 
                    success: false, 
                    error: 'Email already exists' 
                });
            }
        }

        // Prepare update data
        const updateData = {
            email: email.trim(),
            first_name: first_name.trim(),
            last_name: last_name.trim(),
            role: role,
            is_active: is_active
        };

        // Only update password if provided
        if (password && password.trim()) {
            if (password.length < 6) {
                return res.status(400).json({ 
                    success: false, 
                    error: 'Password must be at least 6 characters long' 
                });
            }
            const saltRounds = 10;
            updateData.password_hash = await bcrypt.hash(password, saltRounds);
        }

        // Update user
        const { data: updatedUser, error: updateError } = await supabaseService
            .from('app_users')
            .update(updateData)
            .eq('id', userId)
            .select('id, username, email, first_name, last_name, role, is_active, created_at, last_login')
            .single();

        if (updateError) throw updateError;

        console.log(`✅ User updated: ${existingUser.username} by admin ${req.user.username}`);

        res.json({
            success: true,
            message: 'User updated successfully',
            user: updatedUser
        });

    } catch (error) {
        console.error('❌ User update error:', error);
        res.status(500).json({ 
            success: false, 
            error: error.message 
        });
    }
});

// Delete user
app.delete('/texon-inventory-comparison/api/users/:userId', authenticateToken, async (req, res) => {
    if (req.user.role !== 'admin') {
        return res.status(403).json({ error: 'Admin access required' });
    }

    try {
        const { userId } = req.params;

        // Prevent admin from deleting themselves
        if (parseInt(userId) === req.user.userId) {
            return res.status(400).json({ 
                success: false, 
                error: 'You cannot delete your own account' 
            });
        }

        // Check if user exists
        const { data: existingUser, error: checkError } = await supabaseService
            .from('app_users')
            .select('id, username')
            .eq('id', userId)
            .single();

        if (checkError || !existingUser) {
            return res.status(404).json({ 
                success: false, 
                error: 'User not found' 
            });
        }

        // Delete user
        const { error: deleteError } = await supabaseService
            .from('app_users')
            .delete()
            .eq('id', userId);

        if (deleteError) throw deleteError;

        console.log(`✅ User deleted: ${existingUser.username} by admin ${req.user.username}`);

        res.json({
            success: true,
            message: `User ${existingUser.username} deleted successfully`
        });

    } catch (error) {
        console.error('❌ User deletion error:', error);
        res.status(500).json({ 
            success: false, 
            error: error.message 
        });
    }
});

// Test endpoint
app.get('/texon-inventory-comparison/api/test', authenticateToken, async (req, res) => {
    res.json({
        message: 'API test successful',
        user: req.user,
        timestamp: new Date().toISOString(),
        server_status: 'OK'
    });
});

// Add this route to your server.js file (replace the existing one)
app.get('/texon-inventory-comparison/api/debug-brightpearl-inventory', async (req, res) => {
    try {
        console.log('🧪 Starting Brightpearl inventory debug...');
        const debugResult = await brightpearlAPI.debugCurrentInventoryStructure();
        res.json({ 
            success: true, 
            message: 'Debug complete - check server logs for detailed output',
            debugResult 
        });
    } catch (error) {
        console.error('❌ Debug route failed:', error);
        res.status(500).json({ 
            success: false, 
            error: error.message 
        });
    }
});

// Serve React app - IMPORTANT: This must be the last route
app.get('/texon-inventory-comparison*', (req, res) => {
    console.log(`Serving React app for: ${req.path}`);
    res.sendFile(path.join(__dirname, 'build', 'index.html'));
});

// Schedule daily inventory comparison at 7 PM (commented out for now)
// cron.schedule('0 19 * * *', async () => {
//     console.log('⏰ Running scheduled inventory comparison...');
//     // Add scheduled comparison logic here
// });

// Start server
app.listen(PORT, '0.0.0.0', () => {
    console.log(`✅ Texon Inventory Server running on 0.0.0.0:${PORT}`);
    console.log(`🌐 Access: https://collegesportsdirectory.com/texon-inventory-comparison`);
    console.log(`🔐 Default login: admin / changeme123`);
});

// Graceful shutdown
process.on('SIGINT', () => {
    console.log('\nShutting down gracefully...');
    process.exit(0);
});

process.on('SIGTERM', () => {
    console.log('\nShutting down gracefully...');
    process.exit(0);
});

module.exports = app;