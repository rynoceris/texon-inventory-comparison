// Setup instructions (SETUP.md)
# Texon Inventory Comparison Setup Guide

## Prerequisites

- Node.js 18+ installed
- Supabase account and project
- SMTP email service (Gmail, etc.)
- Nginx or Apache web server
- PM2 process manager
- SSL certificate for HTTPS

## Installation Steps

### 1. Clone and Setup Application

```bash
# Navigate to your web directory
cd /var/www/collegesportsdirectory.com/

# Create app directory
mkdir texon-inventory
cd texon-inventory

# Copy all application files here
# (server.js, client folder, package.json, etc.)

# Install dependencies
npm run install:all
```

### 2. Configure Environment Variables

```bash
# Copy and edit environment file
cp .env.example .env
nano .env

# Fill in all required values:
# - Supabase URL and key
# - Brightpearl API credentials
# - Infoplus API key
# - SMTP email settings
# - JWT secret (generate a strong 32+ character string)
```

### 3. Setup Database

```bash
# Run the SQL commands in your Supabase dashboard
# (Copy from the SQL section in the supporting files)

# Create first admin user
npm run setup-admin
# Or with custom credentials:
node scripts/setup-admin.js yourusername yourpassword your@email.com
```

### 4. Build Application

```bash
# Build the React frontend
npm run build
```

### 5. Configure Web Server

#### For Nginx:
```bash
# Add the nginx configuration to your site config
# /etc/nginx/sites-available/collegesportsdirectory.com

# Test configuration
sudo nginx -t

# Reload nginx
sudo systemctl reload nginx
```

#### For Apache:
```bash
# Add the .htaccess rules to your document root
# Configure mod_proxy for Node.js app
```

### 6. Start Application

```bash
# Install PM2 globally if not installed
npm install -g pm2

# Start the application
pm2 start ecosystem.config.js

# Save PM2 configuration
pm2 save
pm2 startup
```

### 7. Security Setup

```bash
# Set proper file permissions
sudo chown -R www-data:www-data /var/www/collegesportsdirectory.com/texon-inventory
sudo chmod -R 755 /var/www/collegesportsdirectory.com/texon-inventory

# Setup log rotation
sudo cp logrotate.conf /etc/logrotate.d/texon-inventory-comparison
```

### 8. Testing

1. Visit: `https://collegesportsdirectory.com/texon-inventory-comparison`
2. Login with your admin credentials
3. Configure settings (email recipients, SMTP)
4. Run a manual comparison test
5. Check that reports are generated and emails sent

### 9. Monitoring

```bash
# View application logs
pm2 logs texon-inventory-comparison

# Monitor application status
pm2 status

# Restart if needed
pm2 restart texon-inventory-comparison
```

## Security Features Implemented

- ✅ JWT-based authentication
- ✅ Password hashing with bcrypt
- ✅ Rate limiting on login attempts
- ✅ Search engine blocking (robots.txt + meta tags)
- ✅ Security headers
- ✅ Role-based access control
- ✅ HTTPS enforcement
- ✅ Input validation
- ✅ SQL injection protection (via Supabase)

## Scheduled Operations

The application will automatically:
- Run inventory comparisons daily at 7 PM
- Send email reports to configured recipients
- Clean up reports older than 30 days
- Rotate log files daily

## Troubleshooting

### Application won't start:
- Check Node.js version (18+)
- Verify .env file exists and is complete
- Check database connectivity
- Review PM2 logs

### Authentication issues:
- Verify JWT_SECRET is set
- Check user exists in database
- Confirm password is correct

### API integration issues:
- Test API credentials manually
- Check network connectivity
- Review API rate limits

### Email not sending:
- Verify SMTP credentials
- Check email provider settings
- Test with a simple email first

## Default Credentials

**IMPORTANT**: Change these immediately after first login!

- Username: `admin`
- Password: `changeme123`
- Email: `admin@texontowel.com`

## Support

For technical support, check:
1. Application logs: `pm2 logs texon-inventory-comparison`
2. System logs: `/var/log/nginx/error.log` or `/var/log/apache2/error.log`
3. Database logs in Supabase dashboard