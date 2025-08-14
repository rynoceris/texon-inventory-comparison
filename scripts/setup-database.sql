-- Texon Inventory Comparison Database Schema
-- Run this in your Supabase SQL editor

-- Create app_users table
CREATE TABLE IF NOT EXISTS public.app_users (
    id BIGSERIAL PRIMARY KEY,
    username VARCHAR(50) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    email VARCHAR(255) UNIQUE NOT NULL,
    first_name VARCHAR(100) NOT NULL,
    last_name VARCHAR(100) NOT NULL,
    role VARCHAR(20) DEFAULT 'user' CHECK (role IN ('admin', 'user')),
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    last_login TIMESTAMP WITH TIME ZONE
);

-- Create app_settings table
CREATE TABLE IF NOT EXISTS public.app_settings (
    id BIGSERIAL PRIMARY KEY,
    key VARCHAR(100) UNIQUE NOT NULL,
    value TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    created_by VARCHAR(50),
    updated_by VARCHAR(50)
);

-- Create inventory_reports table
CREATE TABLE IF NOT EXISTS public.inventory_reports (
    id BIGSERIAL PRIMARY KEY,
    date DATE NOT NULL,
    total_discrepancies INTEGER DEFAULT 0,
    discrepancies JSONB,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    brightpearl_total_items INTEGER DEFAULT 0,
    infoplus_total_items INTEGER DEFAULT 0
);

-- Enable Row Level Security
ALTER TABLE public.app_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_reports ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if they exist (to avoid conflicts)
DROP POLICY IF EXISTS "Service key access for app_users" ON public.app_users;
DROP POLICY IF EXISTS "Service key access for app_settings" ON public.app_settings;
DROP POLICY IF EXISTS "Service key access for inventory_reports" ON public.inventory_reports;

-- Create policies for app_users (only accessible with service key)
CREATE POLICY "Service key access for app_users" ON public.app_users
    FOR ALL USING (auth.role() = 'service_role');

-- Create policies for app_settings (only accessible with service key)
CREATE POLICY "Service key access for app_settings" ON public.app_settings
    FOR ALL USING (auth.role() = 'service_role');

-- Create policies for inventory_reports (only accessible with service key)
CREATE POLICY "Service key access for inventory_reports" ON public.inventory_reports
    FOR ALL USING (auth.role() = 'service_role');

-- Insert default settings
INSERT INTO public.app_settings (key, value, created_by) VALUES
    ('email_recipients', 'admin@texontowel.com', 'system'),
    ('email_notifications', 'true', 'system'),
    ('email_on_zero_discrepancies', 'false', 'system'),
    ('max_discrepancies_in_email', '25', 'system'),
    ('cron_enabled', 'true', 'system'),
    ('cron_schedule', '0 19 * * *', 'system'),
    ('cron_timezone', 'America/New_York', 'system'),
    ('report_retention_days', '30', 'system'),
    ('auto_cleanup_enabled', 'false', 'system'),
    ('api_timeout_seconds', '60', 'system'),
    ('max_concurrent_requests', '5', 'system'),
    ('debug_logging', 'false', 'system'),
    ('ignored_skus', '', 'system')
ON CONFLICT (key) DO NOTHING;

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_app_users_username ON public.app_users(username);
CREATE INDEX IF NOT EXISTS idx_app_users_email ON public.app_users(email);
CREATE INDEX IF NOT EXISTS idx_inventory_reports_date ON public.inventory_reports(date);
CREATE INDEX IF NOT EXISTS idx_inventory_reports_created_at ON public.inventory_reports(created_at);
CREATE INDEX IF NOT EXISTS idx_app_settings_key ON public.app_settings(key);