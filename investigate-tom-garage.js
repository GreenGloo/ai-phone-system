require('dotenv').config();
const { Pool } = require('pg');

async function investigateTomGarage() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  
  try {
    console.log('🔍 Investigating Tom\'s Garage phone number issue...\n');
    
    // 1. Check the specific business record
    console.log('1. Tom\'s Garage business record:');
    const businessResult = await pool.query(
      'SELECT id, name, phone_number, twilio_phone_sid, twilio_account_sid, created_at, updated_at FROM businesses WHERE id = $1', 
      ['8fea02b5-850a-4167-913b-a12043c65d17']
    );
    
    if (businessResult.rows.length === 0) {
      console.log('❌ No business found with ID: 8fea02b5-850a-4167-913b-a12043c65d17');
      return;
    }
    
    const business = businessResult.rows[0];
    console.log(JSON.stringify(business, null, 2));
    
    // 2. Check for duplicate businesses with similar names
    console.log('\n2. All businesses with "Tom" or "Garage" in name:');
    const similarResult = await pool.query(
      'SELECT id, name, phone_number, twilio_phone_sid, twilio_account_sid, created_at FROM businesses WHERE name ILIKE $1 OR name ILIKE $2', 
      ['%tom%', '%garage%']
    );
    console.log(`Found ${similarResult.rows.length} businesses:`);
    similarResult.rows.forEach((row, index) => {
      console.log(`${index + 1}. ${row.name} (${row.id})`);
      console.log(`   Phone: ${row.phone_number}`);
      console.log(`   Twilio SID: ${row.twilio_phone_sid}`);
      console.log(`   Created: ${row.created_at}\n`);
    });
    
    // 3. Check for businesses with the same user_id as Tom's Garage
    console.log('3. All businesses belonging to the same user:');
    const userBusinesses = await pool.query(
      'SELECT b1.id, b1.name, b1.phone_number, b1.twilio_phone_sid, b1.created_at FROM businesses b1 JOIN businesses b2 ON b1.user_id = b2.user_id WHERE b2.id = $1',
      ['8fea02b5-850a-4167-913b-a12043c65d17']
    );
    console.log(`Found ${userBusinesses.rows.length} businesses for this user:`);
    userBusinesses.rows.forEach((row, index) => {
      console.log(`${index + 1}. ${row.name} (${row.id})`);
      console.log(`   Phone: ${row.phone_number}`);
      console.log(`   Twilio SID: ${row.twilio_phone_sid}`);
      console.log(`   Created: ${row.created_at}\n`);
    });
    
    // 4. Check for any phone number patterns
    console.log('4. Phone number analysis:');
    const phoneNumbers = userBusinesses.rows.map(b => b.phone_number).filter(p => p);
    const twilioSids = userBusinesses.rows.map(b => b.twilio_phone_sid).filter(s => s);
    
    console.log(`Unique phone numbers: ${new Set(phoneNumbers).size}`);
    console.log(`Unique Twilio SIDs: ${new Set(twilioSids).size}`);
    console.log('Phone numbers:', phoneNumbers);
    console.log('Twilio SIDs:', twilioSids);
    
    // 5. Check call logs for phone usage
    console.log('\n5. Call logs for Tom\'s Garage:');
    const callLogs = await pool.query(
      'SELECT call_sid, from_number, to_number, call_status, duration, created_at FROM call_logs WHERE business_id = $1 ORDER BY created_at DESC LIMIT 10',
      ['8fea02b5-850a-4167-913b-a12043c65d17']
    );
    
    console.log(`Found ${callLogs.rows.length} recent call logs:`);
    callLogs.rows.forEach((log, index) => {
      console.log(`${index + 1}. ${log.from_number} → ${log.to_number} (${log.call_status})`);
      console.log(`   Duration: ${log.duration}s, Created: ${log.created_at}`);
    });
    
  } catch (error) {
    console.error('❌ Database investigation error:', error);
  } finally {
    await pool.end();
  }
}

investigateTomGarage();