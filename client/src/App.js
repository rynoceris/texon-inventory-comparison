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
    setComparisonResult({ message: '🔄 Starting inventory comparison...' });
  
    try {
      // Start the comparison (don't wait for completion)
      fetch(`${API_BASE}/run-comparison`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` }
      }).catch(err => {
        console.log('Background comparison may have completed despite error:', err);
      });
  
      // Remember the start time to identify new reports
      const comparisonStartTime = new Date();
  
      // Poll for results every 10 seconds
      let attempts = 0;
      const maxAttempts = 36; // 6 minutes total (36 * 10 seconds)
  
      const pollForResults = async () => {
        attempts++;
  
        try {
          // Check for new reports
          const reportsResponse = await fetch(`${API_BASE}/latest-report`, {
            headers: { 'Authorization': `Bearer ${token}` }
          });
  
          if (reportsResponse.ok) {
            const latestReport = await reportsResponse.json();
  
            // Check if this is a new report (created after we started)
            if (latestReport && latestReport.created_at) {
              const reportTime = new Date(latestReport.created_at);
  
              if (reportTime > comparisonStartTime) {
              // New report found! Comparison completed successfully
              
              // Safely parse discrepancies with error handling
              let discrepancies = [];
              try {
                if (latestReport.discrepancies) {
                  // Check if it's already an object/array
                  if (typeof latestReport.discrepancies === 'string') {
                    discrepancies = JSON.parse(latestReport.discrepancies);
                  } else if (Array.isArray(latestReport.discrepancies)) {
                    discrepancies = latestReport.discrepancies;
                  } else {
                    console.log('Discrepancies is an object:', latestReport.discrepancies);
                    discrepancies = [];
                  }
                }
              } catch (parseError) {
                console.error('Error parsing discrepancies:', parseError);
                console.log('Raw discrepancies data:', latestReport.discrepancies);
                discrepancies = [];
              }
              
              const successResult = {
                success: true,
                totalDiscrepancies: latestReport.total_discrepancies,
                brightpearlItems: latestReport.brightpearl_total_items,
                infoplusItems: latestReport.infoplus_total_items,
                discrepancies: discrepancies,
                message: `✅ Comparison completed! Found ${latestReport.total_discrepancies} discrepancies.`
              };
  
                setComparisonResult(successResult);
                setLatestReport(latestReport); // Update the latest report display
                setIsRunning(false);
                return; // Success - stop polling
              }
            }
          }
  
          // Not completed yet, continue polling if we haven't exceeded max attempts
          if (attempts < maxAttempts) {
            const elapsed = Math.floor(attempts * 10);
            setComparisonResult({ 
              message: `🔄 Comparison in progress... (${elapsed}s elapsed)` 
            });
            setTimeout(pollForResults, 10000); // Check again in 10 seconds
          } else {
            // Timed out
            setComparisonResult({ 
              message: '⏰ Comparison is taking longer than expected. Please check the Reports tab manually in a few minutes.',
              error: 'Timeout - comparison may still be running in background'
            });
            setIsRunning(false);
          }
  
        } catch (pollError) {
          console.error('Polling error:', pollError);
          
          if (attempts < maxAttempts) {
            // Continue polling despite the error
            setTimeout(pollForResults, 10000);
          } else {
            setComparisonResult({ 
              message: '⚠️ Unable to check comparison status. Please check the Reports tab manually.',
              error: 'Failed to poll for results'
            });
            setIsRunning(false);
          }
        }
      };
  
      // Start polling after 30 seconds (give the comparison time to get started)
      setTimeout(pollForResults, 30000);
  
    } catch (error) {
      console.error('Comparison startup failed:', error);
      setComparisonResult({ 
        message: '❌ Failed to start comparison',
        error: error.message 
      });
      setIsRunning(false);
    }
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

// Replace the Reports component in your client/src/App.js with this enhanced version:

function Reports({ token }) {
  const [reports, setReports] = useState([]);
  const [loading, setLoading] = useState(true);
  const [expandedReports, setExpandedReports] = useState(new Set());
  const [pagination, setPagination] = useState({}); // Track pagination for each report
  const [downloadingReports, setDownloadingReports] = useState(new Set());

  useEffect(() => {
    loadReports();
  }, []);

  const loadReports = async () => {
    try {
      const response = await fetch(`${API_BASE}/reports`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const data = await response.json();
      
      // Parse discrepancies for each report
      const parsedReports = data.map(report => ({
        ...report,
        discrepancies: (() => {
          try {
            if (typeof report.discrepancies === 'string') {
              return JSON.parse(report.discrepancies);
            } else if (Array.isArray(report.discrepancies)) {
              return report.discrepancies;
            } else {
              return [];
            }
          } catch (e) {
            console.error('Error parsing discrepancies for report:', report.id, e);
            return [];
          }
        })()
      }));
      
      setReports(parsedReports);
      
      // Initialize pagination for each report (start with page 1)
      const initialPagination = {};
      parsedReports.forEach(report => {
        initialPagination[report.id] = { currentPage: 1, itemsPerPage: 25 };
      });
      setPagination(initialPagination);
      
    } catch (error) {
      console.error('Error loading reports:', error);
    } finally {
      setLoading(false);
    }
  };

  const toggleReportExpansion = (reportId) => {
    const newExpanded = new Set(expandedReports);
    if (newExpanded.has(reportId)) {
      newExpanded.delete(reportId);
    } else {
      newExpanded.add(reportId);
    }
    setExpandedReports(newExpanded);
  };

  const changePage = (reportId, newPage) => {
    setPagination(prev => ({
      ...prev,
      [reportId]: {
        ...prev[reportId],
        currentPage: newPage
      }
    }));
  };

  const getPaginatedDiscrepancies = (discrepancies, reportId) => {
    const pageInfo = pagination[reportId] || { currentPage: 1, itemsPerPage: 25 };
    const startIndex = (pageInfo.currentPage - 1) * pageInfo.itemsPerPage;
    const endIndex = startIndex + pageInfo.itemsPerPage;
    return discrepancies.slice(startIndex, endIndex);
  };

  const getTotalPages = (discrepancies, reportId) => {
    const pageInfo = pagination[reportId] || { currentPage: 1, itemsPerPage: 25 };
    return Math.ceil(discrepancies.length / pageInfo.itemsPerPage);
  };

  const downloadExcelReport = async (report) => {
    const reportId = report.id;
    setDownloadingReports(prev => new Set(prev).add(reportId));

    try {
      const response = await fetch(`${API_BASE}/reports/${reportId}/excel`, {
        method: 'GET',
        headers: { 'Authorization': `Bearer ${token}` }
      });

      if (!response.ok) {
        throw new Error(`Failed to download report: ${response.statusText}`);
      }

      // Get the blob data
      const blob = await response.blob();
      
      // Create download link
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `inventory-report-${report.date}-${reportId}.xlsx`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);

    } catch (error) {
      console.error('Error downloading Excel report:', error);
      alert(`Failed to download report: ${error.message}`);
    } finally {
      setDownloadingReports(prev => {
        const newSet = new Set(prev);
        newSet.delete(reportId);
        return newSet;
      });
    }
  };

  const renderPagination = (discrepancies, reportId) => {
    const totalPages = getTotalPages(discrepancies, reportId);
    const currentPage = pagination[reportId]?.currentPage || 1;

    if (totalPages <= 1) return null;

    const pages = [];
    const maxVisiblePages = 5;
    let startPage = Math.max(1, currentPage - Math.floor(maxVisiblePages / 2));
    let endPage = Math.min(totalPages, startPage + maxVisiblePages - 1);

    // Adjust start page if we're near the end
    if (endPage - startPage + 1 < maxVisiblePages) {
      startPage = Math.max(1, endPage - maxVisiblePages + 1);
    }

    return (
      <div className="pagination" style={{ margin: '20px 0', display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '10px' }}>
        <button 
          onClick={() => changePage(reportId, 1)}
          disabled={currentPage === 1}
          style={{ padding: '8px 12px', border: '1px solid #ddd', background: currentPage === 1 ? '#f5f5f5' : 'white', cursor: currentPage === 1 ? 'not-allowed' : 'pointer' }}
        >
          First
        </button>
        
        <button 
          onClick={() => changePage(reportId, currentPage - 1)}
          disabled={currentPage === 1}
          style={{ padding: '8px 12px', border: '1px solid #ddd', background: currentPage === 1 ? '#f5f5f5' : 'white', cursor: currentPage === 1 ? 'not-allowed' : 'pointer' }}
        >
          Previous
        </button>

        {Array.from({ length: endPage - startPage + 1 }, (_, i) => startPage + i).map(page => (
          <button
            key={page}
            onClick={() => changePage(reportId, page)}
            style={{
              padding: '8px 12px',
              border: '1px solid #ddd',
              background: page === currentPage ? '#007bff' : 'white',
              color: page === currentPage ? 'white' : 'black',
              cursor: 'pointer'
            }}
          >
            {page}
          </button>
        ))}

        <button 
          onClick={() => changePage(reportId, currentPage + 1)}
          disabled={currentPage === totalPages}
          style={{ padding: '8px 12px', border: '1px solid #ddd', background: currentPage === totalPages ? '#f5f5f5' : 'white', cursor: currentPage === totalPages ? 'not-allowed' : 'pointer' }}
        >
          Next
        </button>
        
        <button 
          onClick={() => changePage(reportId, totalPages)}
          disabled={currentPage === totalPages}
          style={{ padding: '8px 12px', border: '1px solid #ddd', background: currentPage === totalPages ? '#f5f5f5' : 'white', cursor: currentPage === totalPages ? 'not-allowed' : 'pointer' }}
        >
          Last
        </button>

        <span style={{ marginLeft: '20px', fontSize: '14px', color: '#666' }}>
          Page {currentPage} of {totalPages} ({discrepancies.length} total discrepancies)
        </span>
      </div>
    );
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
              <div className="report-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '15px' }}>
                  <span className="report-date">{report.date}</span>
                  <span className={`discrepancies-badge ${report.total_discrepancies > 0 ? 'has-discrepancies' : 'no-discrepancies'}`}>
                    {report.total_discrepancies} discrepancies
                  </span>
                  <span className="report-time">{new Date(report.created_at).toLocaleString()}</span>
                </div>
                
                <div style={{ display: 'flex', gap: '10px' }}>
                  <button
                    onClick={() => downloadExcelReport(report)}
                    disabled={downloadingReports.has(report.id)}
                    style={{
                      padding: '6px 12px',
                      backgroundColor: '#28a745',
                      color: 'white',
                      border: 'none',
                      borderRadius: '4px',
                      cursor: downloadingReports.has(report.id) ? 'not-allowed' : 'pointer',
                      fontSize: '12px',
                      opacity: downloadingReports.has(report.id) ? 0.6 : 1
                    }}
                  >
                    {downloadingReports.has(report.id) ? '📥 Downloading...' : '📊 Download Excel'}
                  </button>
                  
                  {report.total_discrepancies > 0 && (
                    <button
                      onClick={() => toggleReportExpansion(report.id)}
                      style={{
                        padding: '6px 12px',
                        backgroundColor: '#007bff',
                        color: 'white',
                        border: 'none',
                        borderRadius: '4px',
                        cursor: 'pointer',
                        fontSize: '12px'
                      }}
                    >
                      {expandedReports.has(report.id) ? '▼ Hide Details' : '▶ View Details'}
                    </button>
                  )}
                </div>
              </div>

              {report.total_discrepancies > 0 && expandedReports.has(report.id) && (
                <div className="report-details">
                  <div className="discrepancies-summary">
                    <h4>Inventory Discrepancies</h4>
                    
                    {renderPagination(report.discrepancies, report.id)}
                    
                    <table style={{ width: '100%', borderCollapse: 'collapse', margin: '10px 0' }}>
                      <thead>
                        <tr style={{ backgroundColor: '#f8f9fa' }}>
                          <th style={{ border: '1px solid #dee2e6', padding: '12px', textAlign: 'left' }}>SKU</th>
                          <th style={{ border: '1px solid #dee2e6', padding: '12px', textAlign: 'left' }}>Product</th>
                          <th style={{ border: '1px solid #dee2e6', padding: '12px', textAlign: 'right' }}>Brightpearl</th>
                          <th style={{ border: '1px solid #dee2e6', padding: '12px', textAlign: 'right' }}>Infoplus</th>
                          <th style={{ border: '1px solid #dee2e6', padding: '12px', textAlign: 'right' }}>Difference</th>
                          <th style={{ border: '1px solid #dee2e6', padding: '12px', textAlign: 'right' }}>% Diff</th>
                        </tr>
                      </thead>
                      <tbody>
                        {getPaginatedDiscrepancies(report.discrepancies, report.id).map((item, itemIndex) => (
                          <tr key={itemIndex} style={{ backgroundColor: itemIndex % 2 === 0 ? 'white' : '#f8f9fa' }}>
                            <td style={{ border: '1px solid #dee2e6', padding: '10px', fontWeight: 'bold' }}>{item.sku}</td>
                            <td style={{ border: '1px solid #dee2e6', padding: '10px' }}>{item.productName || 'N/A'}</td>
                            <td style={{ border: '1px solid #dee2e6', padding: '10px', textAlign: 'right' }}>{item.brightpearl_stock}</td>
                            <td style={{ border: '1px solid #dee2e6', padding: '10px', textAlign: 'right' }}>{item.infoplus_stock}</td>
                            <td style={{ 
                              border: '1px solid #dee2e6', 
                              padding: '10px', 
                              textAlign: 'right',
                              color: item.difference < 0 ? 'red' : 'green',
                              fontWeight: 'bold'
                            }}>
                              {item.difference > 0 ? '+' : ''}{item.difference}
                            </td>
                            <td style={{ border: '1px solid #dee2e6', padding: '10px', textAlign: 'right' }}>
                              {item.percentage_diff ? `${item.percentage_diff}%` : 'N/A'}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    
                    {renderPagination(report.discrepancies, report.id)}
                  </div>
                </div>
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