require('dotenv').config();
const { Pool } = require('pg');

async function understandTimezoneStorage() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const businessId = '8fea02b5-850a-4167-913b-a12043c65d17'; // Tom's Garage
  
  try {
    console.log('=== UNDERSTANDING TIMEZONE STORAGE ===\n');
    
    console.log('Goal: Store a slot for Monday June 16, 2025 at 8:00 AM Eastern time');
    console.log('We want JavaScript to show this as 8:00 AM when using toLocaleTimeString()');
    console.log('');
    
    // Test different approaches to storing 8:00 AM EDT
    console.log('Testing different approaches...\n');
    
    // Approach 1: Store as 8:00 AM UTC (wrong)
    const approach1 = new Date('2025-06-16T08:00:00Z');
    console.log('Approach 1: Store as 8:00 AM UTC');
    console.log(`  Stored: ${approach1.toISOString()}`);
    console.log(`  JS shows: ${approach1.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })}`);
    console.log(`  Expected: 8:00 AM, Got: ${approach1.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })}`);
    console.log('');
    
    // Approach 2: Store as 12:00 PM UTC (8:00 AM EDT = 12:00 PM UTC)
    const approach2 = new Date('2025-06-16T12:00:00Z');
    console.log('Approach 2: Store as 12:00 PM UTC (8:00 AM EDT)');
    console.log(`  Stored: ${approach2.toISOString()}`);
    console.log(`  JS shows: ${approach2.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })}`);
    console.log(`  Expected: 8:00 AM, Got: ${approach2.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })}`);
    console.log('');
    
    // Test what we need to store to get 8:00 AM
    const targetTime = new Date('2025-06-16');
    targetTime.setHours(8, 0, 0, 0); // This creates 8:00 AM in local time
    
    console.log('What we SHOULD store to get 8:00 AM:');
    console.log(`  Target local time: 8:00 AM`);
    console.log(`  JavaScript Date object: ${targetTime}`);
    console.log(`  ISO string: ${targetTime.toISOString()}`);
    console.log(`  Shows as: ${targetTime.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })}`);
    console.log('');
    
    // Test the database query that we know returns morning slots
    console.log('Checking what database currently returns for morning slots...');
    const currentMorningSlots = await pool.query(`
      SELECT 
        slot_start,
        slot_start AT TIME ZONE 'UTC' AT TIME ZONE 'America/New_York' as local_time
      FROM calendar_slots
      WHERE business_id = $1
      AND DATE(slot_start AT TIME ZONE 'UTC' AT TIME ZONE 'America/New_York') = '2025-06-16'
      AND EXTRACT(hour FROM slot_start AT TIME ZONE 'UTC' AT TIME ZONE 'America/New_York') = 8
      LIMIT 2
    `, [businessId]);
    
    if (currentMorningSlots.rows.length > 0) {
      console.log('Database shows 8 AM slots exist:');
      currentMorningSlots.rows.forEach((slot, i) => {
        const jsDate = new Date(slot.slot_start);
        const jsTime = jsDate.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
        console.log(`  ${i + 1}. DB: ${slot.slot_start} -> PG Local: ${slot.local_time} -> JS: ${jsTime}`);
      });
    } else {
      console.log('No 8 AM slots found in database');
    }
    
    console.log('\n=== SOLUTION ===');
    console.log('The issue is that we need to store timestamps that JavaScript will interpret correctly.');
    console.log('If we want JS to show 8:00 AM, we need to store the timestamp that represents 8:00 AM in the server timezone.');
    console.log('');
    console.log('Correct approach: Use JavaScript Date constructor with local time, then store the ISO string.');
    
    // Create a proper 8:00 AM slot
    const correctSlot = new Date('2025-06-16T08:00:00'); // This will be interpreted as local time
    console.log(`Correct storage for 8:00 AM: ${correctSlot.toISOString()}`);
    console.log(`Will display as: ${correctSlot.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })}`);
    
  } catch (error) {
    console.error('❌ Error understanding timezone storage:', error.message);
    console.error(error.stack);
  } finally {
    await pool.end();
  }
}

understandTimezoneStorage();