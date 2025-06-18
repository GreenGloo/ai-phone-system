require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function addBillingSystem() {
  try {
    console.log('🚀 Adding billing and usage tracking system...');
    
    // Add new columns to subscriptions table
    console.log('📊 Updating subscriptions table...');
    await pool.query(`
      ALTER TABLE subscriptions 
      ADD COLUMN IF NOT EXISTS current_period_calls INTEGER DEFAULT 0,
      ADD COLUMN IF NOT EXISTS current_period_start DATE DEFAULT CURRENT_DATE,
      ADD COLUMN IF NOT EXISTS stripe_subscription_id VARCHAR(255),
      ADD COLUMN IF NOT EXISTS next_billing_date DATE,
      ADD COLUMN IF NOT EXISTS overage_charges DECIMAL(10,2) DEFAULT 0.00
    `);
    
    // Create usage tracking table
    console.log('📈 Creating usage_tracking table...');
    await pool.query(`
      CREATE TABLE IF NOT EXISTS usage_tracking (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        business_id UUID REFERENCES businesses(id) ON DELETE CASCADE,
        call_sid VARCHAR(255),
        call_date DATE DEFAULT CURRENT_DATE,
        call_duration INTEGER DEFAULT 0,
        call_type VARCHAR(50) DEFAULT 'inbound',
        call_cost DECIMAL(10,4) DEFAULT 0.00,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    
    // Create billing events table for tracking charges
    console.log('💳 Creating billing_events table...');
    await pool.query(`
      CREATE TABLE IF NOT EXISTS billing_events (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        business_id UUID REFERENCES businesses(id) ON DELETE CASCADE,
        event_type VARCHAR(50) NOT NULL, -- 'subscription', 'overage', 'upgrade', 'downgrade'
        amount DECIMAL(10,2) NOT NULL,
        currency VARCHAR(3) DEFAULT 'USD',
        stripe_charge_id VARCHAR(255),
        description TEXT,
        event_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        status VARCHAR(50) DEFAULT 'pending' -- 'pending', 'completed', 'failed'
      )
    `);
    
    // Update existing subscriptions with new fields
    console.log('🔄 Updating existing subscriptions...');
    await pool.query(`
      UPDATE subscriptions 
      SET 
        current_period_calls = 0,
        current_period_start = CURRENT_DATE,
        overage_charges = 0.00
      WHERE current_period_calls IS NULL
    `);
    
    // Create indexes for performance
    console.log('⚡ Creating performance indexes...');
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_usage_tracking_business_date 
      ON usage_tracking(business_id, call_date DESC)
    `);
    
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_billing_events_business 
      ON billing_events(business_id, event_date DESC)
    `);
    
    console.log('✅ Billing system setup complete!');
    console.log('');
    console.log('📋 System Features Added:');
    console.log('  - Usage tracking per business');
    console.log('  - Monthly call limits');
    console.log('  - Overage billing');
    console.log('  - Billing event history');
    console.log('  - Performance indexes');
    console.log('');
    console.log('💰 Pricing Tiers:');
    console.log('  - Starter: $49/month (200 calls)');
    console.log('  - Professional: $149/month (1,000 calls)'); 
    console.log('  - Enterprise: $349/month (5,000 calls)');
    console.log('  - All plans include 3-day free trial');
    
  } catch (error) {
    console.error('❌ Error setting up billing system:', error);
  } finally {
    await pool.end();
  }
}

addBillingSystem();