require('dotenv').config();
const { Pool } = require('pg');

async function debugMorningSlots() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const businessId = '8fea02b5-850a-4167-913b-a12043c65d17'; // Tom's Garage
  
  try {
    console.log('=== DEBUGGING MORNING APPOINTMENT SLOTS ===\n');
    
    // 1. Check if calendar_slots table exists and has data
    console.log('1. Checking calendar_slots table...');
    const tableExists = await pool.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_name = 'calendar_slots'
      )
    `);
    
    if (!tableExists.rows[0].exists) {
      console.log('❌ calendar_slots table does not exist!');
      return;
    }
    
    const totalSlots = await pool.query('SELECT COUNT(*) FROM calendar_slots WHERE business_id = $1', [businessId]);
    console.log(`✅ calendar_slots table exists with ${totalSlots.rows[0].count} total slots for Tom's Garage\n`);
    
    // 2. Check for Monday June 16, 2025 9:00 AM slots specifically
    console.log('2. Checking for Monday June 16, 2025 9:00 AM slots...');
    const mondayMorningSlots = await pool.query(`
      SELECT 
        slot_start,
        slot_start AT TIME ZONE 'America/New_York' as local_time,
        is_available
      FROM calendar_slots 
      WHERE business_id = $1 
        AND DATE(slot_start AT TIME ZONE 'America/New_York') = '2025-06-16'
        AND EXTRACT(hour FROM slot_start AT TIME ZONE 'America/New_York') = 9
      ORDER BY slot_start
    `, [businessId]);
    
    if (mondayMorningSlots.rows.length === 0) {
      console.log('❌ No 9 AM slots found for Monday June 16, 2025');
    } else {
      console.log(`✅ Found ${mondayMorningSlots.rows.length} slots at 9 AM on Monday June 16, 2025:`);
      mondayMorningSlots.rows.forEach(slot => {
        console.log(`  - ${slot.local_time} - Available: ${slot.is_available}`);
      });
    }
    console.log('');
    
    // 3. Check morning slots in general (8 AM - 11 AM) for the next week
    console.log('3. Checking all morning slots (8-11 AM) for next week...');
    const morningSlots = await pool.query(`
      SELECT 
        DATE(slot_start AT TIME ZONE 'America/New_York') as date,
        EXTRACT(hour FROM slot_start AT TIME ZONE 'America/New_York') as hour,
        COUNT(*) as slot_count,
        COUNT(*) FILTER (WHERE is_available = true) as available_count
      FROM calendar_slots 
      WHERE business_id = $1 
        AND slot_start AT TIME ZONE 'America/New_York' >= NOW() AT TIME ZONE 'America/New_York'
        AND slot_start AT TIME ZONE 'America/New_York' <= (NOW() AT TIME ZONE 'America/New_York' + INTERVAL '7 days')
        AND EXTRACT(hour FROM slot_start AT TIME ZONE 'America/New_York') BETWEEN 8 AND 11
      GROUP BY DATE(slot_start AT TIME ZONE 'America/New_York'), EXTRACT(hour FROM slot_start AT TIME ZONE 'America/New_York')
      ORDER BY date, hour
    `, [businessId]);
    
    if (morningSlots.rows.length === 0) {
      console.log('❌ No morning slots (8-11 AM) found for the next week');
    } else {
      console.log('Morning slots summary for next 7 days:');
      morningSlots.rows.forEach(slot => {
        console.log(`  ${slot.date} ${slot.hour}:00 - ${slot.slot_count} total, ${slot.available_count} available`);
      });
    }
    console.log('');
    
    // 4. Check business hours configuration
    console.log('4. Checking Tom\'s Garage business configuration...');
    const businessConfig = await pool.query(`
      SELECT business_name, phone_number, business_hours, timezone
      FROM businesses 
      WHERE business_id = $1
    `, [businessId]);
    
    if (businessConfig.rows.length === 0) {
      console.log('❌ Business not found!');
    } else {
      const business = businessConfig.rows[0];
      console.log(`✅ Business: ${business.business_name}`);
      console.log(`   Phone: ${business.phone_number}`);
      console.log(`   Hours: ${business.business_hours}`);
      console.log(`   Timezone: ${business.timezone}`);
    }
    console.log('');
    
    // 5. Check recent slot generation timestamp
    console.log('5. Checking when slots were last generated...');
    const latestSlot = await pool.query(`
      SELECT 
        MAX(slot_start) as latest_slot,
        MIN(slot_start) as earliest_slot,
        COUNT(*) as total_count
      FROM calendar_slots 
      WHERE business_id = $1
    `, [businessId]);
    
    if (latestSlot.rows[0].latest_slot) {
      console.log(`✅ Slots range from ${latestSlot.rows[0].earliest_slot} to ${latestSlot.rows[0].latest_slot}`);
      console.log(`   Total slots: ${latestSlot.rows[0].total_count}`);
    }
    
  } catch (error) {
    console.error('❌ Error during investigation:', error.message);
    console.error(error.stack);
  } finally {
    await pool.end();
  }
}

debugMorningSlots();