require('dotenv').config();
const { Pool } = require('pg');

async function checkCalendarConstraints() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  
  try {
    console.log('=== CHECKING CALENDAR CONSTRAINTS ===\n');
    
    // Check the unique constraint
    const constraints = await pool.query(`
      SELECT
        conname as constraint_name,
        contype as constraint_type,
        pg_get_constraintdef(oid) as constraint_definition
      FROM pg_constraint
      WHERE conrelid = (SELECT oid FROM pg_class WHERE relname = 'calendar_slots')
    `);
    
    console.log('Calendar_slots table constraints:');
    constraints.rows.forEach(constraint => {
      console.log(`  ${constraint.constraint_name} (${constraint.constraint_type}): ${constraint.constraint_definition}`);
    });
    
    // Check the indexes
    const indexes = await pool.query(`
      SELECT
        indexname,
        indexdef
      FROM pg_indexes
      WHERE tablename = 'calendar_slots'
    `);
    
    console.log('\nCalendar_slots table indexes:');
    indexes.rows.forEach(index => {
      console.log(`  ${index.indexname}: ${index.indexdef}`);
    });
    
    // The issue is likely that shifting all times creates duplicates
    // Let's check if there are existing slots that would conflict
    console.log('\n=== ALTERNATIVE APPROACH ===');
    console.log('Since we can\'t bulk update due to unique constraints,');
    console.log('we need to regenerate the calendar slots from scratch.');
    console.log('');
    console.log('SOLUTION:');
    console.log('1. Delete all existing calendar_slots for Tom\'s Garage');
    console.log('2. Regenerate them with correct timezone handling');
    
  } catch (error) {
    console.error('❌ Error checking constraints:', error.message);
    console.error(error.stack);
  } finally {
    await pool.end();
  }
}

checkCalendarConstraints();