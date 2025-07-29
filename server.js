const express = require('express');
const cors = require('cors');
const path = require('path');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3001;

console.log('🚀 Starting Texon Inventory Comparison Server...');

// Initialize Supabase
let supabase = null;
try {
    if (!process.env.SUPABASE_URL || !process.env.SUPABASE_ANON_KEY) {
        throw new Error('Missing Supabase credentials');
    }
    supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);
    console.log('✅ Supabase client initialized');
} catch (error) {
    console.error('❌ Supabase initialization failed:', error.message);
    process.exit(1);
}

// Middleware
app.use(cors());
app.use(express.json());

// Security headers
app.use('/texon-inventory-comparison', (req, res, next) => {
    res.setHeader('X-Robots-Tag', 'noindex, nofollow, noarchive, nosnippet');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    next();
});

// Request logging
app.use((req, res, next) => {
    console.log(`${new Date().toISOString()} - ${req.method} ${req.url}`);
    next();
});

const JWT_SECRET = process.env.JWT_SECRET || 'fallback-secret-change-this';

// Helper functions
async function getUserByUsername(username) {
    try {
        const { data, error } = await supabase
            .from('app_users')
            .select('*')
            .eq('username', username)
            .eq('is_active', true);

        if (error || !data || data.length === 0) return null;
        return data[0];
    } catch (error) {
        console.error('Error fetching user:', error);
        return null;
    }
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

// Routes
app.get('/health', (req, res) => {
    res.json({ 
        status: 'OK', 
        timestamp: new Date().toISOString(),
        port: PORT,
        supabase_connected: !!supabase
    });
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
    const brightpearlConfigured = !!(process.env.BRIGHTPEARL_ACCOUNT && process.env.BRIGHTPEARL_APP_REF && process.env.BRIGHTPEARL_TOKEN);
    const infoplusConfigured = !!process.env.INFOPLUS_API_KEY;
    const emailConfigured = !!(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);

    res.json({
        brightpearl_configured: brightpearlConfigured,
        infoplus_configured: infoplusConfigured,
        email_configured: emailConfigured,
        supabase_configured: !!supabase,
        overall_ready: brightpearlConfigured && infoplusConfigured && emailConfigured
    });
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

        // Add default values
        const defaults = {
            email_recipients: 'admin@texontowel.com',
            smtp_host: process.env.SMTP_HOST || 'smtp.gmail.com',
            smtp_port: process.env.SMTP_PORT || '587',
            smtp_user: process.env.SMTP_USER || '',
            smtp_pass: ''
        };

        res.json({ ...defaults, ...settings });
    } catch (error) {
        console.error('Settings fetch error:', error);
        res.json({
            email_recipients: 'admin@texontowel.com',
            smtp_host: 'smtp.gmail.com',
            smtp_port: '587'
        });
    }
});

app.post('/texon-inventory-comparison/api/settings', authenticateToken, async (req, res) => {
    if (req.user.role !== 'admin') {
        return res.status(403).json({ error: 'Admin access required' });
    }
    
    try {
        const settings = req.body;
        
        for (const [key, value] of Object.entries(settings)) {
            const { error } = await supabase
                .from('app_settings')
                .upsert({ key, value });
            
            if (error) throw error;
        }

        res.json({ success: true });
    } catch (error) {
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
        res.status(500).json({ error: error.message });
    }
});

