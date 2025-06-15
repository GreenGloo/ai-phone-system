require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
});

async function checkTableStructures() {
  try {
    console.log('=== CHECKING DATABASE TABLE STRUCTURES ===\n');
    
    // Check what tables exist
    const tablesQuery = `
      SELECT table_name, table_type 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
      ORDER BY table_name
    `;
    
    const tablesResult = await pool.query(tablesQuery);
    console.log('Available tables:');
    tablesResult.rows.forEach(table => {
      console.log(`  ${table.table_name} (${table.table_type})`);
    });
    
    console.log('\n=== TABLE COLUMN DETAILS ===\n');
    
    // Check conversations table structure
    try {
      const conversationsColumns = await pool.query(`
        SELECT column_name, data_type, is_nullable, column_default
        FROM information_schema.columns 
        WHERE table_name = 'conversations'
        ORDER BY ordinal_position
      `);
      
      console.log('CONVERSATIONS table columns:');
      conversationsColumns.rows.forEach(col => {
        console.log(`  ${col.column_name}: ${col.data_type} (nullable: ${col.is_nullable})`);
      });
    } catch (error) {
      console.log('CONVERSATIONS table: Not found or error');
    }
    
    // Check calendar_slots table structure
    try {
      const calendarColumns = await pool.query(`
        SELECT column_name, data_type, is_nullable, column_default
        FROM information_schema.columns 
        WHERE table_name = 'calendar_slots'
        ORDER BY ordinal_position
      `);
      
      console.log('\nCALENDAR_SLOTS table columns:');
      calendarColumns.rows.forEach(col => {
        console.log(`  ${col.column_name}: ${col.data_type} (nullable: ${col.is_nullable})`);
      });
    } catch (error) {
      console.log('\nCALENDAR_SLOTS table: Not found or error');
    }
    
    // Check services/service_types table structure
    try {
      const servicesColumns = await pool.query(`
        SELECT column_name, data_type, is_nullable, column_default
        FROM information_schema.columns 
        WHERE table_name IN ('services', 'service_types')
        ORDER BY table_name, ordinal_position
      `);
      
      console.log('\nSERVICES/SERVICE_TYPES table columns:');
      servicesColumns.rows.forEach(col => {
        console.log(`  ${col.column_name}: ${col.data_type} (nullable: ${col.is_nullable})`);
      });
    } catch (error) {
      console.log('\nSERVICES table: Not found or error');
    }
    
    // Check bookings/appointments table structure
    try {
      const bookingsColumns = await pool.query(`
        SELECT column_name, data_type, is_nullable, column_default
        FROM information_schema.columns 
        WHERE table_name IN ('bookings', 'appointments')
        ORDER BY table_name, ordinal_position
      `);
      
      console.log('\nBOOKINGS/APPOINTMENTS table columns:');
      bookingsColumns.rows.forEach(col => {
        console.log(`  ${col.column_name}: ${col.data_type} (nullable: ${col.is_nullable})`);
      });
    } catch (error) {
      console.log('\nBOOKINGS table: Not found or error');
    }
    
  } catch (error) {
    console.error('Error checking table structures:', error);
  } finally {
    await pool.end();
  }
}

checkTableStructures();