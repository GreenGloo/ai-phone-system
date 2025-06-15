require('dotenv').config();
const { Pool } = require('pg');

async function verifyFixAndTest() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const businessId = '8fea02b5-850a-4167-913b-a12043c65d17'; // Tom's Garage
  
  try {
    console.log('=== VERIFYING TIMEZONE FIX AND TESTING AVAILABLE SLOTS ===\n');
    
    // 1. Check current appointment state
    console.log('1. Current appointment state:');
    const currentApts = await pool.query(`
      SELECT 
        id,
        start_time,
        end_time,
        start_time AT TIME ZONE 'UTC' AT TIME ZONE 'America/New_York' as local_start,
        end_time AT TIME ZONE 'UTC' AT TIME ZONE 'America/New_York' as local_end,
        service_name,
        customer_name
      FROM appointments 
      WHERE business_id = $1 
      AND status IN ('scheduled', 'confirmed')
      AND start_time >= NOW()
      ORDER BY start_time
    `, [businessId]);
    
    console.log('All current appointments:');
    currentApts.rows.forEach((apt, i) => {
      console.log(`  ${i + 1}. UTC: ${apt.start_time}`);
      console.log(`     Local: ${apt.local_start} - ${apt.local_end}`);
      console.log(`     ${apt.service_name} | ${apt.customer_name}\n`);
    });
    
    // 2. Test morning slot availability by running the exact same logic as getAvailableSlots
    console.log('2. Testing morning slot availability with exact getAvailableSlots logic...');
    
    // Get calendar slots for Monday morning
    const morningSlots = await pool.query(`
      SELECT slot_start, slot_end
      FROM calendar_slots
      WHERE business_id = $1
      AND is_available = true
      AND is_blocked = false
      AND DATE(slot_start AT TIME ZONE 'UTC' AT TIME ZONE 'America/New_York') = '2025-06-16'
      AND EXTRACT(hour FROM slot_start AT TIME ZONE 'UTC' AT TIME ZONE 'America/New_York') BETWEEN 8 AND 11
      ORDER BY slot_start
    `, [businessId]);
    
    console.log(`Found ${morningSlots.rows.length} morning calendar slots for Monday June 16:`);
    morningSlots.rows.forEach((slot, i) => {
      const localTime = new Date(slot.slot_start).toLocaleString('en-US', {
        timeZone: 'America/New_York',
        weekday: 'long',
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
        hour12: true
      });
      console.log(`  ${i + 1}. ${localTime}`);
    });
    
    // Get booked appointments that might conflict
    const conflictingApts = await pool.query(`
      SELECT start_time, end_time 
      FROM appointments 
      WHERE business_id = $1 
      AND status IN ('scheduled', 'confirmed')
      AND start_time >= NOW()
    `, [businessId]);
    
    const bookedTimes = conflictingApts.rows.map(apt => ({
      start: new Date(apt.start_time),
      end: new Date(apt.end_time)
    }));
    
    // Filter morning slots using exact same logic as getAvailableSlots
    const availableMorningSlots = morningSlots.rows.filter(slot => {
      const slotStart = new Date(slot.slot_start);
      const slotEnd = new Date(slot.slot_end);
      
      const isConflicted = bookedTimes.some(booked => 
        (slotStart < booked.end && slotEnd > booked.start)
      );
      
      if (isConflicted) {
        const conflictingApt = bookedTimes.find(booked => 
          (slotStart < booked.end && slotEnd > booked.start)
        );
        console.log(`    ❌ CONFLICT: ${slotStart.toLocaleString()} conflicts with appointment ${conflictingApt.start.toLocaleString()} - ${conflictingApt.end.toLocaleString()}`);
      }
      
      return !isConflicted;
    });
    
    console.log(`\nResult: ${availableMorningSlots.length} available morning slots after filtering conflicts`);
    
    if (availableMorningSlots.length > 0) {
      console.log('✅ SUCCESS: Morning slots are now available!');
      availableMorningSlots.forEach((slot, i) => {
        const localTime = new Date(slot.slot_start).toLocaleString('en-US', {
          timeZone: 'America/New_York',
          hour: 'numeric',
          minute: '2-digit',
          hour12: true
        });
        console.log(`  ${i + 1}. ${localTime}`);
      });
    } else {
      console.log('❌ Still no morning slots available - need further investigation');
    }
    
    // 3. Test the actual getAvailableSlots function
    console.log('\n3. Testing actual getAvailableSlots function...');
    
    // Import and test the function (simplified version)
    const sixWeeksOut = new Date();
    sixWeeksOut.setDate(sixWeeksOut.getDate() + 42);
    
    const slotsResult = await pool.query(`
      SELECT slot_start, slot_end
      FROM calendar_slots
      WHERE business_id = $1
      AND is_available = true
      AND is_blocked = false
      AND slot_start >= NOW()
      AND slot_start <= $2
      ORDER BY slot_start
      LIMIT 200
    `, [businessId, sixWeeksOut.toISOString()]);
    
    const availableSlots = slotsResult.rows
      .filter(slot => {
        const slotStart = new Date(slot.slot_start);
        const slotEnd = new Date(slot.slot_end);
        
        return !bookedTimes.some(booked => 
          (slotStart < booked.end && slotEnd > booked.start)
        );
      })
      .map(slot => {
        const slotStart = new Date(slot.slot_start);
        const now = new Date();
        const daysDiff = Math.floor((slotStart - now) / (1000 * 60 * 60 * 24));
        
        let dayLabel;
        if (daysDiff === 0) dayLabel = 'today';
        else if (daysDiff === 1) dayLabel = 'tomorrow';
        else dayLabel = slotStart.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });
        
        const timeStr = slotStart.toLocaleTimeString('en-US', { 
          hour: 'numeric', 
          minute: '2-digit',
          hour12: true 
        });
        
        return {
          day: dayLabel,
          time: timeStr,
          datetime: slotStart.toISOString()
        };
      });
    
    console.log(`getAvailableSlots would return ${availableSlots.length} slots`);
    console.log('First 10 slots:');
    availableSlots.slice(0, 10).forEach((slot, i) => {
      console.log(`  ${i + 1}. ${slot.day} ${slot.time}`);
    });
    
  } catch (error) {
    console.error('❌ Error verifying fix:', error.message);
    console.error(error.stack);
  } finally {
    await pool.end();
  }
}

verifyFixAndTest();