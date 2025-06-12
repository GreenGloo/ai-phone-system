require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function addTimezoneColumn() {
  try {
    console.log('🕒 Adding timezone column to businesses table...');
    
    // First check if the column exists
    const checkColumn = await pool.query(`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = 'businesses' AND column_name = 'timezone'
    `);
    
    if (checkColumn.rows.length > 0) {
      console.log('✅ Timezone column already exists');
    } else {
      // Add the timezone column with default Eastern Time
      await pool.query(`
        ALTER TABLE businesses 
        ADD COLUMN timezone VARCHAR(50) DEFAULT 'America/New_York'
      `);
      
      console.log('✅ Timezone column added successfully');
    }
    
    // Set default timezone for existing businesses
    const updateResult = await pool.query(`
      UPDATE businesses 
      SET timezone = 'America/New_York' 
      WHERE timezone IS NULL
    `);
    
    console.log(`✅ Updated ${updateResult.rowCount} businesses with default timezone`);
    
  } catch (error) {
    console.error('❌ Error adding timezone column:', error);
  } finally {
    process.exit(0);
  }
}

addTimezoneColumn();