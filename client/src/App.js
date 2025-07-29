import React, { useState, useEffect } from 'react';
import './App.css';

const API_BASE = '/texon-inventory-comparison/api';

// Login Component
function Login({ onLogin }) {
  const [credentials, setCredentials] = useState({ username: '', password: '' });
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    setIsLoading(true);
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

    setIsLoading(false);
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
          
          <button type="submit" disabled={isLoading} className="btn-primary">
            {isLoading ? 'Logging in...' : 'Login'}
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

// Dashboard Component
function Dashboard({ token }) {
  const [configStatus, setConfigStatus] = useState(null);
  const [latestReport, setLatestReport] = useState(null);
  const [isRunning, setIsRunning] = useState(false);
  const [comparisonResult, setComparisonResult] = useState(null);

  useEffect(() => {
    loadConfigStatus();
    loadLatestReport();
  }, []);

  const loadConfigStatus = async () => {
    try {
      const response = await fetch(`${API_BASE}/config-status`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const data = await response.json();
      setConfigStatus(data);
    } catch (error) {
      console.error('Error loading config status:', error);
    }
  };

  const loadLatestReport = async () => {
    try {
      const response = await fetch(`${API_BASE}/latest-report`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const data = await response.json();
      setLatestReport(data);
    } catch (error) {
      console.error('Error loading latest report:', error);
    }
  };

  const runComparison = async () => {
    setIsRunning(true);
    setComparisonResult(null);

    try {
      const response = await fetch(`${API_BASE}/run-comparison`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` }
      });

      const data = await response.json();

      if (response.ok) {
        setComparisonResult(data);
        loadLatestReport(); // Refresh latest report
      } else {
        setComparisonResult({ error: data.error });
      }
    } catch (error) {
      setComparisonResult({ error: error.message });
    }

    setIsRunning(false);
  };

  return (
    <div className="dashboard">
      <h2>Dashboard</h2>
      
      {/* Configuration Status */}
      <div className="config-status">
        <h3>⚙️ Configuration Status</h3>
        {configStatus ? (
          <div>
            <ul>
              <li>{configStatus.supabase_configured ? '✅' : '❌'} Database (Supabase)</li>
              <li>{configStatus.brightpearl_configured ? '✅' : '⚠️'} Brightpearl API</li>
              <li>{configStatus.infoplus_configured ? '✅' : '⚠️'} Infoplus API</li>
              <li>{configStatus.email_configured ? '✅' : '⚠️'} Email Configuration</li>
            </ul>
            {configStatus.overall_ready ? (
              <p style={{color: 'green', fontWeight: 'bold'}}>🎉 System fully configured and ready!</p>
            ) : (
              <p style={{color: 'orange'}}>⚠️ Settings panel will be available once all APIs are configured.</p>
            )}
          </div>
        ) : (
          <p>Loading configuration status...</p>
        )}
        <button onClick={loadConfigStatus} className="btn-secondary">Refresh Status</button>
      </div>

      {/* Dashboard Stats */}
      <div className="dashboard-stats">
        <div className="stat-card">
          <h3>System Status</h3>
          <p>✅ Online</p>
          <small>Connected to Supabase</small>
        </div>
        
        <div className="stat-card">
          <h3>Latest Report</h3>
          <p>{latestReport ? `${latestReport.total_discrepancies} discrepancies` : 'No reports yet'}</p>
          <small>{latestReport ? new Date(latestReport.created_at).toLocaleString() : 'Run your first comparison'}</small>
        </div>
        
        <div className="stat-card">
          <h3>Scheduled Run</h3>
          <p>Daily at 7:00 PM</p>
          <small>Automated daily comparisons</small>
        </div>
      </div>

      {/* Manual Run Section */}
      <div className="manual-run">
        <h3>Manual Inventory Comparison</h3>
        <p>Run an inventory comparison between Brightpearl and Infoplus systems.</p>
        <button 
          onClick={runComparison} 
          disabled={isRunning || !configStatus?.overall_ready}
          className="btn-primary"
        >
          {isRunning ? 'Running Comparison...' : 'Run Comparison Now'}
        </button>

        {comparisonResult && (
          <div className="comparison-result">
            {comparisonResult.error ? (
              <div className="error-message">
                <strong>Error:</strong> {comparisonResult.error}
              </div>
            ) : (
              <div className="success-message">
                <h4>✅ Comparison Complete!</h4>
                <p><strong>Total Discrepancies:</strong> {comparisonResult.totalDiscrepancies}</p>
                <p><strong>Status:</strong> {comparisonResult.message}</p>
                {comparisonResult.totalDiscrepancies > 0 && (
                  <details>
                    <summary>View Discrepancies ({comparisonResult.discrepancies.length})</summary>
                    <div className="discrepancies-table">
                      <table>
                        <thead>
                          <tr>
                            <th>SKU</th>
                            <th>Brightpearl</th>
                            <th>Infoplus</th>
                            <th>Difference</th>
                          </tr>
                        </thead>
                        <tbody>
                          {comparisonResult.discrepancies.slice(0, 10).map((item, index) => (
                            <tr key={index}>
                              <td>{item.sku}</td>
                              <td>{item.brightpearl_stock}</td>
                              <td>{item.infoplus_stock}</td>
                              <td style={{color: item.difference < 0 ? 'red' : 'green'}}>
                                {item.difference > 0 ? '+' : ''}{item.difference}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      {comparisonResult.discrepancies.length > 10 && (
                        <p><em>Showing first 10 of {comparisonResult.discrepancies.length} discrepancies</em></p>
                      )}
                    </div>
                  </details>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// Settings Component
function Settings() {
  return (
    <div className="settings">
      <h2>Settings</h2>
      <div className="config-status">
        <h3>📧 Email Configuration</h3>
        <p>Configure email settings for automated reports. Only admin users can modify settings.</p>
      </div>
      <p>Settings panel will be available once all APIs are configured.</p>
    </div>
  );
}

// Reports Component
function Reports({ token }) {
  const [reports, setReports] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadReports();
  }, []);

  const loadReports = async () => {
    try {
      const response = await fetch(`${API_BASE}/reports`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const data = await response.json();
      setReports(data);
    } catch (error) {
      console.error('Error loading reports:', error);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return <div>Loading reports...</div>;
  }

  return (
    <div className="reports">
      <h2>Reports History (Last 30 Days)</h2>
      
      {reports.length === 0 ? (
        <p>No reports available yet. Run your first comparison!</p>
      ) : (
        <div className="reports-list">
          {reports.map((report, index) => (
            <div key={report.id || index} className="report-card">
              <div className="report-header">
                <span className="report-date">{report.date}</span>
                <span className={`discrepancies-badge ${report.total_discrepancies > 0 ? 'has-discrepancies' : 'no-discrepancies'}`}>
                  {report.total_discrepancies} discrepancies
                </span>
                <span className="report-time">{new Date(report.created_at).toLocaleString()}</span>
              </div>
              
              {report.total_discrepancies > 0 && (
                <details className="report-details">
                  <summary>View Details</summary>
                  <div className="discrepancies-summary">
                    <table>
                      <thead>
                        <tr>
                          <th>SKU</th>
                          <th>Product</th>
                          <th>Brightpearl</th>
                          <th>Infoplus</th>
                          <th>Diff</th>
                        </tr>
                      </thead>
                      <tbody>
                        {report.discrepancies.slice(0, 5).map((item, idx) => (
                          <tr key={idx}>
                            <td>{item.sku}</td>
                            <td>{item.productName || 'N/A'}</td>
                            <td>{item.brightpearl_stock}</td>
                            <td>{item.infoplus_stock}</td>
                            <td style={{color: item.difference < 0 ? 'red' : 'green'}}>
                              {item.difference > 0 ? '+' : ''}{item.difference}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {report.discrepancies.length > 5 && (
                      <p><em>Showing 5 of {report.discrepancies.length} discrepancies</em></p>
                    )}
                  </div>
                </details>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// Users Component (Admin only)
function Users({ token, user }) {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (user.role === 'admin') {
      loadUsers();
    }
  }, [user.role]);

  const loadUsers = async () => {
    try {
      const response = await fetch(`${API_BASE}/users`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const data = await response.json();
      setUsers(data);
    } catch (error) {
      console.error('Error loading users:', error);
    } finally {
      setLoading(false);
    }
  };

  if (user.role !== 'admin') {
    return <div>Access denied. Admin privileges required.</div>;
  }

  if (loading) {
    return <div>Loading users...</div>;
  }

  return (
    <div className="users">
      <h2>User Management</h2>
      <p>User management panel available for admin users.</p>
      
      <div className="users-list">
        {users.map(u => (
          <div key={u.id} className="user-card">
            <div className="user-info">
              <strong>{u.username}</strong> ({u.role})
              <br />
              <small>{u.email}</small>
              <br />
              <small>Last login: {u.last_login ? new Date(u.last_login).toLocaleString() : 'Never'}</small>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// Main App Component
function App() {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [user, setUser] = useState(null);
  const [token, setToken] = useState(null);
  const [currentTab, setCurrentTab] = useState('dashboard');
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    // Check for existing authentication
    const savedToken = localStorage.getItem('token');
    const savedUser = localStorage.getItem('user');
    
    if (savedToken && savedUser) {
      setToken(savedToken);
      setUser(JSON.parse(savedUser));
      setIsAuthenticated(true);
    }
    
    setIsLoading(false);
  }, []);

  const handleLogin = (userData, userToken) => {
    setUser(userData);
    setToken(userToken);
    setIsAuthenticated(true);
  };

  const handleLogout = () => {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    setIsAuthenticated(false);
    setUser(null);
    setToken(null);
  };

  if (isLoading) {
    return (
      <div className="loading-container">
        <div className="loading">
          Loading...
        </div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return <Login onLogin={handleLogin} />;
  }

  return (
    <div className="App">
      <header className="app-header">
        <div className="header-content">
          <h1>Texon Inventory Comparison</h1>
          <div className="user-info">
            <span>Welcome, {user.username}</span>
            <button onClick={handleLogout} className="btn-logout">
              Logout
            </button>
          </div>
        </div>
        <nav>
          <button 
            className={currentTab === 'dashboard' ? 'active' : ''} 
            onClick={() => setCurrentTab('dashboard')}
          >
            Dashboard
          </button>
          <button 
            className={currentTab === 'settings' ? 'active' : ''} 
            onClick={() => setCurrentTab('settings')}
          >
            Settings
          </button>
          <button 
            className={currentTab === 'reports' ? 'active' : ''} 
            onClick={() => setCurrentTab('reports')}
          >
            Reports
          </button>
          {user.role === 'admin' && (
            <button 
              className={currentTab === 'users' ? 'active' : ''} 
              onClick={() => setCurrentTab('users')}
            >
              Users
            </button>
          )}
        </nav>
      </header>

      <main className="main-content">
        {currentTab === 'dashboard' && <Dashboard token={token} />}
        {currentTab === 'settings' && <Settings />}
        {currentTab === 'reports' && <Reports token={token} />}
        {currentTab === 'users' && <Users token={token} user={user} />}
      </main>
    </div>
  );
}

export default App;