app.post('/texon-inventory-comparison/api/users', authenticateToken, async (req, res) => {
    if (req.user.role !== 'admin') {
        return res.status(403).json({ error: 'Admin access required' });
    }
    
    try {
        const { username, password, email, role } = req.body;
        
        const existingUser = await getUserByUsername(username);
        if (existingUser) {
            return res.status(400).json({ error: 'User already exists' });
        }
        
        const hashedPassword = await bcrypt.hash(password, 10);
        
        const { data, error } = await supabase
            .from('app_users')
            .insert([{
                username,
                password_hash: hashedPassword,
                email,
                role: role || 'user',
                is_active: true,
                created_at: new Date().toISOString()
            }])
            .select()
            .single();

        if (error) throw error;
        
        res.json({ 
            success: true, 
            user: {
                id: data.id,
                username: data.username,
                email: data.email,
                role: data.role
            }
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.put('/texon-inventory-comparison/api/users/:id', authenticateToken, async (req, res) => {
    if (req.user.role !== 'admin') {
        return res.status(403).json({ error: 'Admin access required' });
    }
    
    try {
        const updates = req.body;
        
        if (updates.password) {
            updates.password_hash = await bcrypt.hash(updates.password, 10);
            delete updates.password;
        }

        const { data, error } = await supabase
            .from('app_users')
            .update(updates)
            .eq('id', req.params.id)
            .select();

        if (error) throw error;
        res.json({ success: true, user: data[0] });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Mock inventory comparison (replace with real implementation)
app.post('/texon-inventory-comparison/api/run-comparison', authenticateToken, async (req, res) => {
    try {
        console.log('🔄 Running inventory comparison...');
        
        // Mock data for demonstration
        const mockDiscrepancies = [
            {
                sku: 'TOWEL-001',
                brightpearl_stock: 150,
                infoplus_stock: 148,
                difference: 2,
                percentage_diff: 1.3
            },
            {
                sku: 'TOWEL-002', 
                brightpearl_stock: 75,
                infoplus_stock: 80,
                difference: -5,
                percentage_diff: 6.7
            }
        ];
        
        // Save report to database
        const reportData = {
            date: new Date().toISOString().split('T')[0],
            total_discrepancies: mockDiscrepancies.length,
            discrepancies: JSON.stringify(mockDiscrepancies),
            created_at: new Date().toISOString()
        };

        const { data, error } = await supabase
            .from('inventory_reports')
            .insert([reportData])
            .select()
            .single();

        if (error) throw error;
        
        res.json({
            totalDiscrepancies: mockDiscrepancies.length,
            discrepancies: mockDiscrepancies,
            message: 'Comparison completed (demo data)',
            reportId: data.id
        });
        
    } catch (error) {
        console.error('Comparison error:', error);
        res.status(500).json({ error: error.message });
    }
});

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
        console.error('Reports fetch error:', error);
        res.json([]);
    }
});

// Password reset endpoint
app.post('/texon-inventory-comparison/api/reset-password', async (req, res) => {
    try {
        const { username, newPassword } = req.body;
        
        if (!username || !newPassword) {
            return res.status(400).json({ error: 'Username and new password required' });
        }
        
        const hashedPassword = await bcrypt.hash(newPassword, 10);
        
        const { data, error } = await supabase
            .from('app_users')
            .update({ password_hash: hashedPassword })
            .eq('username', username)
            .select();
        
        if (error) throw error;
        
        if (!data || data.length === 0) {
            return res.status(404).json({ error: 'User not found' });
        }
        
        res.json({ 
            success: true, 
            message: 'Password reset successfully'
        });
        
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Main application route
app.get('/texon-inventory-comparison', (req, res) => {
    res.send(`
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="robots" content="noindex, nofollow, noarchive, nosnippet" />
    <title>Texon Inventory Comparison</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #f5f5f5; }
        
        .login-container { display: flex; justify-content: center; align-items: center; min-height: 100vh; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 20px; }
        .login-form { background: white; padding: 40px; border-radius: 10px; box-shadow: 0 10px 25px rgba(0,0,0,0.2); width: 100%; max-width: 400px; text-align: center; }
        .login-form h1 { margin: 0 0 10px 0; color: #333; font-size: 1.8rem; }
        .login-form p { color: #666; margin-bottom: 30px; }
        .error-message, .success-message { padding: 15px; border-radius: 5px; margin-bottom: 20px; display: none; }
        .error-message { background: #f8d7da; color: #721c24; border: 1px solid #f5c6cb; }
        .success-message { background: #d4edda; color: #155724; border: 1px solid #c3e6cb; }
        .form-group { margin-bottom: 20px; text-align: left; }
        .form-group label { display: block; margin-bottom: 5px; font-weight: 500; color: #333; }
        .form-group input, .form-group select, .form-group textarea { width: 100%; padding: 12px; border: 1px solid #ddd; border-radius: 4px; font-size: 1rem; box-sizing: border-box; }
        .btn-primary { background: #007bff; color: #fff; border: none; padding: 12px 24px; border-radius: 5px; cursor: pointer; font-size: 1rem; font-weight: 500; width: 100%; margin-bottom: 10px; }
        .btn-secondary { background: #6c757d; color: #fff; border: none; padding: 10px 20px; border-radius: 4px; cursor: pointer; font-size: 0.9rem; width: 100%; margin-bottom: 10px; }
        .btn-primary:hover:not(:disabled) { background: #0056b3; }
        .btn-primary:disabled { background: #ccc; cursor: not-allowed; }
        
        .app { max-width: 1200px; margin: 0 auto; background: white; min-height: 100vh; display: none; }
        .app-header { background: #fff; border-bottom: 2px solid #e0e0e0; padding: 20px; }
        .header-content { display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px; }
        .header-content h1 { margin: 0; color: #333; font-size: 2rem; }
        .user-info { display: flex; align-items: center; gap: 15px; color: #666; }
        .btn-logout { background: #dc3545; color: white; border: none; padding: 8px 16px; border-radius: 4px; cursor: pointer; }
        nav { display: flex; gap: 10px; flex-wrap: wrap; }
        nav button { padding: 10px 20px; border: 2px solid #007bff; background: #fff; color: #007bff; border-radius: 5px; cursor: pointer; font-weight: 500; transition: all 0.2s; }
        nav button:hover { background: #f8f9fa; }
        nav button.active { background: #007bff; color: #fff; }
        
        .main-content { padding: 30px; }
        .tab-content { display: none; }
        .tab-content.active { display: block; }
        
        .dashboard-stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(250px, 1fr)); gap: 20px; margin-bottom: 30px; }
        .stat-card { background: #f8f9fa; padding: 20px; border-radius: 8px; border: 1px solid #e0e0e0; }
        .stat-card h3 { margin: 0 0 10px 0; color: #666; font-size: 1rem; }
        .stat-card p { margin: 0; font-size: 1.5rem; font-weight: bold; color: #333; }
        .stat-card small { color: #888; font-size: 0.875rem; }
        
        .manual-run { background: #fff; padding: 30px; border-radius: 8px; border: 1px solid #e0e0e0; text-align: center; margin-bottom: 30px; }
        .manual-run h3 { margin: 0 0 10px 0; color: #333; }
        .manual-run p { color: #666; margin-bottom: 20px; }
        
        .config-status { background: #fff3cd; border: 1px solid #ffeaa7; color: #856404; padding: 20px; border-radius: 8px; margin-bottom: 20px; }
        .result-display { margin-top: 20px; padding: 15px; background: #f8f9fa; border-radius: 5px; text-align: left; }
        
        .reports-list { display: grid; gap: 20px; }
        .report-card { background: #fff; padding: 20px; border-radius: 8px; border: 1px solid #e0e0e0; display: flex; justify-content: space-between; align-items: center; }
        .report-header { display: flex; align-items: center; gap: 15px; }
        .report-header h3 { margin: 0; color: #333; }
        .status { padding: 4px 12px; border-radius: 20px; font-size: 0.875rem; font-weight: 500; }
        .status.success { background: #d4edda; color: #155724; }
        .status.warning { background: #fff3cd; color: #856404; }
        
        @media (max-width: 768px) {
            .login-form { margin: 20px; padding: 30px 20px; }
            .header-content { flex-direction: column; gap: 15px; align-items: flex-start; }
            .dashboard-stats { grid-template-columns: 1fr; }
            .report-card { flex-direction: column; align-items: flex-start; gap: 15px; }
            .main-content { padding: 20px; }
        }
    </style>
</head>
<body>
    <!-- Login Form -->
    <div id="login-container" class="login-container">
        <div class="login-form">
            <h1>Texon Inventory Comparison</h1>
            <p>Secure inventory management system</p>
            
            <div id="error-message" class="error-message"></div>
            <div id="success-message" class="success-message"></div>
            
            <form id="login-form">
                <div class="form-group">
                    <label>Username:</label>
                    <input type="text" id="username" required autocomplete="username" value="admin" />
                </div>
                
                <div class="form-group">
                    <label>Password:</label>
                    <input type="password" id="password" required autocomplete="current-password" value="changeme123" />
                </div>
                
                <button type="submit" id="login-btn" class="btn-primary">Login</button>
            </form>
        </div>
    </div>

    <!-- Main Application -->
    <div id="app" class="app">
        <header class="app-header">
            <div class="header-content">
                <h1>Texon Inventory Comparison</h1>
                <div class="user-info">
                    <span id="welcome-user">Welcome, User</span>
                    <button id="logout-btn" class="btn-logout">Logout</button>
                </div>
            </div>
            <nav>
                <button id="nav-dashboard" class="active">Dashboard</button>
                <button id="nav-settings">Settings</button>
                <button id="nav-reports">Reports</button>
                <button id="nav-users">Users</button>
            </nav>
        </header>

        <main class="main-content">
            <!-- Dashboard Tab -->
            <div id="tab-dashboard" class="tab-content active">
                <h2>Dashboard</h2>
                
                <div id="config-status" class="config-status">
                    <h3>⚙️ Configuration Status</h3>
                    <p id="config-details">Loading configuration status...</p>
                    <button id="refresh-config" class="btn-secondary" style="width: auto; margin-top: 10px;">Refresh Status</button>
                </div>
                
                <div class="dashboard-stats">
                    <div class="stat-card">
                        <h3>System Status</h3>
                        <p>✅ Online</p>
                        <small>Connected to Supabase</small>
                    </div>
                    <div class="stat-card">
                        <h3>Latest Report</h3>
                        <p id="latest-report">No reports yet</p>
                        <small id="latest-report-date">Run your first comparison</small>
                    </div>
                    <div class="stat-card">
                        <h3>Scheduled Run</h3>
                        <p>Daily at 7:00 PM</p>
                        <small>Automated daily comparisons</small>
                    </div>
                </div>
                
                <div class="manual-run">
                    <h3>Manual Inventory Comparison</h3>
                    <p>Run an inventory comparison between Brightpearl and Infoplus systems.</p>
                    <button id="run-comparison" class="btn-primary">Run Comparison Now</button>
                    <div id="comparison-result" class="result-display" style="display: none;"></div>
                </div>
            </div>

            <!-- Settings Tab -->
            <div id="tab-settings" class="tab-content">
                <h2>Settings</h2>
                <div class="config-status">
                    <h3>📧 Email Configuration</h3>
                    <p>Configure email settings for automated reports. Only admin users can modify settings.</p>
                </div>
                <p>Settings panel will be available once all APIs are configured.</p>
            </div>

            <!-- Reports Tab -->
            <div id="tab-reports" class="tab-content">
                <h2>Reports History (Last 30 Days)</h2>
                <div id="reports-list" class="reports-list">
                    <p>Loading reports...</p>
                </div>
            </div>

            <!-- Users Tab -->
            <div id="tab-users" class="tab-content">
                <h2>User Management</h2>
                <p>User management panel available for admin users.</p>
            </div>
        </main>
    </div>

    <script>
        const API_BASE = '/texon-inventory-comparison/api';
        let currentUser = null;
        let currentToken = null;

        document.addEventListener('DOMContentLoaded', function() {
            const token = localStorage.getItem('texon_token');
            const user = localStorage.getItem('texon_user');
            
            if (token && user) {
                currentToken = token;
                currentUser = JSON.parse(user);
                showApp();
            }

            document.getElementById('login-form').addEventListener('submit', handleLogin);
            document.getElementById('logout-btn').addEventListener('click', handleLogout);
            document.getElementById('run-comparison').addEventListener('click', runComparison);
            document.getElementById('refresh-config').addEventListener('click', loadConfigStatus);
            
            ['dashboard', 'settings', 'reports', 'users'].forEach(tab => {
                document.getElementById('nav-' + tab).addEventListener('click', () => showTab(tab));
            });
        });

        async function handleLogin(e) {
            e.preventDefault();
            
            const username = document.getElementById('username').value;
            const password = document.getElementById('password').value;
            const errorDiv = document.getElementById('error-message');
            const loginBtn = document.getElementById('login-btn');
            
            loginBtn.textContent = 'Logging in...';
            loginBtn.disabled = true;
            hideMessages();
            
            try {
                const response = await fetch(API_BASE + '/auth/login', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ username, password })
                });
                
                const data = await response.json();
                
                if (response.ok) {
                    localStorage.setItem('texon_token', data.token);
                    localStorage.setItem('texon_user', JSON.stringify(data.user));
                    currentToken = data.token;
                    currentUser = data.user;
                    showApp();
                } else {
                    showError(data.error || 'Login failed');
                }
            } catch (error) {
                showError('Network error: ' + error.message);
            }
            
            loginBtn.textContent = 'Login';
            loginBtn.disabled = false;
        }

        function handleLogout() {
            localStorage.removeItem('texon_token');
            localStorage.removeItem('texon_user');
            currentToken = null;
            currentUser = null;
            showLogin();
        }

        function showLogin() {
            document.getElementById('login-container').style.display = 'flex';
            document.getElementById('app').style.display = 'none';
        }

        function showApp() {
            document.getElementById('login-container').style.display = 'none';
            document.getElementById('app').style.display = 'block';
            document.getElementById('welcome-user').textContent = 'Welcome, ' + currentUser.username;
            
            loadConfigStatus();
            loadReports();
            
            if (currentUser.role !== 'admin') {
                document.getElementById('nav-users').style.display = 'none';
            }
        }

        function showTab(tabName) {
            document.querySelectorAll('.tab-content').forEach(tab => {
                tab.classList.remove('active');
            });
            document.querySelectorAll('nav button').forEach(btn => {
                btn.classList.remove('active');
            });
            document.getElementById('tab-' + tabName).classList.add('active');
            document.getElementById('nav-' + tabName).classList.add('active');
        }

        async function loadConfigStatus() {
            try {
                const response = await fetch(API_BASE + '/config-status', {
                    headers: { 'Authorization': 'Bearer ' + currentToken }
                });
                const status = await response.json();
                
                let statusHTML = '<ul style="margin: 10px 0;">';
                statusHTML += '<li>' + (status.supabase_configured ? '✅' : '❌') + ' Database (Supabase)</li>';
                statusHTML += '<li>' + (status.brightpearl_configured ? '✅' : '⚠️') + ' Brightpearl API</li>';
                statusHTML += '<li>' + (status.infoplus_configured ? '✅' : '⚠️') + ' Infoplus API</li>';
                statusHTML += '<li>' + (status.email_configured ? '✅' : '⚠️') + ' Email Configuration</li>';
                statusHTML += '</ul>';
                
                if (status.overall_ready) {
                    statusHTML += '<p style="color: green; font-weight: bold; margin-top: 15px;">🎉 System fully configured and ready!</p>';
                } else {
                    statusHTML += '<p style="color: orange; margin-top: 15px;">⚠️ Some configurations pending. Edit .env file to add API credentials.</p>';
                }
                
                document.getElementById('config-details').innerHTML = statusHTML;
            } catch (error) {
                console.error('Error loading config status:', error);
                document.getElementById('config-details').innerHTML = '<p>Error loading configuration status</p>';
            }
        }

        async function runComparison() {
            const button = document.getElementById('run-comparison');
            const resultDiv = document.getElementById('comparison-result');
            
            button.textContent = 'Running...';
            button.disabled = true;
            resultDiv.style.display = 'none';
            
            try {
                const response = await fetch(API_BASE + '/run-comparison', {
                    method: 'POST',
                    headers: { 'Authorization': 'Bearer ' + currentToken }
                });
                
                const data = await response.json();
                
                if (response.ok) {
                    resultDiv.innerHTML = 
                        '<h4>✅ Comparison Complete!</h4>' +
                        '<p><strong>Total Discrepancies:</strong> ' + data.totalDiscrepancies + '</p>' +
                        '<p><strong>Status:</strong> ' + data.message + '</p>' +
                        (data.totalDiscrepancies > 0 ? 
                            '<p><strong>Sample:</strong> ' + data.discrepancies[0].sku + ' (diff: ' + data.discrepancies[0].difference + ')</p>' : 
                            '<p style="color: green;">All inventory levels are in sync!</p>');
                    resultDiv.style.display = 'block';
                    
                    document.getElementById('latest-report').textContent = data.totalDiscrepancies + ' discrepancies';
                    document.getElementById('latest-report-date').textContent = 'Just now';
                    
                    loadReports();
                } else {
                    throw new Error(data.error || 'Comparison failed');
                }
            } catch (error) {
                resultDiv.innerHTML = '<h4>❌ Error</h4><p>' + error.message + '</p>';
                resultDiv.style.display = 'block';
            }
            
            button.textContent = 'Run Comparison Now';
            button.disabled = false;
        }

        async function loadReports() {
            try {
                const response = await fetch(API_BASE + '/reports', {
                    headers: { 'Authorization': 'Bearer ' + currentToken }
                });
                const reports = await response.json();
                
                const reportsContainer = document.getElementById('reports-list');
                
                if (reports.length === 0) {
                    reportsContainer.innerHTML = '<p>No reports yet. Run your first comparison to see results here.</p>';
                    return;
                }
                
                let html = '';
                reports.forEach(report => {
                    html += 
                        '<div class="report-card">' +
                            '<div class="report-header">' +
                                '<h3>' + new Date(report.created_at).toLocaleDateString() + '</h3>' +
                                '<span class="status ' + (report.total_discrepancies === 0 ? 'success' : 'warning') + '">' +
                                    report.total_discrepancies + ' discrepancies' +
                                '</span>' +
                            '</div>' +
                            '<div>' +
                                '<p>' + new Date(report.created_at).toLocaleString() + '</p>' +
                            '</div>' +
                        '</div>';
                });
                
                reportsContainer.innerHTML = html;
                
                if (reports.length > 0) {
                    document.getElementById('latest-report').textContent = reports[0].total_discrepancies + ' discrepancies';
                    document.getElementById('latest-report-date').textContent = new Date(reports[0].created_at).toLocaleDateString();
                }
            } catch (error) {
                console.error('Error loading reports:', error);
                document.getElementById('reports-list').innerHTML = '<p>Error loading reports.</p>';
            }
        }

        function showError(message) {
            const errorDiv = document.getElementById('error-message');
            errorDiv.textContent = message;
            errorDiv.style.display = 'block';
            setTimeout(() => errorDiv.style.display = 'none', 5000);
        }

        function showSuccess(message) {
            const successDiv = document.getElementById('success-message');
            successDiv.innerHTML = message;
            successDiv.style.display = 'block';
            setTimeout(() => successDiv.style.display = 'none', 3000);
        }

        function hideMessages() {
            document.getElementById('error-message').style.display = 'none';
            document.getElementById('success-message').style.display = 'none';
        }
    </script>
</body>
</html>
    `);
});

app.get('/texon-inventory-comparison/*', (req, res) => {
    res.redirect('/texon-inventory-comparison');
});

// Start server
const server = app.listen(PORT, '0.0.0.0', () => {
    console.log(`✅ Texon Inventory Server running on 0.0.0.0:${PORT}`);
    console.log(`🌐 Access: https://collegesportsdirectory.com/texon-inventory-comparison`);
    console.log(`🔐 Default login: admin / changeme123`);
});

process.on('SIGTERM', () => {
    console.log('Shutting down gracefully...');
    server.close(() => process.exit(0));
});

process.on('SIGINT', () => {
    console.log('Shutting down gracefully...');
    server.close(() => process.exit(0));
});
