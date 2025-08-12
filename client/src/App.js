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

// Enhanced Settings Component - Replace your existing Settings component with this:

function Settings({ token, user }) {
  const [settings, setSettings] = useState({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [configStatus, setConfigStatus] = useState(null);
  const [testingEmail, setTestingEmail] = useState(false);

  // Default settings structure
  const defaultSettings = {
    // Cron Job Settings
    cron_enabled: true,
    cron_schedule: '0 19 * * *', // 7:00 PM daily
    cron_timezone: 'America/New_York',
    
    // Email Settings
    email_notifications: true,
    email_recipients: '',
    email_on_zero_discrepancies: false,
    email_include_excel: false,
    
    // Report Settings
    report_retention_days: 30,
    max_discrepancies_in_email: 20,
    auto_cleanup_enabled: false,
    
    // System Settings
    api_timeout_seconds: 30,
    max_concurrent_requests: 5,
    debug_logging: false
  };

  useEffect(() => {
    loadSettings();
    loadConfigStatus();
  }, []);

  const loadSettings = async () => {
    try {
      const response = await fetch(`${API_BASE}/settings`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const data = await response.json();
      
      // Merge with defaults to ensure all settings exist
      setSettings({ ...defaultSettings, ...data });
    } catch (error) {
      console.error('Error loading settings:', error);
      setSettings(defaultSettings);
    } finally {
      setLoading(false);
    }
  };

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

  const saveSettings = async () => {
    setSaving(true);
    try {
      const response = await fetch(`${API_BASE}/settings`, {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(settings)
      });

      const data = await response.json();

      if (response.ok && data.success) {
        alert('Settings saved successfully!');
      } else {
        throw new Error(data.error || 'Failed to save settings');
      }
    } catch (error) {
      console.error('Error saving settings:', error);
      alert(`Error saving settings: ${error.message}`);
    } finally {
      setSaving(false);
    }
  };

  const testEmailConfiguration = async () => {
    setTestingEmail(true);
    try {
      const response = await fetch(`${API_BASE}/test-email`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          recipients: settings.email_recipients
        })
      });

      const data = await response.json();

      if (response.ok && data.success) {
        alert('Test email sent successfully! Check your inbox.');
      } else {
        throw new Error(data.error || 'Failed to send test email');
      }
    } catch (error) {
      console.error('Error testing email:', error);
      alert(`Error sending test email: ${error.message}`);
    } finally {
      setTestingEmail(false);
    }
  };

  const updateSetting = (key, value) => {
    setSettings(prev => ({
      ...prev,
      [key]: value
    }));
  };

  const formatCronDescription = (cronExpression) => {
    const descriptions = {
      '0 19 * * *': 'Daily at 7:00 PM',
      '0 18 * * *': 'Daily at 6:00 PM',
      '0 20 * * *': 'Daily at 8:00 PM',
      '0 17 * * *': 'Daily at 5:00 PM',
      '0 12 * * *': 'Daily at 12:00 PM (Noon)',
      '0 9 * * *': 'Daily at 9:00 AM',
      '0 19 * * 1-5': 'Weekdays at 7:00 PM',
      '0 0 * * 0': 'Weekly on Sunday at Midnight',
      '0 19 * * 0': 'Weekly on Sunday at 7:00 PM'
    };
    return descriptions[cronExpression] || 'Custom schedule';
  };

  if (user.role !== 'admin') {
    return (
      <div className="settings">
        <h2>Settings</h2>
        <div className="access-denied">
          <p>⚠️ Admin access required to modify system settings.</p>
          <p>Contact your system administrator if you need to change settings.</p>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="settings">
        <h2>Settings</h2>
        <p>Loading settings...</p>
      </div>
    );
  }

  return (
    <div className="settings">
      <div className="settings-header">
        <h2>System Settings</h2>
        <button
          onClick={saveSettings}
          disabled={saving}
          className="btn-primary save-settings-btn"
        >
          {saving ? 'Saving...' : '💾 Save Settings'}
        </button>
      </div>

      {/* Configuration Status Overview */}
      {configStatus && (
        <div className="config-overview">
          <h3>📊 System Configuration Status</h3>
          <div className="status-grid">
            <div className={`status-item ${configStatus.supabase_configured ? 'configured' : 'not-configured'}`}>
              <span className="status-icon">{configStatus.supabase_configured ? '✅' : '❌'}</span>
              <span>Database (Supabase)</span>
            </div>
            <div className={`status-item ${configStatus.brightpearl_configured ? 'configured' : 'not-configured'}`}>
              <span className="status-icon">{configStatus.brightpearl_configured ? '✅' : '⚠️'}</span>
              <span>Brightpearl API</span>
            </div>
            <div className={`status-item ${configStatus.infoplus_configured ? 'configured' : 'not-configured'}`}>
              <span className="status-icon">{configStatus.infoplus_configured ? '✅' : '⚠️'}</span>
              <span>Infoplus API</span>
            </div>
            <div className={`status-item ${configStatus.email_configured ? 'configured' : 'not-configured'}`}>
              <span className="status-icon">{configStatus.email_configured ? '✅' : '⚠️'}</span>
              <span>Email Service</span>
            </div>
          </div>
          {configStatus.overall_ready ? (
            <p className="status-message success">🎉 All systems configured and ready!</p>
          ) : (
            <p className="status-message warning">⚠️ Some services need configuration. Check environment variables.</p>
          )}
        </div>
      )}

      {/* Scheduled Comparison Settings */}
      <div className="settings-section">
        <h3>⏰ Scheduled Inventory Comparisons</h3>
        <div className="setting-group">
          <div className="setting-item">
            <label className="setting-label">
              <input
                type="checkbox"
                checked={settings.cron_enabled}
                onChange={(e) => updateSetting('cron_enabled', e.target.checked)}
              />
              Enable Automatic Daily Comparisons
            </label>
            <p className="setting-description">
              Automatically run inventory comparisons on a schedule
            </p>
          </div>

          {settings.cron_enabled && (
            <>
              <div className="setting-item">
                <label className="setting-label">Schedule</label>
                <select
                  value={settings.cron_schedule}
                  onChange={(e) => updateSetting('cron_schedule', e.target.value)}
                  className="setting-input"
                >
                  <option value="0 9 * * *">Daily at 9:00 AM</option>
                  <option value="0 12 * * *">Daily at 12:00 PM (Noon)</option>
                  <option value="0 17 * * *">Daily at 5:00 PM</option>
                  <option value="0 18 * * *">Daily at 6:00 PM</option>
                  <option value="0 19 * * *">Daily at 7:00 PM</option>
                  <option value="0 20 * * *">Daily at 8:00 PM</option>
                  <option value="0 19 * * 1-5">Weekdays at 7:00 PM</option>
                  <option value="0 19 * * 0">Weekly on Sunday at 7:00 PM</option>
                </select>
                <p className="setting-description">
                  Current: {formatCronDescription(settings.cron_schedule)}
                </p>
              </div>

              <div className="setting-item">
                <label className="setting-label">Timezone</label>
                <select
                  value={settings.cron_timezone}
                  onChange={(e) => updateSetting('cron_timezone', e.target.value)}
                  className="setting-input"
                >
                  <option value="America/New_York">Eastern Time (EST/EDT)</option>
                  <option value="America/Chicago">Central Time (CST/CDT)</option>
                  <option value="America/Denver">Mountain Time (MST/MDT)</option>
                  <option value="America/Los_Angeles">Pacific Time (PST/PDT)</option>
                  <option value="UTC">UTC (Universal Time)</option>
                </select>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Email Notification Settings */}
      <div className="settings-section">
        <h3>📧 Email Notifications</h3>
        <div className="setting-group">
          <div className="setting-item">
            <label className="setting-label">
              <input
                type="checkbox"
                checked={settings.email_notifications}
                onChange={(e) => updateSetting('email_notifications', e.target.checked)}
              />
              Enable Email Notifications
            </label>
            <p className="setting-description">
              Send email reports when inventory comparisons complete
            </p>
          </div>

          {settings.email_notifications && (
            <>
              <div className="setting-item">
                <label className="setting-label">Email Recipients</label>
                <input
                  type="text"
                  value={settings.email_recipients}
                  onChange={(e) => updateSetting('email_recipients', e.target.value)}
                  placeholder="email1@company.com, email2@company.com"
                  className="setting-input"
                />
                <p className="setting-description">
                  Comma-separated list of email addresses to receive reports
                </p>
              </div>

              <div className="setting-item">
                <label className="setting-label">
                  <input
                    type="checkbox"
                    checked={settings.email_on_zero_discrepancies}
                    onChange={(e) => updateSetting('email_on_zero_discrepancies', e.target.checked)}
                  />
                  Email even when no discrepancies found
                </label>
                <p className="setting-description">
                  Send confirmation emails even when inventory matches perfectly
                </p>
              </div>

              <div className="setting-item">
                <label className="setting-label">Max Discrepancies in Email</label>
                <input
                  type="number"
                  value={settings.max_discrepancies_in_email}
                  onChange={(e) => updateSetting('max_discrepancies_in_email', parseInt(e.target.value))}
                  min="5"
                  max="100"
                  className="setting-input"
                />
                <p className="setting-description">
                  Maximum number of discrepancies to include in email body (others will be noted as "see Excel")
                </p>
              </div>

              <div className="setting-item email-test">
                <button
                  onClick={testEmailConfiguration}
                  disabled={testingEmail || !settings.email_recipients}
                  className="btn-secondary"
                >
                  {testingEmail ? 'Sending...' : '📧 Send Test Email'}
                </button>
                <p className="setting-description">
                  Send a test email to verify configuration
                </p>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Report Management Settings */}
      <div className="settings-section">
        <h3>📊 Report Management</h3>
        <div className="setting-group">
          <div className="setting-item">
            <label className="setting-label">Report Retention (Days)</label>
            <input
              type="number"
              value={settings.report_retention_days}
              onChange={(e) => updateSetting('report_retention_days', parseInt(e.target.value))}
              min="1"
              max="365"
              className="setting-input"
            />
            <p className="setting-description">
              How many days to keep old reports before they can be cleaned up
            </p>
          </div>

          <div className="setting-item">
            <label className="setting-label">
              <input
                type="checkbox"
                checked={settings.auto_cleanup_enabled}
                onChange={(e) => updateSetting('auto_cleanup_enabled', e.target.checked)}
              />
              Enable Automatic Report Cleanup
            </label>
            <p className="setting-description">
              Automatically delete reports older than retention period (keeps at least the most recent)
            </p>
          </div>
        </div>
      </div>

      {/* System Performance Settings */}
      <div className="settings-section">
        <h3>⚙️ System Performance</h3>
        <div className="setting-group">
          <div className="setting-item">
            <label className="setting-label">API Timeout (Seconds)</label>
            <input
              type="number"
              value={settings.api_timeout_seconds}
              onChange={(e) => updateSetting('api_timeout_seconds', parseInt(e.target.value))}
              min="10"
              max="300"
              className="setting-input"
            />
            <p className="setting-description">
              How long to wait for API responses before timing out
            </p>
          </div>

          <div className="setting-item">
            <label className="setting-label">Max Concurrent Requests</label>
            <input
              type="number"
              value={settings.max_concurrent_requests}
              onChange={(e) => updateSetting('max_concurrent_requests', parseInt(e.target.value))}
              min="1"
              max="20"
              className="setting-input"
            />
            <p className="setting-description">
              Maximum number of simultaneous API requests (higher = faster but more load)
            </p>
          </div>

          <div className="setting-item">
            <label className="setting-label">
              <input
                type="checkbox"
                checked={settings.debug_logging}
                onChange={(e) => updateSetting('debug_logging', e.target.checked)}
              />
              Enable Debug Logging
            </label>
            <p className="setting-description">
              Log detailed debugging information (may impact performance)
            </p>
          </div>
        </div>
      </div>

      {/* Save Button at Bottom */}
      <div className="settings-footer">
        <button
          onClick={saveSettings}
          disabled={saving}
          className="btn-primary save-settings-btn"
        >
          {saving ? 'Saving Settings...' : '💾 Save All Settings'}
        </button>
        <p className="save-note">
          Changes take effect immediately. Some settings may require a server restart.
        </p>
      </div>
    </div>
  );
}

// Replace the Reports component in your client/src/App.js with this enhanced version:

function Reports({ token, user }) {
  const [reports, setReports] = useState([]);
  const [loading, setLoading] = useState(true);
  const [expandedReports, setExpandedReports] = useState(new Set());
  const [pagination, setPagination] = useState({}); // Track pagination for each report
  const [downloadingReports, setDownloadingReports] = useState(new Set());
  const [deletingReports, setDeletingReports] = useState(new Set());
  const [deletingAll, setDeletingAll] = useState(false);

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

  const deleteReport = async (report) => {
    const confirmMessage = `Are you sure you want to delete the report from ${report.date}?\n\nThis action cannot be undone.`;
    
    if (!window.confirm(confirmMessage)) {
      return;
    }

    const reportId = report.id;
    setDeletingReports(prev => new Set(prev).add(reportId));

    try {
      const response = await fetch(`${API_BASE}/reports/${reportId}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` }
      });

      const data = await response.json();

      if (response.ok && data.success) {
        // Remove the report from the local state
        setReports(prev => prev.filter(r => r.id !== reportId));
        
        // Also remove from expanded reports if it was expanded
        setExpandedReports(prev => {
          const newSet = new Set(prev);
          newSet.delete(reportId);
          return newSet;
        });

        alert(`Report from ${report.date} has been deleted successfully.`);
      } else {
        throw new Error(data.error || 'Failed to delete report');
      }
    } catch (error) {
      console.error('Error deleting report:', error);
      alert(`Failed to delete report: ${error.message}`);
    } finally {
      setDeletingReports(prev => {
        const newSet = new Set(prev);
        newSet.delete(reportId);
        return newSet;
      });
    }
  };

  const deleteAllReports = async () => {
    if (reports.length === 0) {
      alert('No reports to delete.');
      return;
    }

    const confirmMessage = `Are you sure you want to delete ALL ${reports.length} reports?\n\nThis will permanently delete all inventory comparison reports and cannot be undone.`;
    
    if (!window.confirm(confirmMessage)) {
      return;
    }

    // Double confirmation for such a destructive action
    const doubleConfirm = window.confirm(`FINAL CONFIRMATION:\n\nThis will delete ALL ${reports.length} reports permanently.\n\nClick OK to proceed with deletion.`);
    
    if (!doubleConfirm) {
      return;
    }

    setDeletingAll(true);

    try {
      let deletedCount = 0;
      let failedCount = 0;
      const totalReports = reports.length;

      // Delete reports one by one to handle any individual failures
      for (const report of reports) {
        try {
          const response = await fetch(`${API_BASE}/reports/${report.id}`, {
            method: 'DELETE',
            headers: { 'Authorization': `Bearer ${token}` }
          });

          const data = await response.json();

          if (response.ok && data.success) {
            deletedCount++;
          } else {
            failedCount++;
            console.error(`Failed to delete report ${report.id}:`, data.error);
          }
        } catch (error) {
          failedCount++;
          console.error(`Error deleting report ${report.id}:`, error);
        }
      }

      // Refresh the reports list
      await loadReports();

      // Show results
      if (deletedCount === totalReports) {
        alert(`Successfully deleted all ${deletedCount} reports.`);
      } else if (deletedCount > 0) {
        alert(`Deleted ${deletedCount} reports successfully.\n${failedCount} reports failed to delete.`);
      } else {
        alert(`Failed to delete any reports. Please try again or contact support.`);
      }

    } catch (error) {
      console.error('Error during bulk deletion:', error);
      alert(`Error during deletion: ${error.message}`);
      // Refresh the list to see current state
      await loadReports();
    } finally {
      setDeletingAll(false);
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
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
        <h2>Reports History (Last 30 Days)</h2>
        
        {/* Delete All Reports Button - Only show for admin users and when there are reports */}
        {user && user.role === 'admin' && reports.length > 0 && (
          <button
            onClick={deleteAllReports}
            disabled={deletingAll}
            style={{
              padding: '10px 20px',
              backgroundColor: '#dc3545',
              color: 'white',
              border: 'none',
              borderRadius: '4px',
              cursor: deletingAll ? 'not-allowed' : 'pointer',
              fontSize: '14px',
              fontWeight: 'bold',
              opacity: deletingAll ? 0.6 : 1
            }}
          >
            {deletingAll ? '🗑️ Deleting All...' : `🗑️ Delete All Reports (${reports.length})`}
          </button>
        )}
      </div>

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
                
                <div style={{ display: 'flex', gap: '8px' }}>
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

                  {/* Delete Individual Report Button - Only show for admin users */}
                  {user && user.role === 'admin' && (
                    <button
                      onClick={() => deleteReport(report)}
                      disabled={deletingReports.has(report.id)}
                      style={{
                        padding: '6px 12px',
                        backgroundColor: '#dc3545',
                        color: 'white',
                        border: 'none',
                        borderRadius: '4px',
                        cursor: deletingReports.has(report.id) ? 'not-allowed' : 'pointer',
                        fontSize: '12px',
                        opacity: deletingReports.has(report.id) ? 0.6 : 1
                      }}
                    >
                      {deletingReports.has(report.id) ? '🗑️ Deleting...' : '🗑️ Delete'}
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

// Enhanced Users Component - Replace your existing Users component with this:

function Users({ token, user }) {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editingUser, setEditingUser] = useState(null);
  const [showAddUser, setShowAddUser] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

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

  const handleEditUser = (userToEdit) => {
    setEditingUser({
      id: userToEdit.id,
      username: userToEdit.username,
      email: userToEdit.email || '',
      first_name: userToEdit.first_name || '',
      last_name: userToEdit.last_name || '',
      role: userToEdit.role,
      is_active: userToEdit.is_active,
      password: '', // Always start with empty password
      confirmPassword: ''
    });
  };

  const handleAddUser = () => {
    setShowAddUser(true);
    setEditingUser({
      username: '',
      email: '',
      first_name: '',
      last_name: '',
      role: 'user',
      is_active: true,
      password: '',
      confirmPassword: ''
    });
  };

  const handleSaveUser = async (e) => {
    e.preventDefault();
    setIsSubmitting(true);

    try {
      // Validation
      if (!editingUser.username.trim()) {
        alert('Username is required');
        return;
      }

      if (!editingUser.email.trim()) {
        alert('Email is required');
        return;
      }

      if (!editingUser.first_name.trim()) {
        alert('First name is required');
        return;
      }

      if (!editingUser.last_name.trim()) {
        alert('Last name is required');
        return;
      }

      // For new users, password is required
      if (showAddUser && !editingUser.password) {
        alert('Password is required for new users');
        return;
      }

      // If password is being changed, validate it
      if (editingUser.password) {
        if (editingUser.password.length < 6) {
          alert('Password must be at least 6 characters long');
          return;
        }

        if (editingUser.password !== editingUser.confirmPassword) {
          alert('Passwords do not match');
          return;
        }
      }

      const userData = {
        username: editingUser.username.trim(),
        email: editingUser.email.trim(),
        first_name: editingUser.first_name.trim(),
        last_name: editingUser.last_name.trim(),
        role: editingUser.role,
        is_active: editingUser.is_active
      };

      // Only include password if it's being set
      if (editingUser.password) {
        userData.password = editingUser.password;
      }

      const url = showAddUser 
        ? `${API_BASE}/users`
        : `${API_BASE}/users/${editingUser.id}`;
      
      const method = showAddUser ? 'POST' : 'PUT';

      const response = await fetch(url, {
        method: method,
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(userData)
      });

      const data = await response.json();

      if (response.ok && data.success) {
        alert(showAddUser ? 'User created successfully!' : 'User updated successfully!');
        setEditingUser(null);
        setShowAddUser(false);
        await loadUsers(); // Refresh the list
      } else {
        throw new Error(data.error || 'Failed to save user');
      }
    } catch (error) {
      console.error('Error saving user:', error);
      alert(`Error: ${error.message}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDeleteUser = async (userToDelete) => {
    if (userToDelete.id === user.id) {
      alert('You cannot delete your own account');
      return;
    }

    const confirmMessage = `Are you sure you want to delete user "${userToDelete.username}"?\n\nThis action cannot be undone.`;
    
    if (!window.confirm(confirmMessage)) {
      return;
    }

    try {
      const response = await fetch(`${API_BASE}/users/${userToDelete.id}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` }
      });

      const data = await response.json();

      if (response.ok && data.success) {
        alert('User deleted successfully');
        await loadUsers();
      } else {
        throw new Error(data.error || 'Failed to delete user');
      }
    } catch (error) {
      console.error('Error deleting user:', error);
      alert(`Error: ${error.message}`);
    }
  };

  const cancelEdit = () => {
    setEditingUser(null);
    setShowAddUser(false);
  };

  if (user.role !== 'admin') {
    return <div>Access denied. Admin privileges required.</div>;
  }

  if (loading) {
    return <div>Loading users...</div>;
  }

  return (
    <div className="users">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
        <h2>User Management</h2>
        <button
          onClick={handleAddUser}
          style={{
            padding: '10px 20px',
            backgroundColor: '#28a745',
            color: 'white',
            border: 'none',
            borderRadius: '4px',
            cursor: 'pointer',
            fontSize: '14px',
            fontWeight: 'bold'
          }}
        >
          ➕ Add New User
        </button>
      </div>

      {/* Edit/Add User Form */}
      {editingUser && (
        <div className="user-form-overlay">
          <div className="user-form">
            <h3>{showAddUser ? 'Add New User' : `Edit User: ${editingUser.username}`}</h3>
            
            <form onSubmit={handleSaveUser}>
              <div className="form-row">
                <div className="form-group">
                  <label>Username *</label>
                  <input
                    type="text"
                    value={editingUser.username}
                    onChange={(e) => setEditingUser({...editingUser, username: e.target.value})}
                    required
                    disabled={!showAddUser} // Username can't be changed for existing users
                  />
                </div>
                
                <div className="form-group">
                  <label>Email *</label>
                  <input
                    type="email"
                    value={editingUser.email}
                    onChange={(e) => setEditingUser({...editingUser, email: e.target.value})}
                    required
                  />
                </div>
              </div>

              <div className="form-row">
                <div className="form-group">
                  <label>First Name *</label>
                  <input
                    type="text"
                    value={editingUser.first_name}
                    onChange={(e) => setEditingUser({...editingUser, first_name: e.target.value})}
                    required
                  />
                </div>
                
                <div className="form-group">
                  <label>Last Name *</label>
                  <input
                    type="text"
                    value={editingUser.last_name}
                    onChange={(e) => setEditingUser({...editingUser, last_name: e.target.value})}
                    required
                  />
                </div>
              </div>

              <div className="form-row">
                <div className="form-group">
                  <label>Role</label>
                  <select
                    value={editingUser.role}
                    onChange={(e) => setEditingUser({...editingUser, role: e.target.value})}
                  >
                    <option value="user">User</option>
                    <option value="admin">Admin</option>
                  </select>
                </div>
                
                <div className="form-group">
                  <label>Status</label>
                  <select
                    value={editingUser.is_active}
                    onChange={(e) => setEditingUser({...editingUser, is_active: e.target.value === 'true'})}
                  >
                    <option value="true">Active</option>
                    <option value="false">Inactive</option>
                  </select>
                </div>
              </div>

              <div className="form-row">
                <div className="form-group">
                  <label>{showAddUser ? 'Password *' : 'New Password (leave blank to keep current)'}</label>
                  <input
                    type="password"
                    value={editingUser.password}
                    onChange={(e) => setEditingUser({...editingUser, password: e.target.value})}
                    required={showAddUser}
                    minLength="6"
                  />
                </div>
                
                <div className="form-group">
                  <label>Confirm Password</label>
                  <input
                    type="password"
                    value={editingUser.confirmPassword}
                    onChange={(e) => setEditingUser({...editingUser, confirmPassword: e.target.value})}
                    required={showAddUser || editingUser.password}
                  />
                </div>
              </div>

              <div className="form-actions">
                <button
                  type="button"
                  onClick={cancelEdit}
                  disabled={isSubmitting}
                  style={{
                    padding: '10px 20px',
                    backgroundColor: '#6c757d',
                    color: 'white',
                    border: 'none',
                    borderRadius: '4px',
                    cursor: 'pointer',
                    marginRight: '10px'
                  }}
                >
                  Cancel
                </button>
                
                <button
                  type="submit"
                  disabled={isSubmitting}
                  style={{
                    padding: '10px 20px',
                    backgroundColor: '#007bff',
                    color: 'white',
                    border: 'none',
                    borderRadius: '4px',
                    cursor: 'pointer'
                  }}
                >
                  {isSubmitting ? 'Saving...' : (showAddUser ? 'Create User' : 'Update User')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Users List */}
      <div className="users-list">
        {users.map(u => (
          <div key={u.id} className="user-card">
            <div className="user-info">
              <div className="user-header">
                <strong>{u.first_name} {u.last_name}</strong>
                <span className={`user-role ${u.role}`}>{u.role}</span>
                {!u.is_active && <span className="user-status inactive">Inactive</span>}
              </div>
              
              <div className="user-details">
                <div><strong>Username:</strong> {u.username}</div>
                <div><strong>Email:</strong> {u.email || 'Not set'}</div>
                <div><strong>Last login:</strong> {u.last_login ? new Date(u.last_login).toLocaleString() : 'Never'}</div>
                <div><strong>Created:</strong> {new Date(u.created_at).toLocaleDateString()}</div>
              </div>
            </div>
            
            <div className="user-actions">
              <button
                onClick={() => handleEditUser(u)}
                style={{
                  padding: '6px 12px',
                  backgroundColor: '#007bff',
                  color: 'white',
                  border: 'none',
                  borderRadius: '4px',
                  cursor: 'pointer',
                  fontSize: '12px',
                  marginRight: '8px'
                }}
              >
                ✏️ Edit
              </button>
              
              {u.id !== user.id && (
                <button
                  onClick={() => handleDeleteUser(u)}
                  style={{
                    padding: '6px 12px',
                    backgroundColor: '#dc3545',
                    color: 'white',
                    border: 'none',
                    borderRadius: '4px',
                    cursor: 'pointer',
                    fontSize: '12px'
                  }}
                >
                  🗑️ Delete
                </button>
              )}
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
      try {
        const userData = JSON.parse(savedUser);
        setToken(savedToken);
        setUser(userData);
        setIsAuthenticated(true);
      } catch (error) {
        // If there's an error parsing the saved user data, clear it
        localStorage.removeItem('token');
        localStorage.removeItem('user');
      }
    }
    
    setIsLoading(false);
  }, []);

  const handleLogin = (userData, userToken) => {
    setUser(userData);
    setToken(userToken);
    setIsAuthenticated(true);
    
    // Update localStorage with the new user data structure
    localStorage.setItem('user', JSON.stringify(userData));
    localStorage.setItem('token', userToken);
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
            <span>Welcome, {user.first_name || user.username}</span>
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
        {currentTab === 'settings' && <Settings token={token} user={user} />}
        {currentTab === 'reports' && <Reports token={token} user={user} />}
        {currentTab === 'users' && <Users token={token} user={user} />}
      </main>
    </div>
  );
}

export default App;