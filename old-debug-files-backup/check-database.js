require('dotenv').config();
const { Pool } = require('pg');

async function checkDatabase() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  
  try {
    // Check if conversations table exists
    const tableCheck = await pool.query('SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_name = \'conversations\')');
    
    console.log('Conversations table exists:', tableCheck.rows[0].exists);
    
    if (!tableCheck.rows[0].exists) {
      console.log('❌ Need to create conversations table on Railway!');
      console.log('🔧 Running migration...');
      
      const fs = require('fs');
      const migrationSQL = fs.readFileSync('./add-conversations-table.sql', 'utf8');
      await pool.query(migrationSQL);
      
      console.log('✅ Conversations table created on Railway');
    } else {
      console.log('✅ Conversations table ready on Railway');
    }
    
  } catch (error) {
    console.error('❌ Database check error:', error.message);
  } finally {
    await pool.end();
  }
}

checkDatabase();