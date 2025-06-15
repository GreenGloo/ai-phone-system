require('dotenv').config();
const { Pool } = require('pg');

async function simpleCalendarFix() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  
  try {
    console.log('🔧 SIMPLE CALENDAR FIX - IGNORE TIMEZONE COMPLEXITY');
    console.log('='.repeat(60));
    
    const businessId = '8fea02b5-850a-4167-913b-a12043c65d17';
    
    // The real issue: The existing calendar slots in the database show only 12 PM onwards
    // This means the calendar generator has been consistently creating only afternoon slots
    // Let's just regenerate the calendar properly without overthinking timezone
    
    console.log('Step 1: Check what the AI booking system actually expects...');
    
    // Check how existing appointments are stored
    const existingAppointments = await pool.query(`
      SELECT 
        customer_name,
        service_name,
        start_time,
        EXTRACT(hour FROM start_time) as hour_utc,
        start_time AT TIME ZONE 'America/New_York' as local_time
      FROM appointments 
      WHERE business_id = $1 
        AND start_time >= '2025-06-16 00:00:00'::timestamp
        AND start_time < '2025-06-17 00:00:00'::timestamp
      ORDER BY start_time
    `, [businessId]);
    
    console.log(`\nExisting appointments for June 16, 2025:`);
    existingAppointments.rows.forEach(apt => {
      console.log(`  ${apt.customer_name} - ${apt.service_name}`);
      console.log(`    UTC: ${apt.start_time} (hour: ${apt.hour_utc})`);
      console.log(`    Local: ${apt.local_time}`);
    });
    
    // The key insight: Look at the existing 8 AM and 9 AM appointments
    // They are stored as 12:00:00 UTC and 13:00:00 UTC
    // This means: 8 AM Eastern = 12 PM UTC, 9 AM Eastern = 1 PM UTC
    // So Eastern is UTC-4 (Eastern Daylight Time)
    
    console.log('\nStep 2: Generate slots using the same timezone logic as existing appointments...');
    
    // Clear tomorrow's slots
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    
    await pool.query(`
      DELETE FROM calendar_slots 
      WHERE business_id = $1 
      AND slot_start >= $2::date
      AND slot_start < ($2::date + INTERVAL '1 day')
    `, [businessId, tomorrow.toISOString().split('T')[0]]);
    
    // Generate slots using the same pattern as existing appointments
    // 8 AM Eastern = 12 PM UTC, 9 AM Eastern = 1 PM UTC, etc.
    const baseDate = tomorrow.toISOString().split('T')[0]; // YYYY-MM-DD
    
    const slotsToCreate = [
      { localHour: 8, localMin: 0, utcHour: 12, utcMin: 0 },   // 8:00 AM Eastern = 12:00 PM UTC
      { localHour: 8, localMin: 30, utcHour: 12, utcMin: 30 }, // 8:30 AM Eastern = 12:30 PM UTC
      { localHour: 9, localMin: 0, utcHour: 13, utcMin: 0 },   // 9:00 AM Eastern = 1:00 PM UTC
      { localHour: 9, localMin: 30, utcHour: 13, utcMin: 30 }, // 9:30 AM Eastern = 1:30 PM UTC
      { localHour: 10, localMin: 0, utcHour: 14, utcMin: 0 },  // 10:00 AM Eastern = 2:00 PM UTC
      { localHour: 10, localMin: 30, utcHour: 14, utcMin: 30 },// 10:30 AM Eastern = 2:30 PM UTC
      { localHour: 11, localMin: 0, utcHour: 15, utcMin: 0 },  // 11:00 AM Eastern = 3:00 PM UTC
      { localHour: 11, localMin: 30, utcHour: 15, utcMin: 30 },// 11:30 AM Eastern = 3:30 PM UTC
      { localHour: 12, localMin: 0, utcHour: 16, utcMin: 0 },  // 12:00 PM Eastern = 4:00 PM UTC
      { localHour: 12, localMin: 30, utcHour: 16, utcMin: 30 },// 12:30 PM Eastern = 4:30 PM UTC
      { localHour: 13, localMin: 0, utcHour: 17, utcMin: 0 },  // 1:00 PM Eastern = 5:00 PM UTC
      { localHour: 13, localMin: 30, utcHour: 17, utcMin: 30 },// 1:30 PM Eastern = 5:30 PM UTC
      { localHour: 14, localMin: 0, utcHour: 18, utcMin: 0 },  // 2:00 PM Eastern = 6:00 PM UTC
      { localHour: 14, localMin: 30, utcHour: 18, utcMin: 30 },// 2:30 PM Eastern = 6:30 PM UTC
      { localHour: 15, localMin: 0, utcHour: 19, utcMin: 0 },  // 3:00 PM Eastern = 7:00 PM UTC
      { localHour: 15, localMin: 30, utcHour: 19, utcMin: 30 },// 3:30 PM Eastern = 7:30 PM UTC
      { localHour: 16, localMin: 0, utcHour: 20, utcMin: 0 },  // 4:00 PM Eastern = 8:00 PM UTC
      { localHour: 16, localMin: 30, utcHour: 20, utcMin: 30 },// 4:30 PM Eastern = 8:30 PM UTC
      { localHour: 17, localMin: 0, utcHour: 21, utcMin: 0 },  // 5:00 PM Eastern = 9:00 PM UTC
      { localHour: 17, localMin: 30, utcHour: 21, utcMin: 30 } // 5:30 PM Eastern = 9:30 PM UTC
    ];
    
    console.log('Creating slots with explicit UTC times matching existing appointment pattern...');
    
    let insertedCount = 0;
    let morningSlots = 0;
    
    for (const slot of slotsToCreate) {
      const utcTime = `${baseDate}T${slot.utcHour.toString().padStart(2, '0')}:${slot.utcMin.toString().padStart(2, '0')}:00.000Z`;
      const endTime = new Date(new Date(utcTime).getTime() + 60 * 60000).toISOString(); // +1 hour
      
      try {
        await pool.query(`
          INSERT INTO calendar_slots (business_id, slot_start, slot_end, is_available)
          VALUES ($1, $2, $3, $4)
        `, [businessId, utcTime, endTime, true]);
        
        const localTimeStr = `${slot.localHour}:${slot.localMin.toString().padStart(2, '0')} ${slot.localHour >= 12 ? 'PM' : 'AM'}`;
        console.log(`  ✅ Inserted: ${localTimeStr} Eastern → ${utcTime}`);
        
        insertedCount++;
        if (slot.localHour >= 8 && slot.localHour < 12) {
          morningSlots++;
        }
      } catch (error) {
        console.error(`  ❌ Failed to insert slot:`, error.message);
      }
    }
    
    console.log(`\n📊 RESULTS:`);
    console.log(`Total slots inserted: ${insertedCount}`);
    console.log(`Morning slots (8 AM - 12 PM Eastern): ${morningSlots}`);
    
    // Verify the fix
    console.log('\nStep 3: Verify the morning slots now exist...');
    
    const morningCheck = await pool.query(`
      SELECT 
        slot_start,
        slot_start AT TIME ZONE 'America/New_York' as eastern_time
      FROM calendar_slots 
      WHERE business_id = $1 
        AND slot_start >= $2::date
        AND slot_start < ($2::date + INTERVAL '1 day')
        AND EXTRACT(hour FROM (slot_start AT TIME ZONE 'America/New_York')) >= 8
        AND EXTRACT(hour FROM (slot_start AT TIME ZONE 'America/New_York')) < 12
      ORDER BY slot_start
    `, [businessId, tomorrow.toISOString().split('T')[0]]);
    
    console.log(`Found ${morningCheck.rows.length} morning slots:`);
    morningCheck.rows.forEach(slot => {
      console.log(`  ${slot.eastern_time} (stored as ${slot.slot_start})`);
    });
    
    // Check specifically for 9 AM
    const nineAmCheck = await pool.query(`
      SELECT 
        slot_start,
        slot_start AT TIME ZONE 'America/New_York' as eastern_time,
        is_available
      FROM calendar_slots 
      WHERE business_id = $1 
        AND slot_start >= '${baseDate}T13:00:00'::timestamp
        AND slot_start < '${baseDate}T13:30:00'::timestamp
    `, [businessId]);
    
    if (nineAmCheck.rows.length > 0) {
      const slot = nineAmCheck.rows[0];
      console.log(`\n✅ 9 AM SLOT CONFIRMED:`);
      console.log(`  Eastern time: ${slot.eastern_time}`);
      console.log(`  UTC storage: ${slot.slot_start}`);
      console.log(`  Available: ${slot.is_available}`);
      
      // Check for conflicts
      const conflicts = await pool.query(`
        SELECT customer_name, service_name
        FROM appointments 
        WHERE business_id = $1 
          AND start_time <= $2
          AND end_time > $2
          AND status IN ('scheduled', 'confirmed')
      `, [businessId, slot.slot_start]);
      
      if (conflicts.rows.length > 0) {
        console.log(`  ⚠️  CONFLICT: ${conflicts.rows[0].customer_name} - ${conflicts.rows[0].service_name}`);
        console.log(`  Customer needs to pick a different time`);
      } else {
        console.log(`  ✅ NO CONFLICTS - 9 AM is available for booking!`);
      }
    } else {
      console.log(`\n❌ 9 AM slot still not found`);
    }
    
    console.log('\n🎯 SIMPLE FIX SUMMARY:');
    if (morningSlots > 0 && morningCheck.rows.length > 0) {
      console.log('✅ SUCCESS: Morning slots are now properly generated!');
      console.log('✅ 9 AM slots should now be available for customer booking');
      console.log('✅ Issue #1 (Missing 9 AM slots) is FIXED');
    } else {
      console.log('❌ Still having issues - may need to check calendar generator code');
    }
    
  } catch (error) {
    console.error('❌ Simple fix error:', error);
  } finally {
    await pool.end();
  }
}

simpleCalendarFix();