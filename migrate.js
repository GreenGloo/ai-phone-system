require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

async function runMigration() {
  try {
    console.log('🔄 Running database migration...');
    
    // Add industry templates table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS industry_templates (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        industry_type VARCHAR(100) NOT NULL UNIQUE,
        template_name VARCHAR(255) NOT NULL,
        description TEXT,
        service_templates JSONB NOT NULL,
        last_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        created_by VARCHAR(50) DEFAULT 'system',
        is_active BOOLEAN DEFAULT true
      );
    `);
    console.log('✅ Created industry_templates table');

    // Add team members table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS team_members (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
        name VARCHAR(255) NOT NULL,
        email VARCHAR(255),
        mobile_phone VARCHAR(20) NOT NULL,
        role VARCHAR(50) DEFAULT 'technician',
        is_active BOOLEAN DEFAULT true,
        can_receive_notifications BOOLEAN DEFAULT true,
        notification_preferences JSONB DEFAULT '{"new_appointments": true, "assignment_changes": true, "cancellations": true, "emergency_calls": true}',
        specialties TEXT[],
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    console.log('✅ Created team_members table');

    // Add assignment fields to appointments table
    await pool.query(`ALTER TABLE appointments ADD COLUMN IF NOT EXISTS assigned_to UUID;`);
    await pool.query(`ALTER TABLE appointments ADD COLUMN IF NOT EXISTS assigned_at TIMESTAMP;`);
    await pool.query(`ALTER TABLE appointments ADD COLUMN IF NOT EXISTS assignment_notes TEXT;`);
    await pool.query(`ALTER TABLE appointments ADD COLUMN IF NOT EXISTS notification_sent BOOLEAN DEFAULT false;`);
    console.log('✅ Updated appointments table with assignment fields');

    // Add foreign key constraint if it doesn't exist
    try {
      await pool.query(`
        ALTER TABLE appointments 
        ADD CONSTRAINT fk_appointments_assigned_to 
        FOREIGN KEY (assigned_to) REFERENCES team_members(id);
      `);
      console.log('✅ Added foreign key constraint for assigned_to');
    } catch (e) {
      if (e.message.includes('already exists')) {
        console.log('ℹ️ Foreign key constraint already exists');
      } else {
        throw e;
      }
    }

    console.log('🎉 Database migration completed successfully!');
    
  } catch (error) {
    console.error('❌ Migration failed:', error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

runMigration();