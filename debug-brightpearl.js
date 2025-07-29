// debug-brightpearl.js - Add this as a separate file to debug Brightpearl API

require('dotenv').config();

class BrightpearlDebug {
	constructor() {
		this.baseUrl = `https://use1.brightpearlconnect.com/public-api`;
		this.account = process.env.BRIGHTPEARL_ACCOUNT;
		this.appRef = process.env.BRIGHTPEARL_APP_REF;
		this.token = process.env.BRIGHTPEARL_TOKEN;
		
		console.log('🔍 Brightpearl Debug Configuration:');
		console.log(`Base URL: ${this.baseUrl}`);
		console.log(`Account: ${this.account}`);
		console.log(`App Ref: ${this.appRef ? '✅ Set' : '❌ Missing'}`);
		console.log(`Token: ${this.token ? '✅ Set' : '❌ Missing'}`);
		console.log('');
	}

	async debugRequest(endpoint, description) {
		try {
			console.log(`🧪 Testing: ${description}`);
			console.log(`URL: ${this.baseUrl}/${this.account}/${endpoint}`);
			
			const response = await fetch(`${this.baseUrl}/${this.account}/${endpoint}`, {
				headers: {
					'brightpearl-app-ref': this.appRef,
					'brightpearl-staff-token': this.token,
					'Content-Type': 'application/json'
				}
			});

			console.log(`Status: ${response.status} ${response.statusText}`);
			console.log(`Headers: ${JSON.stringify(Object.fromEntries(response.headers), null, 2)}`);

			if (response.ok) {
				const data = await response.json();
				console.log(`✅ Success! Response preview:`, JSON.stringify(data, null, 2).substring(0, 500) + '...');
				return { success: true, data };
			} else {
				const errorText = await response.text();
				console.log(`❌ Error Response: ${errorText}`);
				return { success: false, error: errorText, status: response.status };
			}
		} catch (error) {
			console.log(`❌ Network Error: ${error.message}`);
			return { success: false, error: error.message };
		}
		console.log('─'.repeat(80));
	}

	async runDebugTests() {
		console.log('🚀 Starting Brightpearl API Debug Tests...\n');

		// Test 1: Simple endpoint to verify authentication
		await this.debugRequest('product-service/product/1', 'Get single product (ID: 1)');

		// Test 2: Try different product endpoints
		await this.debugRequest('product-service/product', 'Get all products (basic)');

		// Test 3: Try with different parameters
		await this.debugRequest('product-service/product?limit=10', 'Get products with limit');

		// Test 4: Try the search endpoint we were using
		await this.debugRequest('product-service/product-search', 'Product search endpoint');

		// Test 5: Try warehouse service
		await this.debugRequest('warehouse-service/warehouse', 'Get warehouses');

		// Test 6: Try a different approach - get product types
		await this.debugRequest('product-service/product-type', 'Get product types');

		console.log('\n🎯 Debug complete! Check the results above to identify the working endpoints.');
	}
}

// Run the debug
const debug = new BrightpearlDebug();
debug.runDebugTests().catch(console.error);