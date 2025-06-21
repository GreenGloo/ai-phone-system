// AUTOMATIC DATABASE MIGRATION SYSTEM
// Runs schema updates automatically when app starts - no more manual SQL scripts

require('dotenv').config();
const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

// Migration tracking table
const MIGRATIONS_TABLE = `
CREATE TABLE IF NOT EXISTS schema_migrations (
    id SERIAL PRIMARY KEY,
    migration_name VARCHAR(255) UNIQUE NOT NULL,
    applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    checksum TEXT NOT NULL
);
`;

// Auto-migration definitions
const MIGRATIONS = [
  {
    name: 'add_service_keywords_table',
    description: 'Add service_keywords table for AI-generated keywords',
    sql: `
      CREATE TABLE IF NOT EXISTS service_keywords (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          service_id UUID NOT NULL REFERENCES service_types(id) ON DELETE CASCADE,
          business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
          keyword VARCHAR(100) NOT NULL,
          confidence_score DECIMAL(3,2) DEFAULT 1.0,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          UNIQUE(service_id, keyword)
      );

      CREATE INDEX IF NOT EXISTS idx_service_keywords_business_keyword ON service_keywords(business_id, keyword);
      CREATE INDEX IF NOT EXISTS idx_service_keywords_service ON service_keywords(service_id);
    `
  },
  {
    name: 'add_calendar_preferences_column',
    description: 'Add calendar_preferences column to businesses table',
    sql: `
      ALTER TABLE businesses 
      ADD COLUMN IF NOT EXISTS calendar_preferences JSONB DEFAULT '{
        "appointmentDuration": 60,
        "bufferTime": 30,
        "maxDailyAppointments": 8
      }';
    `
  },
  {
    name: 'create_calendar_slots_table',
    description: 'Create calendar_slots table for appointment scheduling',
    sql: `
      CREATE TABLE IF NOT EXISTS calendar_slots (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
          slot_start TIMESTAMP NOT NULL,
          slot_end TIMESTAMP NOT NULL,
          is_available BOOLEAN DEFAULT true,
          is_blocked BOOLEAN DEFAULT false,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE INDEX IF NOT EXISTS idx_calendar_slots_business_time ON calendar_slots(business_id, slot_start);
      CREATE INDEX IF NOT EXISTS idx_calendar_slots_availability ON calendar_slots(business_id, is_available, is_blocked, slot_start);
    `
  },
  {
    name: 'create_conversations_table',
    description: 'Create conversations table for AI call storage',
    sql: `
      CREATE TABLE IF NOT EXISTS conversations (
          call_sid VARCHAR(255) PRIMARY KEY,
          business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
          conversation_data JSONB NOT NULL,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE INDEX IF NOT EXISTS idx_conversations_business ON conversations(business_id);
      CREATE INDEX IF NOT EXISTS idx_conversations_created ON conversations(created_at);
    `
  },
  {
    name: 'add_webhook_auto_config_columns',
    description: 'Add columns for automatic webhook configuration tracking',
    sql: `
      ALTER TABLE businesses 
      ADD COLUMN IF NOT EXISTS webhook_configured BOOLEAN DEFAULT false,
      ADD COLUMN IF NOT EXISTS webhook_last_verified TIMESTAMP,
      ADD COLUMN IF NOT EXISTS webhook_status VARCHAR(50) DEFAULT 'pending';
    `
  },
  {
    name: 'add_auto_repair_tracking',
    description: 'Add columns for automatic business data repair tracking',
    sql: `
      ALTER TABLE businesses 
      ADD COLUMN IF NOT EXISTS last_auto_repair TIMESTAMP,
      ADD COLUMN IF NOT EXISTS auto_repair_status VARCHAR(50) DEFAULT 'healthy',
      ADD COLUMN IF NOT EXISTS data_integrity_score DECIMAL(3,2) DEFAULT 1.0;
    `
  },
  {
    name: 'create_customers_table',
    description: 'Create customers table for SMS opt-out tracking and customer management',
    sql: `
      CREATE TABLE IF NOT EXISTS customers (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
        name VARCHAR(255),
        phone VARCHAR(20) NOT NULL,
        email VARCHAR(255),
        sms_opt_out BOOLEAN DEFAULT false,
        sms_opt_out_date TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(business_id, phone)
      );
      
      CREATE INDEX IF NOT EXISTS idx_customers_business_phone ON customers(business_id, phone);
      CREATE INDEX IF NOT EXISTS idx_customers_sms_opt_out ON customers(business_id, sms_opt_out);
    `
  },
  {
    name: 'add_trial_usage_tracking',
    description: 'Add trial usage tracking columns to businesses table',
    sql: `
      ALTER TABLE businesses 
      ADD COLUMN IF NOT EXISTS trial_calls_today INTEGER DEFAULT 0,
      ADD COLUMN IF NOT EXISTS trial_calls_total INTEGER DEFAULT 0,
      ADD COLUMN IF NOT EXISTS trial_minutes_today DECIMAL(10,2) DEFAULT 0,
      ADD COLUMN IF NOT EXISTS trial_minutes_total DECIMAL(10,2) DEFAULT 0,
      ADD COLUMN IF NOT EXISTS trial_last_reset_date DATE DEFAULT CURRENT_DATE;
    `
  }
];

