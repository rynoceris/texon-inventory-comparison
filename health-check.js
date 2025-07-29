// health-check.js
// Test if the server is responding correctly

const http = require('http');

const testEndpoints = [
	'/texon-inventory-comparison',
	'/texon-inventory-comparison/api/health'
];

const host = 'localhost';
const port = 3001;

console.log('🏥 Testing Texon Inventory Server Health...\n');

async function testEndpoint(path) {
	return new Promise((resolve) => {
		const options = {
			hostname: host,
			port: port,
			path: path,
			method: 'GET',
			timeout: 5000
		};

		const req = http.request(options, (res) => {
			let data = '';
			
			res.on('data', (chunk) => {
				data += chunk;
			});
			
			res.on('end', () => {
				resolve({
					path,
					status: res.statusCode,
					contentType: res.headers['content-type'],
					data: data.substring(0, 200) + (data.length > 200 ? '...' : '')
				});
			});
		});

		req.on('error', (err) => {
			resolve({
				path,
				error: err.message
			});
		});

		req.on('timeout', () => {
			resolve({
				path,
				error: 'Request timeout'
			});
		});

		req.end();
	});
}

async function runHealthCheck() {
	for (const endpoint of testEndpoints) {
		console.log(`Testing: ${endpoint}`);
		
		const result = await testEndpoint(endpoint);
		
		if (result.error) {
			console.log(`  ❌ Error: ${result.error}\n`);
		} else {
			const statusIcon = result.status === 200 ? '✅' : '⚠️';
			console.log(`  ${statusIcon} Status: ${result.status}`);
			console.log(`  📄 Content-Type: ${result.contentType || 'unknown'}`);
			
			if (result.data) {
				console.log(`  📝 Response preview: ${result.data.replace(/\n/g, ' ')}`);
			}
			console.log('');
		}
	}
	
	console.log('🎯 If you see errors above:');
	console.log('1. Make sure the server is running: pm2 status');
	console.log('2. Check server logs: pm2 logs texon-inventory-comparison');
	console.log('3. Verify the port is correct in your server.js');
	console.log('4. Test with curl: curl http://localhost:3001/texon-inventory-comparison');
}

runHealthCheck().catch(console.error);