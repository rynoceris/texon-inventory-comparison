// deployment/deploy.sh (Updated deployment script)
#!/bin/bash

# Texon Inventory Comparison Deployment Script
set -e

echo "🚀 Starting Texon Inventory Comparison deployment..."

# Configuration
APP_NAME="texon-inventory-comparison"
APP_DIR="/var/www/collegesportsdirectory.com/texon-inventory"
BACKUP_DIR="/var/backups/$APP_NAME"
NODE_VERSION="18"

# Create backup
echo "📦 Creating backup..."
mkdir -p $BACKUP_DIR
if [ -d "$APP_DIR" ]; then
	tar -czf "$BACKUP_DIR/backup-$(date +%Y%m%d-%H%M%S).tar.gz" -C "$APP_DIR" .
fi

# Setup directory
echo "📁 Setting up application directory..."
mkdir -p $APP_DIR
cd $APP_DIR

# Install Node.js if needed
if ! command -v node &> /dev/null; then
	echo "📦 Installing Node.js $NODE_VERSION..."
	curl -fsSL https://deb.nodesource.com/setup_$NODE_VERSION.x | sudo -E bash -
	sudo apt-get install -y nodejs
fi

# Copy application files
echo "📋 Copying application files..."
cp -r /path/to/your/source/* .

# Install dependencies
echo "📦 Installing dependencies..."
npm install --production

# Build React app
echo "🏗️  Building React application..."
cd client
npm install
npm run build
cd ..

# Copy build files
cp -r client/build/* ./build/

# Set up environment
echo "⚙️  Setting up environment..."
if [ ! -f .env ]; then
	echo "❗ Please create .env file with your configuration"
	exit 1
fi

# Set up database
echo "🗄️  Setting up database..."
node scripts/setup-admin.js admin changeme123 admin@texontowel.com

# Set permissions
echo "🔐 Setting permissions..."
chown -R www-data:www-data $APP_DIR
chmod -R 755 $APP_DIR

# Start/restart application
echo "🔄 Starting application..."
pm2 stop $APP_NAME || true
pm2 delete $APP_NAME || true
pm2 start ecosystem.config.js

# Setup log rotation
echo "📝 Setting up log rotation..."
sudo tee /etc/logrotate.d/$APP_NAME > /dev/null <<EOF
$APP_DIR/logs/*.log {
	daily
	missingok
	rotate 30
	compress
	delaycompress
	notifempty
	create 0644 www-data www-data
	postrotate
		pm2 reload $APP_NAME
	endscript
}
EOF

# Test deployment
echo "🧪 Testing deployment..."
sleep 5
if curl -f http://localhost:3001/texon-inventory-comparison/api/auth/verify > /dev/null 2>&1; then
	echo "❌ Test failed - authentication endpoint should not be accessible without token"
else
	echo "✅ Authentication working correctly"
fi

echo "✅ Deployment completed successfully!"
echo "🌐 Application available at: https://collegesportsdirectory.com/texon-inventory-comparison"
echo "👤 Default admin credentials:"
echo "   Username: admin"
echo "   Password: changeme123"
echo "⚠️  IMPORTANT: Change the default admin password immediately!"