async function calculateChecksum(sql) {
  const crypto = require('crypto');
  return crypto.createHash('md5').update(sql.trim()).digest('hex');
}

async function initializeMigrationSystem() {
  console.log('🔧 Initializing automatic migration system...');
  
  try {
    // Create migrations tracking table
    await pool.query(MIGRATIONS_TABLE);
    console.log('✅ Migration tracking table ready');
    return true;
  } catch (error) {
    console.error('❌ Failed to initialize migration system:', error);
    return false;
  }
}

async function getMigrationStatus(migrationName) {
  try {
    const result = await pool.query(
      'SELECT migration_name, checksum FROM schema_migrations WHERE migration_name = $1',
      [migrationName]
    );
    return result.rows.length > 0 ? result.rows[0] : null;
  } catch (error) {
    console.error(`❌ Error checking migration status for ${migrationName}:`, error);
    return null;
  }
}

async function recordMigration(migrationName, checksum) {
  try {
    await pool.query(
      `INSERT INTO schema_migrations (migration_name, checksum) 
       VALUES ($1, $2) 
       ON CONFLICT (migration_name) 
       DO UPDATE SET checksum = $2, applied_at = CURRENT_TIMESTAMP`,
      [migrationName, checksum]
    );
    return true;
  } catch (error) {
    console.error(`❌ Error recording migration ${migrationName}:`, error);
    return false;
  }
}

async function runMigration(migration) {
  console.log(`🔄 Running migration: ${migration.name}`);
  console.log(`   Description: ${migration.description}`);
  
  try {
    // Calculate checksum for this migration
    const currentChecksum = await calculateChecksum(migration.sql);
    
    // Check if migration was already applied
    const existingMigration = await getMigrationStatus(migration.name);
    
    if (existingMigration) {
      if (existingMigration.checksum === currentChecksum) {
        console.log(`✅ Migration ${migration.name} already applied with same checksum - skipping`);
        return true;
      } else {
        console.log(`🔄 Migration ${migration.name} has changed - re-applying`);
      }
    }
    
    // Run the migration SQL
    await pool.query(migration.sql);
    
    // Record the migration
    const recorded = await recordMigration(migration.name, currentChecksum);
    if (recorded) {
      console.log(`✅ Migration ${migration.name} completed successfully`);
      return true;
    } else {
      console.error(`❌ Migration ${migration.name} ran but failed to record`);
      return false;
    }
    
  } catch (error) {
    console.error(`❌ Migration ${migration.name} failed:`, error);
    return false;
  }
}

async function runAllMigrations() {
  console.log('🚀 STARTING AUTOMATIC DATABASE MIGRATIONS');
  console.log('='.repeat(60));
  
  // Initialize migration system
  const initialized = await initializeMigrationSystem();
  if (!initialized) {
    throw new Error('Failed to initialize migration system');
  }
  
  let successCount = 0;
  let skipCount = 0;
  let failCount = 0;
  
  // Run each migration
  for (const migration of MIGRATIONS) {
    const success = await runMigration(migration);
    if (success) {
      const existingMigration = await getMigrationStatus(migration.name);
      if (existingMigration) {
        skipCount++;
      } else {
        successCount++;
      }
    } else {
      failCount++;
    }
  }
  
  console.log('\n' + '='.repeat(60));
  console.log('🎯 AUTO-MIGRATION RESULTS');
  console.log('='.repeat(60));
  console.log(`✅ New migrations applied: ${successCount}`);
  console.log(`⏭️ Migrations skipped (already applied): ${skipCount}`);
  console.log(`❌ Migrations failed: ${failCount}`);
  
  if (failCount > 0) {
    throw new Error(`${failCount} migrations failed - check logs above`);
  }
  
  console.log('\n🚀 ALL DATABASE MIGRATIONS COMPLETE - SYSTEM READY!');
  return { successCount, skipCount, failCount };
}

// Auto-run migrations when imported
async function autoMigrate() {
  try {
    await runAllMigrations();
    return true;
  } catch (error) {
    console.error('🚨 AUTO-MIGRATION SYSTEM FAILED:', error);
    return false;
  }
}

module.exports = {
  runAllMigrations,
  autoMigrate,
  initializeMigrationSystem,
  MIGRATIONS
};