require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
});

async function checkConversationStructure() {
  try {
    const businessId = '8fea02b5-850a-4167-913b-a12043c65d17';
    
    console.log('=== CHECKING CONVERSATION DATA STRUCTURE ===\n');
    
    // Get one conversation and examine its structure
    const conversationsQuery = `
      SELECT 
        call_sid,
        conversation_data
      FROM conversations 
      WHERE business_id = $1 
      ORDER BY created_at DESC 
      LIMIT 1
    `;
    
    const conversationsResult = await pool.query(conversationsQuery, [businessId]);
    
    if (conversationsResult.rows.length > 0) {
      const conv = conversationsResult.rows[0];
      console.log(`Call SID: ${conv.call_sid}`);
      console.log('\nConversation Data Structure:');
      console.log(JSON.stringify(conv.conversation_data, null, 2));
    } else {
      console.log('No conversations found');
    }
    
  } catch (error) {
    console.error('Check failed:', error);
  } finally {
    await pool.end();
  }
}

checkConversationStructure();