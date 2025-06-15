require('dotenv').config();
const { Pool } = require('pg');

async function checkCalendarStructure() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  
  try {
    console.log('=== CHECKING CALENDAR_SLOTS TABLE STRUCTURE ===\n');
    
    // Check table structure
    const structure = await pool.query(`
      SELECT column_name, data_type, is_nullable
      FROM information_schema.columns
      WHERE table_name = 'calendar_slots'
      ORDER BY ordinal_position
    `);
    
    console.log('Calendar_slots table columns:');
    structure.rows.forEach(col => {
      console.log(`  ${col.column_name}: ${col.data_type} (nullable: ${col.is_nullable})`);
    });
    console.log('');
    
    // Show sample data
    const sampleData = await pool.query(`
      SELECT * FROM calendar_slots 
      WHERE business_id = '8fea02b5-850a-4167-913b-a12043c65d17'
      LIMIT 5
    `);
    
    console.log('Sample data:');
    sampleData.rows.forEach((row, i) => {
      console.log(`Row ${i + 1}:`, row);
    });
    
  } catch (error) {
    console.error('❌ Error:', error.message);
  } finally {
    await pool.end();
  }
}

checkCalendarStructure();