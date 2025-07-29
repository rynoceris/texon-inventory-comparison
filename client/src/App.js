import React, { useState, useEffect } from 'react';
import './App.css';

const API_BASE = '/texon-inventory-comparison/api';

// Login Component
function LoginForm({ onLogin }) {
  const [credentials, setCredentials] = useState({ username: '', password: '' });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      const response = await fetch(`${API_BASE}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(credentials)
      });

      const data = await response.json();

      if (response.ok) {
        localStorage.setItem('token', data.token);
        localStorage.setItem('user', JSON.stringify(data.user));
        onLogin(data.user, data.token);
      } else {
        setError(data.error || 'Login failed');
      }
    } catch (error) {
      setError('Network error. Please try again.');
    }
    setLoading(false);
  };

  return (
    <div className="login-container">
      <div className="login-form">
        <h1>Texon Inventory Comparison</h1>
        <p>Please log in to access the inventory management system</p>
        
        {error && <div className="error-message">{error}</div>}
        
        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label>Username:</label>
            <input
              type="text"
              value={credentials.username}
              onChange={(e) => setCredentials({...credentials, username: e.target.value})}
              required
              autoComplete="username"
            />
          </div>
          
          <div className="form-group">
            <label>Password:</label>
            <input
              type="password"
              value={credentials.password}
              onChange={(e) => setCredentials({...credentials, password: e.target.value})}
              required
              autoComplete="current-password"
            />
          </div>
          
          <button type="submit" disabled={loading} className="btn-primary">
            {loading ? 'Logging in...' : 'Login'}
          </button>
        </form>
        
        <div className="login-help">
          <p><strong>Default Admin Credentials:</strong></p>
          <p>Username: <code>admin</code></p>
          <p>Password: <code>changeme123</code></p>
          <small>⚠️ Change these after first login!</small>
        </div>
      </div>
    </div>
  );
}

// Main Dashboard Component
function Dashboard({ user, token, onLogout }) {
  const [activeTab, setActiveTab] = useState('dashboard');
  const [loading, setLoading] = useState(false);
  const [reports, setReports] = useState([]);
  const [testResult, setTestResult] = useState(null);

  const runTest = async () => {
    setLoading(true);
    try {
      const response = await fetch(`${API_BASE}/test`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const data = await response.json();
      setTestResult(data);
    } catch (error) {
      setTestResult({ error: error.message });
    }
    setLoading(false);
  };

  return (
    <div className="App">
      <header className="app-header">
        <div className="header-content">
          <h1>Texon Inventory Comparison</h1>
          <div className="user-info">
            <span>Welcome, {user.username}</span>
            <button onClick={onLogout} className="btn-logout">Logout</button>
          </div>
        </div>
        <nav>
          <button 
            className={activeTab === 'dashboard' ? 'active' : ''}
            onClick={() => setActiveTab('dashboard')}
          >
            Dashboard
          </button>
          <button 
            className={activeTab === 'settings' ? 'active' : ''}
            onClick={() => setActiveTab('settings')}
          >
            Settings
          </button>
        </nav>
      </header>

      <main className="main-content">
        {activeTab === 'dashboard' && (
          <div className="dashboard">
            <h2>Dashboard</h2>
            
            <div className="dashboard-stats">
              <div className="stat-card">
                <h3>System Status</h3>
                <p>✅ Server Running</p>
                <small>Ready for configuration</small>
              </div>
              <div className="stat-card">
                <h3>Next Steps</h3>
                <p>Configure APIs</p>
                <small>Brightpearl & Infoplus</small>
              </div>
            </div>
            
            <div className="manual-run">
              <h3>API Test</h3>
              <p>Test the API connection and authentication.</p>
              <button 
                onClick={runTest} 
                disabled={loading}
                className="btn-primary"
              >
                {loading ? 'Testing...' : 'Test API Connection'}
              </button>
              
              {testResult && (
                <div className="test-result">
                  <h4>Test Result:</h4>
                  <pre>{JSON.stringify(testResult, null, 2)}</pre>
                </div>
              )}
            </div>
          </div>
        )}

        {activeTab === 'settings' && (
          <div className="settings">
            <h2>Settings</h2>
            <div className="setup-notice">
              <h3>🔧 Configuration Required</h3>
              <p>To complete the setup, you need to configure:</p>
              <ul>
                <li>✅ Database connection (Supabase)</li>
                <li>⏳ Brightpearl API credentials</li>
                <li>⏳ Infoplus API credentials</li>
                <li>⏳ Email SMTP settings</li>
                <li>⏳ User management</li>
              </ul>
              <p>Please update your <code>.env</code> file with the actual API credentials.</p>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

// Main App Component
function App() {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [user, setUser] = useState(null);
  const [token, setToken] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Check for existing authentication
    const savedToken = localStorage.getItem('token');
    const savedUser = localStorage.getItem('user');

    if (savedToken && savedUser) {
      setToken(savedToken);
      setUser(JSON.parse(savedUser));
      setIsAuthenticated(true);
    }
    setLoading(false);
  }, []);

  const handleLogin = (userData, authToken) => {
    setUser(userData);
    setToken(authToken);
    setIsAuthenticated(true);
  };

  const handleLogout = () => {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    setIsAuthenticated(false);
    setUser(null);
    setToken(null);
  };

  if (loading) {
    return (
      <div className="loading-container">
        <div className="loading">Loading...</div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return <LoginForm onLogin={handleLogin} />;
  }

  return (
    <Dashboard 
      user={user} 
      token={token} 
      onLogout={handleLogout}
    />
  );
}

export default App;
