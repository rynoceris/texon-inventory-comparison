// Script to add ignored_skus setting to database
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

async function addIgnoredSkusSetting() {
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

    try {
        // Insert or update the ignored_skus setting
        const { data, error } = await supabase
            .from('app_settings')
            .upsert({
                key: 'ignored_skus',
                value: '',
                created_by: 'system',
                updated_at: new Date().toISOString(),
                updated_by: 'system'
            }, {
                onConflict: 'key'
            });

        if (error) {
            throw error;
        }

        console.log('✅ Successfully added ignored_skus setting to database');
        console.log('You can now configure ignored SKUs in the admin settings page');

    } catch (error) {
        console.error('❌ Error adding ignored_skus setting:', error.message);
    }
}

addIgnoredSkusSetting();