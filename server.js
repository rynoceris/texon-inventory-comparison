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

console.log('✅ Supabase client initialized');

const JWT_SECRET = process.env.JWT_SECRET;

// Helper functions
async function getUserByUsername(username) {
    const { data, error } = await supabase
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
app.post('/texon-inventory-comparison/api/auth/login', async (req, res) => {
    try {
        const { username, password } = req.body;
        console.log('🔐 Login attempt for username:', username);

        if (!username || !password) {
            return res.status(400).json({ error: 'Username and password required' });
        }

        const user = await getUserByUsername(username);
        if (!user) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }

        const isValidPassword = await bcrypt.compare(password, user.password_hash);
        if (!isValidPassword) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }

        // Update last login
        await supabase
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
                
                const response = await fetch(url, {
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
                    
                    if (inventoryData && inventoryData.results) {
                        Object.entries(inventoryData.results).forEach(([productId, productInventory]) => {
                            let totalAvailable = 0;
                            
                            // Sum across all warehouses
                            if (typeof productInventory === 'object') {
                                Object.values(productInventory).forEach(warehouseStock => {
                                    if (typeof warehouseStock === 'object' && warehouseStock.availableStock !== undefined) {
                                        totalAvailable += warehouseStock.availableStock || 0;
                                    }
                                });
                            }
                            
                            inventory[productId] = {
                                available: totalAvailable
                            };
                        });
                    }
                } catch (batchError) {
                    console.warn(`⚠️ Failed to fetch inventory for batch ${Math.floor(i/batchSize) + 1}: ${batchError.message}`);
                    // Continue with next batch
                }
                
                // Rate limiting delay
                if (i + batchSize < productIdArray.length) {
                    await new Promise(resolve => setTimeout(resolve, 500));
                }
            }
            
            console.log(`✅ Processed inventory for ${Object.keys(inventory).length} products`);
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
}

// Corrected InfoplusAPI Class - Replace in your server.js

class InfoplusAPI {
    constructor() {
        // CORRECT: Use the proper Infoplus domain format
        this.companyId = process.env.INFOPLUS_COMPANY_ID || 'texon'; // Your company identifier
        this.baseUrl = `https://${this.companyId}.infopluswms.com/infoplus-wms/api`;
        this.apiKey = process.env.INFOPLUS_API_KEY;
        this.lobId = process.env.INFOPLUS_LOB_ID || 1;
        this.version = 'beta'; // Use beta version for full access
        
        console.log('🔧 Infoplus API Configuration:');
        console.log(`Base URL: ${this.baseUrl}`);
        console.log(`Company ID: ${this.companyId}`);
        console.log(`LOB ID: ${this.lobId}`);
        console.log(`API Key: ${this.apiKey ? '✅ Set' : '❌ Missing'}`);
        console.log(`Version: ${this.version}`);
    }

    async makeRequest(endpoint, options = {}) {
        try {
            const url = `${this.baseUrl}/${this.version}/${endpoint}`;
            console.log(`🔄 Infoplus API Request: ${url}`);
            
            const response = await fetch(url, {
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
            console.log(`✅ Infoplus request successful`);
            return data;
            
        } catch (error) {
            console.error('❌ Infoplus API Error:', error);
            throw error;
        }
    }

    // Replace the getInventory method in your InfoplusAPI class with this optimized version:
    
    async getInventory() {
        try {
            console.log('📊 Fetching Infoplus inventory...');
            
            // Instead of fetching ALL inventory details, let's try the item endpoint first
            // which should give us current quantities more efficiently
            let allItems = [];
            let page = 1;
            const limit = 250;
            let hasMore = true;
            
            while (hasMore && page <= 20) { // Limit to 20 pages (5000 items) to start
                console.log(`📦 Fetching Infoplus items page ${page}...`);
                
                const offset = (page - 1) * limit;
                const searchParams = new URLSearchParams({
                    limit: limit,
                    offset: offset,
                    filter: `lobId eq ${this.lobId}` // Filter by Line of Business
                });
                
                const itemData = await this.makeRequest(
                    `item/search?${searchParams.toString()}`
                );
                
                if (itemData && itemData.length > 0) {
                    allItems = allItems.concat(itemData);
                    
                    hasMore = itemData.length === limit;
                    console.log(`✅ Page ${page}: ${itemData.length} items (Total so far: ${allItems.length})`);
                    page++;
                    
                    // Rate limiting
                    if (hasMore) {
                        await new Promise(resolve => setTimeout(resolve, 200));
                    }
                } else {
                    hasMore = false;
                }
            }
            
            console.log(`✅ Found ${allItems.length} Infoplus items`);
            
            // Convert items to inventory format
            const inventory = {};
            allItems.forEach(item => {
                const sku = item.sku;
                
                if (sku) {
                    inventory[sku] = {
                        sku: sku,
                        productName: item.itemDescription || item.itemShortDescription || 'Unknown Product',
                        quantity: item.availableQuantity || item.quantityOnHand || 0
                    };
                }
            });
            
            console.log(`✅ Processed ${Object.keys(inventory).length} unique Infoplus SKUs`);
            return inventory;
            
        } catch (error) {
            console.error('❌ Error fetching Infoplus inventory:', error);
            throw error;
        }
    }

    async testConnection() {
        try {
            console.log('🧪 Testing Infoplus connection...');
            
            // Test with a simple warehouse lookup
            const testData = await this.makeRequest(`warehouse/search?limit=1`);
            
            if (testData && Array.isArray(testData)) {
                return { 
                    success: true, 
                    message: `Infoplus connection successful! Found ${testData.length > 0 ? 'warehouses' : 'empty warehouse list'}.` 
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
}

// Initialize API clients
const brightpearlAPI = new BrightpearlAPI();
const infoplusAPI = new InfoplusAPI();

// Real inventory comparison function
async function performRealInventoryComparison() {
    try {
        console.log('🔄 Starting REAL inventory comparison...');
        
        // Fetch inventory from both systems in parallel
        console.log('📊 Fetching inventory from both systems...');
        const [brightpearlInventory, infoplusInventory] = await Promise.all([
            brightpearlAPI.getInventory(),
            infoplusAPI.getInventory()
        ]);

        console.log(`📊 Brightpearl items: ${Object.keys(brightpearlInventory).length}`);
        console.log(`📊 Infoplus items: ${Object.keys(infoplusInventory).length}`);
        
        // Add this debugging code to your performRealInventoryComparison function
        // Insert this right after fetching both inventories:
        
        console.log('🔍 SKU Analysis Debug:');
        
        // Sample Brightpearl SKUs
        const brightpearlSkus = Object.keys(brightpearlInventory).slice(0, 10);
        console.log('📊 Sample Brightpearl SKUs:', brightpearlSkus);
        
        // Sample Infoplus SKUs  
        const infoplusSkus = Object.keys(infoplusInventory).slice(0, 10);
        console.log('📦 Sample Infoplus SKUs:', infoplusSkus);
        
        // Check for exact matches
        const exactMatches = brightpearlSkus.filter(sku => infoplusInventory[sku]);
        console.log('✅ Exact SKU matches found:', exactMatches.length);
        
        // Check for case-insensitive matches
        const brightpearlSkusLower = Object.keys(brightpearlInventory).map(sku => sku.toLowerCase());
        const infoplusSkusLower = Object.keys(infoplusInventory).map(sku => sku.toLowerCase());
        const caseInsensitiveMatches = brightpearlSkusLower.filter(sku => infoplusSkusLower.includes(sku));
        console.log('🔤 Case-insensitive matches:', caseInsensitiveMatches.length);
        
        // Check for partial matches (substring matching)
        let partialMatches = 0;
        brightpearlSkus.forEach(bpSku => {
            infoplusSkus.forEach(ipSku => {
                if (bpSku.includes(ipSku) || ipSku.includes(bpSku)) {
                    partialMatches++;
                    console.log(`🔗 Partial match: "${bpSku}" ↔ "${ipSku}"`);
                }
            });
        });
        console.log(`🔗 Partial matches found: ${partialMatches}`);
        
        // Show sample inventory data structures
        if (brightpearlSkus.length > 0) {
            const sampleBpItem = brightpearlInventory[brightpearlSkus[0]];
            console.log('📊 Sample Brightpearl item:', JSON.stringify(sampleBpItem, null, 2));
        }
        
        if (infoplusSkus.length > 0) {
            const sampleIpItem = infoplusInventory[infoplusSkus[0]];
            console.log('📦 Sample Infoplus item:', JSON.stringify(sampleIpItem, null, 2));
        }
        
        // Add this enhanced debugging after the SKU analysis in performRealInventoryComparison:
        
        console.log('🔍 Enhanced SKU Analysis:');
        
        // Check Brightpearl SKU patterns  
        const allBrightpearlSkus = Object.keys(brightpearlInventory);
        const bpNumericSkus = allBrightpearlSkus.filter(sku => /^\d+$/.test(sku));
        const bpAlphanumericSkus = allBrightpearlSkus.filter(sku => /^[A-Za-z0-9-]+$/.test(sku) && !/^\d+$/.test(sku));
        
        console.log(`📊 Brightpearl SKU patterns:`);
        console.log(`  - Numeric only: ${bpNumericSkus.length} (e.g., ${bpNumericSkus.slice(0, 3).join(', ')})`);
        console.log(`  - Alphanumeric: ${bpAlphanumericSkus.length} (e.g., ${bpAlphanumericSkus.slice(0, 3).join(', ')})`);
        
        // Check Infoplus SKU patterns
        const allInfoplusSkus = Object.keys(infoplusInventory);
        const ipNumericSkus = allInfoplusSkus.filter(sku => /^\d+$/.test(sku));
        const ipAlphanumericSkus = allInfoplusSkus.filter(sku => /^[A-Za-z0-9-]+$/.test(sku));
        
        console.log(`📦 Infoplus SKU patterns:`);
        console.log(`  - Numeric only: ${ipNumericSkus.length} (e.g., ${ipNumericSkus.slice(0, 3).join(', ')})`);
        console.log(`  - Alphanumeric: ${ipAlphanumericSkus.length} (e.g., ${ipAlphanumericSkus.slice(0, 3).join(', ')})`);
        
        // Find actual matches
        const realExactMatches = [];
        const realCaseMatches = [];
        
        allBrightpearlSkus.forEach(bpSku => {
            if (infoplusInventory[bpSku]) {
                realExactMatches.push(bpSku);
            } else if (infoplusInventory[bpSku.toLowerCase()] || infoplusInventory[bpSku.toUpperCase()]) {
                realCaseMatches.push(bpSku);
            }
        });
        
        console.log(`🎯 Actual SKU matches:`);
        console.log(`  - Exact matches: ${realExactMatches.length} (e.g., ${realExactMatches.slice(0, 5).join(', ')})`);
        console.log(`  - Case insensitive: ${realCaseMatches.length} (e.g., ${realCaseMatches.slice(0, 5).join(', ')})`);
        
        // Show some sample matched pairs
        if (realExactMatches.length > 0) {
            console.log(`🔗 Sample exact matches:`);
            realExactMatches.slice(0, 3).forEach(sku => {
                const bpQty = brightpearlInventory[sku]?.quantity || 0;
                const ipQty = infoplusInventory[sku]?.quantity || 0;
                console.log(`  "${sku}": BP=${bpQty}, IP=${ipQty}, Diff=${bpQty - ipQty}`);
            });
        }
        
        // Check if Brightpearl SKUs look suspiciously like product IDs
        const avgBpSkuLength = allBrightpearlSkus.reduce((sum, sku) => sum + sku.length, 0) / allBrightpearlSkus.length;
        const allBpNumeric = allBrightpearlSkus.every(sku => /^\d+$/.test(sku));
        
        console.log(`⚠️ Brightpearl SKU Analysis:`);
        console.log(`  - Average length: ${avgBpSkuLength.toFixed(1)} characters`);
        console.log(`  - All numeric: ${allBpNumeric}`);
        
        if (allBpNumeric && avgBpSkuLength < 6) {
            console.log(`🚨 WARNING: Brightpearl SKUs look like product IDs, not actual SKUs!`);
            console.log(`   - Expected SKUs: alphanumeric codes like "TOWEL-001", "RACK-HD-48"`);
            console.log(`   - Current SKUs: simple numbers like "656", "692", "12003"`);
            console.log(`   - This suggests we might be using the wrong field from Brightpearl`);
        }

        // Compare inventories
        const discrepancies = [];
        const allSkus = new Set([
            ...Object.keys(brightpearlInventory),
            ...Object.keys(infoplusInventory)
        ]);

        console.log(`🔍 Analyzing ${allSkus.size} unique SKUs...`);

        allSkus.forEach(sku => {
            const brightpearlItem = brightpearlInventory[sku];
            const infoplusItem = infoplusInventory[sku];

            const brightpearlStock = brightpearlItem?.quantity || 0;
            const infoplusStock = infoplusItem?.quantity || 0;
            const difference = brightpearlStock - infoplusStock;

            // Only report discrepancies (not exact matches)
            if (difference !== 0) {
                const percentageDiff = infoplusStock > 0 
                    ? Math.round((Math.abs(difference) / infoplusStock) * 100 * 10) / 10 
                    : 100;

                discrepancies.push({
                    sku,
                    productName: brightpearlItem?.productName || infoplusItem?.productName || 'Unknown Product',
                    brightpearl_stock: brightpearlStock,
                    infoplus_stock: infoplusStock,
                    difference,
                    percentage_diff: percentageDiff,
                    brand: brightpearlItem?.brand || 'Unknown'
                });
            }
        });

        // Sort by absolute difference (largest discrepancies first)
        discrepancies.sort((a, b) => Math.abs(b.difference) - Math.abs(a.difference));

        console.log(`✅ Found ${discrepancies.length} discrepancies out of ${allSkus.size} SKUs`);

        // Save report to database
        const reportData = {
            date: new Date().toISOString().split('T')[0],
            total_discrepancies: discrepancies.length,
            discrepancies: JSON.stringify(discrepancies),
            created_at: new Date().toISOString(),
            brightpearl_total_items: Object.keys(brightpearlInventory).length,
            infoplus_total_items: Object.keys(infoplusInventory).length
        };

        const { data, error } = await supabase
            .from('inventory_reports')
            .insert([reportData])
            .select()
            .single();

        if (error) throw error;

        // Send email if configured and there are discrepancies
        const emailRecipients = process.env.EMAIL_RECIPIENTS;
        if (emailRecipients && emailTransporter && discrepancies.length > 0) {
            try {
                await sendInventoryReportEmail({
                    ...reportData,
                    discrepancies
                }, emailRecipients);
                console.log('✅ Email report sent successfully');
            } catch (emailError) {
                console.error('❌ Failed to send email report:', emailError);
            }
        }

        return {
            totalDiscrepancies: discrepancies.length,
            discrepancies: discrepancies.slice(0, 50), // Limit response size
            message: `Real inventory comparison completed - analyzed ${allSkus.size} SKUs`,
            reportId: data.id,
            brightpearlItems: Object.keys(brightpearlInventory).length,
            infoplusItems: Object.keys(infoplusInventory).length,
            totalSkusAnalyzed: allSkus.size
        };

    } catch (error) {
        console.error('❌ Real inventory comparison failed:', error);
        throw error;
    }
}

// Email function (simplified version)
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
            
            <p><em>Automated report from Texon Inventory Comparison system.</em></p>
        `;

        const mailOptions = {
            from: process.env.SMTP_FROM || process.env.SMTP_USER,
            to: recipients,
            subject: subject,
            html: htmlContent
        };

        const result = await emailTransporter.sendMail(mailOptions);
        return result;
    } catch (error) {
        console.error('❌ Failed to send email:', error);
        throw error;
    }
}

// REPLACE the mock run-comparison route with this real one:
app.post('/texon-inventory-comparison/api/run-comparison', authenticateToken, async (req, res) => {
    try {
        const result = await performRealInventoryComparison();
        res.json(result);
    } catch (error) {
        console.error('❌ Real comparison failed:', error);
        res.status(500).json({ error: error.message });
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
        const { data, error } = await supabase
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
        const { data, error } = await supabase
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

// Settings routes
app.get('/texon-inventory-comparison/api/settings', authenticateToken, async (req, res) => {
    try {
        const { data, error } = await supabase
            .from('app_settings')
            .select('*');

        if (error) throw error;

        const settings = {};
        data.forEach(setting => {
            settings[setting.key] = setting.value;
        });

        res.json(settings);
    } catch (error) {
        console.error('❌ Settings fetch error:', error);
        res.status(500).json({ error: error.message });
    }
});

// User management routes
app.get('/texon-inventory-comparison/api/users', authenticateToken, async (req, res) => {
    if (req.user.role !== 'admin') {
        return res.status(403).json({ error: 'Admin access required' });
    }
    
    try {
        const { data, error } = await supabase
            .from('app_users')
            .select('id, username, email, role, created_at, last_login, is_active')
            .order('created_at', { ascending: false });

        if (error) throw error;
        res.json(data);
    } catch (error) {
        console.error('❌ Users fetch error:', error);
        res.status(500).json({ error: error.message });
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