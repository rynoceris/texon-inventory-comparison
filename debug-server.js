// debug-server.js
// Quick script to debug server issues

require('dotenv').config();
const path = require('path');
const fs = require('fs');

console.log('🔍 Debugging Texon Inventory Server...\n');

// Check environment variables
console.log('📋 Environment Variables:');
const requiredVars = ['SUPABASE_URL', 'SUPABASE_ANON_KEY', 'JWT_SECRET'];
const optionalVars = ['BRIGHTPEARL_ACCOUNT', 'INFOPLUS_API_KEY', 'SMTP_HOST'];

requiredVars.forEach(varName => {
	const value = process.env[varName];
	console.log(`  ${varName}: ${value ? '✅ Set' : '❌ Missing'}`);
});

console.log('\n📋 Optional Variables:');
optionalVars.forEach(varName => {
	const value = process.env[varName];
	console.log(`  ${varName}: ${value ? '✅ Set' : '⚠️ Not set'}`);
});

// Check files
console.log('\n📁 File Structure:');
const checkFile = (filePath, description) => {
	const exists = fs.existsSync(filePath);
	console.log(`  ${description}: ${exists ? '✅ Found' : '❌ Missing'} (${filePath})`);
	return exists;
};

checkFile('./server.js', 'Server file');
checkFile('./package.json', 'Package.json');
checkFile('./.env', 'Environment file');
checkFile('./build', 'Build directory');
checkFile('./build/index.html', 'React index.html');
checkFile('./build/static', 'Static assets');

// Check dependencies
console.log('\n📦 Dependencies:');
try {
	const packageJson = JSON.parse(fs.readFileSync('./package.json', 'utf8'));
	const deps = Object.keys(packageJson.dependencies || {});
	
	deps.forEach(dep => {
		try {
			require.resolve(dep);
			console.log(`  ${dep}: ✅ Installed`);
		} catch (error) {
			console.log(`  ${dep}: ❌ Missing`);
		}
	});
} catch (error) {
	console.log('  ❌ Could not read package.json');
}

// Check ports
console.log('\n🌐 Network:');
const port = process.env.PORT || 3001;
console.log(`  Target port: ${port}`);

// Test basic server startup
console.log('\n🧪 Basic Server Test:');
try {
	const express = require('express');
	const app = express();
	
	app.get('/test', (req, res) => {
		res.json({ status: 'OK', timestamp: new Date().toISOString() });
	});
	
	const server = app.listen(port + 1, '0.0.0.0', () => {
		console.log('  ✅ Express server can start successfully');
		server.close();
	});
	
	server.on('error', (error) => {
		console.log(`  ❌ Server startup error: ${error.message}`);
	});
	
} catch (error) {
	console.log(`  ❌ Express test failed: ${error.message}`);
}

// Test Supabase connection
console.log('\n🗄️ Database Test:');
if (process.env.SUPABASE_URL && process.env.SUPABASE_ANON_KEY) {
	try {
		const { createClient } = require('@supabase/supabase-js');
		const supabase = createClient(
			process.env.SUPABASE_URL,
			process.env.SUPABASE_ANON_KEY
		);
		console.log('  ✅ Supabase client created successfully');
		
		// Test connection
		supabase.from('app_users').select('count').limit(1)
			.then(({ data, error }) => {
				if (error) {
					console.log(`  ⚠️ Database query error: ${error.message}`);
				} else {
					console.log('  ✅ Database connection working');
				}
			})
			.catch(err => {
				console.log(`  ❌ Database test failed: ${err.message}`);
			});
			
	} catch (error) {
		console.log(`  ❌ Supabase test failed: ${error.message}`);
	}
} else {
	console.log('  ⚠️ Supabase credentials missing');
}

console.log('\n🎯 Recommendations:');
console.log('1. Ensure all required environment variables are set');
console.log('2. Run "npm install" to install missing dependencies');
console.log('3. Run "npm run build" to build React app');
console.log('4. Check PM2 logs with "pm2 logs texon-inventory-comparison"');
console.log('5. Test with "node debug-server.js" after fixes');

console.log('\n✅ Debug complete!');