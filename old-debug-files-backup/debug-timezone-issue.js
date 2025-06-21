require('dotenv').config();
const { Pool } = require('pg');

async function debugTimezoneIssue() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const businessId = '8fea02b5-850a-4167-913b-a12043c65d17'; // Tom's Garage
  
  try {
    console.log('=== DEBUGGING TIMEZONE ISSUE ===\n');
    
    // 1. Check businesses table structure
    console.log('1. Checking businesses table structure...');
    const businessStructure = await pool.query(`
      SELECT column_name, data_type, is_nullable
      FROM information_schema.columns
      WHERE table_name = 'businesses'
      ORDER BY ordinal_position
    `);
    
    console.log('Businesses table columns:');
    businessStructure.rows.forEach(col => {
      console.log(`  ${col.column_name}: ${col.data_type} (nullable: ${col.is_nullable})`);
    });
    console.log('');
    
    // 2. Get business data
    console.log('2. Getting Tom\'s Garage business data...');
    const businessData = await pool.query(`
      SELECT * FROM businesses WHERE id = $1
    `, [businessId]);
    
    if (businessData.rows.length === 0) {
      console.log('❌ Business not found!');
    } else {
      console.log('✅ Business found:', businessData.rows[0]);
    }
    console.log('');
    
    // 3. Check a few sample slots and their timezone conversion
    console.log('3. Checking sample slots and timezone conversion...');
    const sampleSlots = await pool.query(`
      SELECT 
        slot_start,
        slot_start AT TIME ZONE 'UTC' AT TIME ZONE 'America/New_York' as ny_time,
        slot_end,
        EXTRACT(hour FROM slot_start AT TIME ZONE 'UTC' AT TIME ZONE 'America/New_York') as ny_hour,
        EXTRACT(dow FROM slot_start AT TIME ZONE 'UTC' AT TIME ZONE 'America/New_York') as day_of_week
      FROM calendar_slots 
      WHERE business_id = $1 
      ORDER BY slot_start
      LIMIT 10
    `, [businessId]);
    
    console.log('Sample slots with timezone conversion:');
    sampleSlots.rows.forEach((slot, i) => {
      console.log(`  ${i + 1}. UTC: ${slot.slot_start} -> NY: ${slot.ny_time} (Hour: ${slot.ny_hour}, DOW: ${slot.day_of_week})`);
    });
    console.log('');
    
    // 4. Check for ANY morning slots (6 AM - 12 PM) this week or next week
    console.log('4. Searching for ANY morning slots (6 AM - 12 PM) over next 2 weeks...');
    const morningSearch = await pool.query(`
      SELECT 
        DATE(slot_start AT TIME ZONE 'UTC' AT TIME ZONE 'America/New_York') as date,
        EXTRACT(hour FROM slot_start AT TIME ZONE 'UTC' AT TIME ZONE 'America/New_York') as hour,
        COUNT(*) as count
      FROM calendar_slots 
      WHERE business_id = $1 
        AND slot_start AT TIME ZONE 'UTC' AT TIME ZONE 'America/New_York' >= NOW() AT TIME ZONE 'America/New_York'
        AND slot_start AT TIME ZONE 'UTC' AT TIME ZONE 'America/New_York' <= (NOW() AT TIME ZONE 'America/New_York' + INTERVAL '14 days')
        AND EXTRACT(hour FROM slot_start AT TIME ZONE 'UTC' AT TIME ZONE 'America/New_York') BETWEEN 6 AND 12
      GROUP BY DATE(slot_start AT TIME ZONE 'UTC' AT TIME ZONE 'America/New_York'), EXTRACT(hour FROM slot_start AT TIME ZONE 'UTC' AT TIME ZONE 'America/New_York')
      ORDER BY date, hour
      LIMIT 20
    `, [businessId]);
    
    if (morningSearch.rows.length === 0) {
      console.log('❌ No morning slots found at all!');
    } else {
      console.log('Morning slots found:');
      morningSearch.rows.forEach(slot => {
        console.log(`  ${slot.date} ${slot.hour}:00 - ${slot.count} slots`);
      });
    }
    console.log('');
    
    // 5. Check current time and timezone
    console.log('5. Checking current time and timezone...');
    const timeCheck = await pool.query(`
      SELECT 
        NOW() as utc_now,
        NOW() AT TIME ZONE 'America/New_York' as ny_now,
        current_setting('timezone') as db_timezone
    `);
    
    console.log('Time check:');
    console.log(`  UTC now: ${timeCheck.rows[0].utc_now}`);
    console.log(`  NY now: ${timeCheck.rows[0].ny_now}`);
    console.log(`  DB timezone: ${timeCheck.rows[0].db_timezone}`);
    
  } catch (error) {
    console.error('❌ Error during investigation:', error.message);
    console.error(error.stack);
  } finally {
    await pool.end();
  }
}

debugTimezoneIssue();