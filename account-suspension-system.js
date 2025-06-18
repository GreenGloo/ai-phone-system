require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

// Developer bypass settings
const DEVELOPER_BYPASS_ENABLED = process.env.NODE_ENV === 'development' || process.env.DEVELOPER_MODE === 'true';
const ADMIN_BYPASS_KEY = process.env.ADMIN_BYPASS_KEY || 'dev_bypass_key';

async function setupAccountSuspensionSystem() {
  try {
    console.log('🚀 Setting up account suspension system...');
    
    // Add account status and suspension fields to businesses table
    console.log('📊 Adding account status fields to businesses table...');
    await pool.query(`
      ALTER TABLE businesses 
      ADD COLUMN IF NOT EXISTS account_status VARCHAR(50) DEFAULT 'active',
      ADD COLUMN IF NOT EXISTS suspended_at TIMESTAMP,
      ADD COLUMN IF NOT EXISTS suspension_reason TEXT,
      ADD COLUMN IF NOT EXISTS grace_period_ends_at TIMESTAMP,
      ADD COLUMN IF NOT EXISTS payment_failed_count INTEGER DEFAULT 0,
      ADD COLUMN IF NOT EXISTS last_payment_attempt TIMESTAMP,
      ADD COLUMN IF NOT EXISTS developer_override BOOLEAN DEFAULT FALSE,
      ADD COLUMN IF NOT EXISTS email_updates BOOLEAN DEFAULT TRUE,
      ADD COLUMN IF NOT EXISTS reactivation_offers BOOLEAN DEFAULT TRUE
    `);
    
    // Add payment failure tracking to subscriptions table
    console.log('💳 Adding payment tracking to subscriptions table...');
    await pool.query(`
      ALTER TABLE subscriptions 
      ADD COLUMN IF NOT EXISTS payment_status VARCHAR(50) DEFAULT 'active',
      ADD COLUMN IF NOT EXISTS last_payment_failure TIMESTAMP,
      ADD COLUMN IF NOT EXISTS next_retry_date TIMESTAMP,
      ADD COLUMN IF NOT EXISTS dunning_stage INTEGER DEFAULT 0,
      ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMP,
      ADD COLUMN IF NOT EXISTS cancellation_reason TEXT,
      ADD COLUMN IF NOT EXISTS service_ends_at TIMESTAMP,
      ADD COLUMN IF NOT EXISTS reactivated_at TIMESTAMP
    `);
    
    // Create payment failure events table
    console.log('📈 Creating payment_failures table...');
    await pool.query(`
      CREATE TABLE IF NOT EXISTS payment_failures (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        business_id UUID REFERENCES businesses(id) ON DELETE CASCADE,
        subscription_id UUID REFERENCES subscriptions(id) ON DELETE CASCADE,
        stripe_invoice_id VARCHAR(255),
        failure_reason TEXT,
        amount_due DECIMAL(10,2),
        attempt_count INTEGER DEFAULT 1,
        next_retry_date TIMESTAMP,
        resolved_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    
    // Create account status change log
    console.log('📋 Creating account_status_log table...');
    await pool.query(`
      CREATE TABLE IF NOT EXISTS account_status_log (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        business_id UUID REFERENCES businesses(id) ON DELETE CASCADE,
        old_status VARCHAR(50),
        new_status VARCHAR(50),
        reason TEXT,
        changed_by VARCHAR(255) DEFAULT 'system',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    
    // Update existing businesses to have active status
    console.log('🔄 Setting existing businesses to active status...');
    await pool.query(`
      UPDATE businesses 
      SET account_status = 'active'
      WHERE account_status IS NULL
    `);
    
    // Create indexes for performance
    console.log('⚡ Creating performance indexes...');
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_businesses_account_status 
      ON businesses(account_status, suspended_at)
    `);
    
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_payment_failures_business_retry
      ON payment_failures(business_id, next_retry_date, resolved_at)
    `);
    
    console.log('✅ Account suspension system setup complete!');
    console.log('');
    console.log('🔧 DEVELOPER BYPASS OPTIONS:');
    console.log(`  - Environment: DEVELOPER_MODE=${DEVELOPER_BYPASS_ENABLED}`);
    console.log(`  - Admin bypass key: ${ADMIN_BYPASS_KEY}`);
    console.log('  - Call canAccessService(businessId, { adminBypass: "your_key" })');
    console.log('  - Set developer_override=true in database for permanent bypass');
    console.log('');
    console.log('📋 Account Status Types:');
    console.log('  - active: Full service access');
    console.log('  - grace_period: Payment overdue, limited access');
    console.log('  - suspended: Service suspended, data preserved');
    console.log('  - cancelled: Account cancelled by user');
    console.log('');
    console.log('🔄 Dunning Process:');
    console.log('  - Stage 0: Payment failed, retry in 3 days');
    console.log('  - Stage 1: Grace period (7 days), send reminder');
    console.log('  - Stage 2: Final notice (3 days), service suspension warning');
    console.log('  - Stage 3: Service suspended, data preserved for 30 days');
    console.log('  - Stage 4: Account deletion after 30 days');
    
  } catch (error) {
    console.error('❌ Error setting up account suspension system:', error);
  } finally {
    await pool.end();
  }
}

// Main function to check if business can access service
async function canAccessService(businessId, options = {}) {
  try {
    // DEVELOPER BYPASS OPTIONS
    if (DEVELOPER_BYPASS_ENABLED) {
      console.log('🔧 Developer mode enabled - bypassing account suspension checks');
      return { canAccess: true, reason: 'developer_mode' };
    }
    
    if (options.adminBypass === ADMIN_BYPASS_KEY) {
      console.log('🔑 Admin bypass key used - bypassing account suspension checks');
      return { canAccess: true, reason: 'admin_bypass' };
    }
    
    // Check database for developer override
    const result = await pool.query(`
      SELECT 
        account_status, 
        suspended_at, 
        suspension_reason,
        grace_period_ends_at,
        developer_override
      FROM businesses 
      WHERE id = $1
    `, [businessId]);
    
    if (result.rows.length === 0) {
      return { canAccess: false, reason: 'business_not_found' };
    }
    
    const business = result.rows[0];
    
    // Developer override in database
    if (business.developer_override) {
      console.log('🔧 Developer override enabled in database - bypassing suspension');
      return { canAccess: true, reason: 'developer_override' };
    }
    
    // Check account status
    switch (business.account_status) {
      case 'active':
        return { canAccess: true, reason: 'active' };
        
      case 'grace_period':
        // Check if grace period has expired
        if (business.grace_period_ends_at && new Date() > new Date(business.grace_period_ends_at)) {
          // Grace period expired, suspend account
          await suspendAccount(businessId, 'Grace period expired');
          return { canAccess: false, reason: 'grace_period_expired' };
        }
        return { canAccess: true, reason: 'grace_period', warning: 'Payment overdue' };
        
      case 'suspended':
        return { 
          canAccess: false, 
          reason: 'suspended', 
          details: business.suspension_reason,
          suspendedAt: business.suspended_at
        };
        
      case 'cancelled':
        return { canAccess: false, reason: 'cancelled' };
        
      default:
        return { canAccess: false, reason: 'unknown_status' };
    }
    
  } catch (error) {
    console.error('❌ Error checking service access:', error);
    // In case of error, allow access to prevent service disruption
    return { canAccess: true, reason: 'error_fallback' };
  }
}

// Developer helper functions
async function setDeveloperOverride(businessId, enabled = true) {
  try {
    await pool.query(`
      UPDATE businesses 
      SET developer_override = $2
      WHERE id = $1
    `, [businessId, enabled]);
    
    console.log(`🔧 Developer override ${enabled ? 'enabled' : 'disabled'} for business ${businessId}`);
    return true;
  } catch (error) {
    console.error('❌ Error setting developer override:', error);
    return false;
  }
}

async function listSuspendedAccounts() {
  try {
    const result = await pool.query(`
      SELECT 
        id,
        business_name,
        account_status,
        suspended_at,
        suspension_reason,
        developer_override
      FROM businesses 
      WHERE account_status IN ('suspended', 'grace_period')
      ORDER BY suspended_at DESC
    `);
    
    console.log('📋 Suspended/Grace Period Accounts:');
    result.rows.forEach(business => {
      console.log(`  - ${business.business_name} (${business.id}): ${business.account_status}`);
      console.log(`    Reason: ${business.suspension_reason || 'N/A'}`);
      console.log(`    Developer Override: ${business.developer_override ? 'YES' : 'NO'}`);
      console.log('');
    });
    
    return result.rows;
  } catch (error) {
    console.error('❌ Error listing suspended accounts:', error);
    return [];
  }
}

// Account suspension management functions (same as before but with bypass checks)
async function suspendAccount(businessId, reason = 'Payment failure') {
  // Check for developer override before suspending
  const accessCheck = await canAccessService(businessId);
  if (accessCheck.reason === 'developer_override' || accessCheck.reason === 'developer_mode') {
    console.log('🔧 Skipping suspension due to developer override');
    return false;
  }
  
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    
    // Get current status
    const businessResult = await client.query(
      'SELECT account_status FROM businesses WHERE id = $1',
      [businessId]
    );
    
    if (businessResult.rows.length === 0) {
      throw new Error('Business not found');
    }
    
    const oldStatus = businessResult.rows[0].account_status;
    
    // Update business status
    await client.query(`
      UPDATE businesses 
      SET 
        account_status = 'suspended',
        suspended_at = CURRENT_TIMESTAMP,
        suspension_reason = $2
      WHERE id = $1 AND developer_override = FALSE
    `, [businessId, reason]);
    
    // Log status change
    await client.query(`
      INSERT INTO account_status_log (business_id, old_status, new_status, reason)
      VALUES ($1, $2, 'suspended', $3)
    `, [businessId, oldStatus, reason]);
    
    await client.query('COMMIT');
    console.log(`✅ Account ${businessId} suspended: ${reason}`);
    return true;
    
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('❌ Error suspending account:', error);
    throw error;
  } finally {
    client.release();
  }
}

