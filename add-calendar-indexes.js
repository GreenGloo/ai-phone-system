require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function addCalendarIndexes() {
  try {
    console.log('📊 Adding calendar optimization indexes...');
    
    // Index for conflict checking queries
    await pool.query(`
      CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_appointments_calendar_conflicts 
      ON appointments(business_id, start_time, end_time, status) 
      WHERE status IN ('scheduled', 'confirmed', 'in_progress')
    `);
    
    console.log('✅ Calendar conflict index added');
    
    // Index for business hours lookups
    await pool.query(`
      CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_businesses_hours_lookup 
      ON businesses(id) 
      WHERE business_hours IS NOT NULL
    `);
    
    console.log('✅ Business hours index added');
    
    // Index for appointment status filtering
    await pool.query(`
      CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_appointments_status_time 
      ON appointments(business_id, status, start_time DESC) 
      WHERE status != 'cancelled'
    `);
    
    console.log('✅ Appointment status index added');
    
  } catch (error) {
    console.error('❌ Error adding calendar indexes:', error);
  } finally {
    process.exit(0);
  }
}

addCalendarIndexes();