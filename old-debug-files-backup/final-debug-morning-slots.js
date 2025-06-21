require('dotenv').config();
const { Pool } = require('pg');

async function finalDebugMorningSlots() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const businessId = '8fea02b5-850a-4167-913b-a12043c65d17'; // Tom's Garage
  
  try {
    console.log('=== FINAL DEBUG: ARE MORNING SLOTS (8-11 AM) ACTUALLY AVAILABLE? ===\n');
    
    // Check TRUE morning slots (8 AM, 9 AM, 10 AM, 11 AM) on Monday
    console.log('1. Checking for TRUE morning slots (8-11 AM) on Monday June 16...');
    const trueMorningSlots = await pool.query(`
      SELECT 
        slot_start,
        slot_start AT TIME ZONE 'UTC' AT TIME ZONE 'America/New_York' as local_time,
        EXTRACT(hour FROM slot_start AT TIME ZONE 'UTC' AT TIME ZONE 'America/New_York') as local_hour
      FROM calendar_slots
      WHERE business_id = $1
      AND is_available = true
      AND is_blocked = false
      AND DATE(slot_start AT TIME ZONE 'UTC' AT TIME ZONE 'America/New_York') = '2025-06-16'
      AND EXTRACT(hour FROM slot_start AT TIME ZONE 'UTC' AT TIME ZONE 'America/New_York') BETWEEN 8 AND 11
      ORDER BY slot_start
    `, [businessId]);
    
    console.log(`Found ${trueMorningSlots.rows.length} TRUE morning calendar slots:`);
    trueMorningSlots.rows.forEach((slot, i) => {
      console.log(`  ${i + 1}. ${slot.local_time} (Hour: ${slot.local_hour})`);
    });
    
    if (trueMorningSlots.rows.length === 0) {
      console.log('❌ No 8-11 AM slots found in calendar_slots table!');
      
      // Check what hours DO exist
      console.log('\n2. Checking what hours DO exist for Monday June 16...');
      const allMondaySlots = await pool.query(`
        SELECT 
          EXTRACT(hour FROM slot_start AT TIME ZONE 'UTC' AT TIME ZONE 'America/New_York') as local_hour,
          COUNT(*) as slot_count
        FROM calendar_slots
        WHERE business_id = $1
        AND is_available = true
        AND is_blocked = false
        AND DATE(slot_start AT TIME ZONE 'UTC' AT TIME ZONE 'America/New_York') = '2025-06-16'
        GROUP BY EXTRACT(hour FROM slot_start AT TIME ZONE 'UTC' AT TIME ZONE 'America/New_York')
        ORDER BY local_hour
      `, [businessId]);
      
      console.log('Hours that DO exist on Monday June 16:');
      allMondaySlots.rows.forEach(slot => {
        const hour = parseInt(slot.local_hour);
        const ampm = hour >= 12 ? 'PM' : 'AM';
        const displayHour = hour > 12 ? hour - 12 : (hour === 0 ? 12 : hour);
        console.log(`  ${displayHour}:00 ${ampm} - ${slot.slot_count} slots`);
      });
      
      return;
    }
    
    // Check appointments that might conflict with these TRUE morning slots
    console.log('\n3. Checking for appointment conflicts with TRUE morning slots...');
    const allAppointments = await pool.query(`
      SELECT 
        start_time, 
        end_time,
        start_time AT TIME ZONE 'UTC' AT TIME ZONE 'America/New_York' as local_start,
        end_time AT TIME ZONE 'UTC' AT TIME ZONE 'America/New_York' as local_end,
        service_name
      FROM appointments 
      WHERE business_id = $1 
      AND status IN ('scheduled', 'confirmed')
      AND start_time >= NOW()
      ORDER BY start_time
    `, [businessId]);
    
    const bookedTimes = allAppointments.rows.map(apt => ({
      start: new Date(apt.start_time),
      end: new Date(apt.end_time),
      localStart: apt.local_start,
      localEnd: apt.local_end,
      service: apt.service_name
    }));
    
    // Test each TRUE morning slot for conflicts
    let availableCount = 0;
    trueMorningSlots.rows.forEach(slot => {
      const slotStart = new Date(slot.slot_start);
      const slotEnd = new Date(slotStart.getTime() + 60 * 60 * 1000); // 1 hour duration
      
      const conflict = bookedTimes.find(booked => 
        (slotStart < booked.end && slotEnd > booked.start)
      );
      
      if (conflict) {
        console.log(`  ❌ ${slot.local_time} - BLOCKED by ${conflict.service} (${conflict.localStart} - ${conflict.localEnd})`);
      } else {
        console.log(`  ✅ ${slot.local_time} - AVAILABLE`);
        availableCount++;
      }
    });
    
    console.log(`\n=== FINAL RESULT ===`);
    if (availableCount > 0) {
      console.log(`✅ SUCCESS: ${availableCount} TRUE morning slots (8-11 AM) are available!`);
      console.log('🎉 Morning appointments should now be bookable by customers!');
    } else {
      console.log(`❌ FAILURE: No TRUE morning slots (8-11 AM) are available.`);
      console.log('🔍 All morning slots are still blocked by appointments.');
    }
    
  } catch (error) {
    console.error('❌ Error in final debug:', error.message);
    console.error(error.stack);
  } finally {
    await pool.end();
  }
}

finalDebugMorningSlots();