async function reactivateAccount(businessId, reason = 'Payment resolved') {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    
    // Get current status
    const businessResult = await client.query(
      'SELECT account_status FROM businesses WHERE id = $1',
      [businessId]
    );
    
    if (businessResult.rows.length === 0) {
      throw new Error('Business not found');
    }
    
    const oldStatus = businessResult.rows[0].account_status;
    
    // Update business status
    await client.query(`
      UPDATE businesses 
      SET 
        account_status = 'active',
        suspended_at = NULL,
        suspension_reason = NULL,
        payment_failed_count = 0
      WHERE id = $1
    `, [businessId]);
    
    // Update subscription status
    await client.query(`
      UPDATE subscriptions 
      SET 
        payment_status = 'active',
        dunning_stage = 0
      WHERE business_id = $1
    `, [businessId]);
    
    // Mark payment failures as resolved
    await client.query(`
      UPDATE payment_failures 
      SET resolved_at = CURRENT_TIMESTAMP
      WHERE business_id = $1 AND resolved_at IS NULL
    `, [businessId]);
    
    // Log status change
    await client.query(`
      INSERT INTO account_status_log (business_id, old_status, new_status, reason)
      VALUES ($1, $2, 'active', $3)
    `, [businessId, oldStatus, reason]);
    
    await client.query('COMMIT');
    console.log(`✅ Account ${businessId} reactivated: ${reason}`);
    return true;
    
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('❌ Error reactivating account:', error);
    throw error;
  } finally {
    client.release();
  }
}

