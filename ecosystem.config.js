// PM2 ecosystem file (ecosystem.config.js) - Updated
module.exports = {
  apps: [{
	name: 'texon-inventory-comparison',
	script: 'server.js',
	instances: 1,
	autorestart: true,
	watch: false,
	max_memory_restart: '1G',
	env: {
	  NODE_ENV: 'production',
	  PORT: 3001
	},
	log_file: './logs/app.log',
	error_file: './logs/error.log',
	out_file: './logs/out.log',
	log_date_format: 'YYYY-MM-DD HH:mm Z'
  }]
};