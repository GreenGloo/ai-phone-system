require('dotenv').config();
const { Pool } = require('pg');

async function debugSlotOrdering() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const businessId = '8fea02b5-850a-4167-913b-a12043c65d17'; // Tom's Garage
  
  try {
    console.log('=== DEBUGGING SLOT ORDERING ISSUE ===\n');
    
    // 1. Check the exact UTC times stored for Monday June 16
    console.log('1. Checking actual UTC storage for Monday June 16 slots...');
    const mondaySlots = await pool.query(`
      SELECT 
        slot_start,
        slot_start AT TIME ZONE 'UTC' AT TIME ZONE 'America/New_York' as local_time,
        EXTRACT(hour FROM slot_start AT TIME ZONE 'UTC' AT TIME ZONE 'America/New_York') as local_hour
      FROM calendar_slots
      WHERE business_id = $1
      AND DATE(slot_start AT TIME ZONE 'UTC' AT TIME ZONE 'America/New_York') = '2025-06-16'
      ORDER BY slot_start
      LIMIT 20
    `, [businessId]);
    
    console.log('Monday June 16 slots ordered by UTC time:');
    mondaySlots.rows.forEach((slot, i) => {
      const utcHour = new Date(slot.slot_start).getUTCHours();
      console.log(`  ${i + 1}. UTC: ${slot.slot_start} (${utcHour}:00 UTC) -> Local: ${slot.local_time} (${slot.local_hour}:00 local)`);
    });
    
    // 2. Test the query that starts with NOW() 
    console.log('\n2. Testing query with NOW() filter...');
    const nowSlots = await pool.query(`
      SELECT 
        slot_start,
        slot_start AT TIME ZONE 'UTC' AT TIME ZONE 'America/New_York' as local_time
      FROM calendar_slots
      WHERE business_id = $1
      AND is_available = true
      AND is_blocked = false
      AND slot_start >= NOW()
      ORDER BY slot_start
      LIMIT 10
    `, [businessId]);
    
    console.log('First 10 slots from NOW() query:');
    nowSlots.rows.forEach((slot, i) => {
      console.log(`  ${i + 1}. UTC: ${slot.slot_start} -> Local: ${slot.local_time}`);
    });
    
    // 3. Check what NOW() actually is
    console.log('\n3. Checking current time comparison...');
    const timeCheck = await pool.query(`
      SELECT 
        NOW() as current_utc,
        '2025-06-16 12:00:00'::timestamp as morning_8am_utc,
        '2025-06-16 12:00:00'::timestamp >= NOW() as is_8am_future
    `);
    
    console.log(`Current UTC time: ${timeCheck.rows[0].current_utc}`);
    console.log(`8 AM Monday (12:00 UTC): ${timeCheck.rows[0].morning_8am_utc}`);
    console.log(`Is 8 AM Monday in future: ${timeCheck.rows[0].is_8am_future}`);
    
    // 4. The real issue: check if there's a slot availability or blocking issue
    console.log('\n4. Checking if morning slots are marked as unavailable or blocked...');
    const morningAvailability = await pool.query(`
      SELECT 
        slot_start AT TIME ZONE 'UTC' AT TIME ZONE 'America/New_York' as local_time,
        is_available,
        is_blocked,
        CASE 
          WHEN NOT is_available THEN 'NOT AVAILABLE'
          WHEN is_blocked THEN 'BLOCKED'
          ELSE 'OK'
        END as status
      FROM calendar_slots
      WHERE business_id = $1
      AND DATE(slot_start AT TIME ZONE 'UTC' AT TIME ZONE 'America/New_York') = '2025-06-16'
      AND EXTRACT(hour FROM slot_start AT TIME ZONE 'UTC' AT TIME ZONE 'America/New_York') BETWEEN 8 AND 11
      ORDER BY slot_start
    `, [businessId]);
    
    console.log('Monday morning slot availability:');
    morningAvailability.rows.forEach((slot, i) => {
      console.log(`  ${i + 1}. ${slot.local_time} - ${slot.status} (available: ${slot.is_available}, blocked: ${slot.is_blocked})`);
    });
    
    if (morningAvailability.rows.some(slot => !slot.is_available || slot.is_blocked)) {
      console.log('\n❌ FOUND THE ISSUE: Some morning slots are marked as unavailable or blocked!');
    } else {
      console.log('\n✅ All morning slots are marked as available and not blocked');
      console.log('The issue must be in the query logic or ordering');
    }
    
  } catch (error) {
    console.error('❌ Error debugging slot ordering:', error.message);
    console.error(error.stack);
  } finally {
    await pool.end();
  }
}

debugSlotOrdering();