// scripts/setup-admin.js (Initial admin user creation)
const { createClient } = require('@supabase/supabase-js');
const bcrypt = require('bcrypt');
require('dotenv').config();

async function createAdminUser() {
  const supabase = createClient(
	process.env.SUPABASE_URL,
	process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY,
	{
	  auth: {
		autoRefreshToken: false,
		persistSession: false
	  }
	}
  );

  const username = process.argv[2] || 'admin';
  const password = process.argv[3] || 'changeme123';
  const email = process.argv[4] || 'admin@texontowel.com';

  try {
	const hashedPassword = await bcrypt.hash(password, 10);
	
	const { data, error } = await supabase
	  .from('app_users')
	  .insert([{
		username,
		password_hash: hashedPassword,
		email,
		first_name: 'Admin',
		last_name: 'User',
		role: 'admin',
		is_active: true,
		created_at: new Date().toISOString()
	  }]);

	if (error) {
	  if (error.code === '23505') {
		console.log('Admin user already exists!');
	  } else {
		throw error;
	  }
	} else {
	  console.log(`Admin user created successfully!`);
	  console.log(`Username: ${username}`);
	  console.log(`Password: ${password}`);
	  console.log(`Email: ${email}`);
	  console.log('Please change the password after first login!');
	}
  } catch (error) {
	console.error('Error creating admin user:', error.message);
  }
}

createAdminUser();