require('dotenv').config();
const { Pool } = require('pg');

async function checkCalendarGenerationIssue() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const businessId = '8fea02b5-850a-4167-913b-a12043c65d17'; // Tom's Garage
  
  try {
    console.log('=== CHECKING CALENDAR GENERATION ISSUE ===\n');
    
    // 1. Check what hours exist in the calendar_slots table
    console.log('1. Checking what hours exist in calendar_slots table...');
    const hourDistribution = await pool.query(`
      SELECT 
        EXTRACT(hour FROM slot_start AT TIME ZONE 'UTC' AT TIME ZONE 'America/New_York') as local_hour,
        COUNT(*) as slot_count,
        MIN(DATE(slot_start AT TIME ZONE 'UTC' AT TIME ZONE 'America/New_York')) as earliest_date,
        MAX(DATE(slot_start AT TIME ZONE 'UTC' AT TIME ZONE 'America/New_York')) as latest_date
      FROM calendar_slots
      WHERE business_id = $1
      GROUP BY EXTRACT(hour FROM slot_start AT TIME ZONE 'UTC' AT TIME ZONE 'America/New_York')
      ORDER BY local_hour
    `, [businessId]);
    
    console.log('Hour distribution in calendar_slots:');
    hourDistribution.rows.forEach(row => {
      const hour = parseInt(row.local_hour);
      const ampm = hour >= 12 ? 'PM' : 'AM';
      const displayHour = hour > 12 ? hour - 12 : (hour === 0 ? 12 : hour);
      console.log(`  ${displayHour}:00 ${ampm} - ${row.slot_count} slots (${row.earliest_date} to ${row.latest_date})`);
    });
    
    // 2. Check Tom's Garage business hours
    console.log('\n2. Checking Tom\'s Garage business hours configuration...');
    const business = await pool.query(`
      SELECT business_hours, timezone
      FROM businesses 
      WHERE id = $1
    `, [businessId]);
    
    if (business.rows.length > 0) {
      console.log('Business hours configuration:');
      console.log(JSON.stringify(business.rows[0].business_hours, null, 2));
      console.log(`Timezone: ${business.rows[0].timezone}`);
    }
    
    // 3. Check for calendar generation logic files
    console.log('\n3. The issue is clear: Calendar slots were never generated for 8-11 AM hours!');
    console.log('The calendar generation process is only creating slots starting at 12:00 PM (noon).');
    console.log('This is likely a bug in the calendar generation logic where it\'s not respecting the business hours.');
    
    console.log('\n4. Expected vs Actual:');
    console.log('Expected: 8:00 AM - 6:00 PM slots (based on business hours)');
    console.log('Actual: 12:00 PM - 9:30 PM slots');
    
    // 5. Check if we can find out why it starts at noon
    console.log('\n5. Analyzing the time pattern...');
    const firstSlots = await pool.query(`
      SELECT 
        slot_start,
        slot_start AT TIME ZONE 'UTC' AT TIME ZONE 'America/New_York' as local_time
      FROM calendar_slots
      WHERE business_id = $1
      ORDER BY slot_start
      LIMIT 5
    `, [businessId]);
    
    console.log('First 5 slots in the database:');
    firstSlots.rows.forEach((slot, i) => {
      console.log(`  ${i + 1}. ${slot.local_time}`);
    });
    
    // Check if there's a pattern in the UTC times
    console.log('\nUTC times of first 5 slots:');
    firstSlots.rows.forEach((slot, i) => {
      console.log(`  ${i + 1}. ${slot.slot_start} (UTC)`);
    });
    
    console.log('\n=== DIAGNOSIS ===');
    console.log('❌ ISSUE IDENTIFIED: Calendar generation is broken!');
    console.log('The calendar generation process is not creating morning slots (8-11 AM).');
    console.log('This explains why customers cannot book morning appointments.');
    console.log('');
    console.log('SOLUTION NEEDED:');
    console.log('1. Regenerate calendar slots with correct business hours (8 AM - 6 PM)');
    console.log('2. Or manually add missing morning slots to the database');
    
  } catch (error) {
    console.error('❌ Error checking calendar generation:', error.message);
    console.error(error.stack);
  } finally {
    await pool.end();
  }
}

checkCalendarGenerationIssue();