async function handlePaymentFailure(businessId, subscriptionId, invoiceId, failureReason, amountDue) {
  // Check for developer override before processing payment failure
  const accessCheck = await canAccessService(businessId);
  if (accessCheck.reason === 'developer_override' || accessCheck.reason === 'developer_mode') {
    console.log('🔧 Skipping payment failure processing due to developer override');
    return { newStatus: 'active', dunningStage: 0, bypassed: true };
  }
  
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    
    // Get current failure count
    const businessResult = await client.query(
      'SELECT payment_failed_count, account_status FROM businesses WHERE id = $1',
      [businessId]
    );
    
    if (businessResult.rows.length === 0) {
      throw new Error('Business not found');
    }
    
    const currentCount = businessResult.rows[0].payment_failed_count || 0;
    const newCount = currentCount + 1;
    
    // Determine next action based on failure count
    let nextStatus = 'active';
    let gracePeriodEnd = null;
    let nextRetryDate = new Date();
    let dunningStage = 0;
    
    if (newCount === 1) {
      // First failure: retry in 3 days
      nextRetryDate.setDate(nextRetryDate.getDate() + 3);
      dunningStage = 1;
    } else if (newCount === 2) {
      // Second failure: grace period (7 days)
      nextStatus = 'grace_period';
      gracePeriodEnd = new Date();
      gracePeriodEnd.setDate(gracePeriodEnd.getDate() + 7);
      nextRetryDate.setDate(nextRetryDate.getDate() + 7);
      dunningStage = 2;
    } else if (newCount >= 3) {
      // Third+ failure: suspend account
      nextStatus = 'suspended';
      dunningStage = 3;
    }
    
    // Update business
    await client.query(`
      UPDATE businesses 
      SET 
        payment_failed_count = $2,
        last_payment_attempt = CURRENT_TIMESTAMP,
        account_status = $3,
        grace_period_ends_at = $4
      WHERE id = $1 AND developer_override = FALSE
    `, [businessId, newCount, nextStatus, gracePeriodEnd]);
    
    // Update subscription
    await client.query(`
      UPDATE subscriptions 
      SET 
        payment_status = 'failed',
        last_payment_failure = CURRENT_TIMESTAMP,
        next_retry_date = $2,
        dunning_stage = $3
      WHERE id = $1
    `, [subscriptionId, nextRetryDate, dunningStage]);
    
    // Record payment failure
    await client.query(`
      INSERT INTO payment_failures 
      (business_id, subscription_id, stripe_invoice_id, failure_reason, amount_due, attempt_count, next_retry_date)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
    `, [businessId, subscriptionId, invoiceId, failureReason, amountDue, newCount, nextRetryDate]);
    
    // Log status change if status changed
    if (nextStatus !== businessResult.rows[0].account_status) {
      await client.query(`
        INSERT INTO account_status_log (business_id, old_status, new_status, reason)
        VALUES ($1, $2, $3, $4)
      `, [businessId, businessResult.rows[0].account_status, nextStatus, `Payment failure #${newCount}: ${failureReason}`]);
    }
    
    await client.query('COMMIT');
    console.log(`⚠️ Payment failure handled for ${businessId}: ${failureReason} (failure #${newCount}, status: ${nextStatus})`);
    
    return { newStatus: nextStatus, dunningStage, nextRetryDate };
    
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('❌ Error handling payment failure:', error);
    throw error;
  } finally {
    client.release();
  }
}

module.exports = {
  setupAccountSuspensionSystem,
  canAccessService,
  suspendAccount,
  reactivateAccount,
  handlePaymentFailure,
  setDeveloperOverride,
  listSuspendedAccounts
};

// Run setup if called directly
if (require.main === module) {
  setupAccountSuspensionSystem();
}