// Run database migration to fix calendar system
const fs = require('fs');
const { Pool } = require('pg');

async function runMigration() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  
  try {
    console.log('🔧 Running calendar database migration...');
    
    const migrationSQL = fs.readFileSync('./fix-calendar-database.sql', 'utf8');
    
    await pool.query(migrationSQL);
    
    console.log('✅ Calendar database migration completed!');
    console.log('✅ Added calendar_preferences column');
    console.log('✅ Created calendar_slots table');
    console.log('✅ Added indexes');
    
  } catch (error) {
    console.error('❌ Migration failed:', error);
  } finally {
    await pool.end();
  }
}

if (require.main === module) {
  runMigration();
}

module.exports = { runMigration };