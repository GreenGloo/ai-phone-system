require('dotenv').config();
const { Pool } = require('pg');

async function debugGetAvailableSlotsQuery() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const businessId = '8fea02b5-850a-4167-913b-a12043c65d17'; // Tom's Garage
  
  try {
    console.log('=== DEBUGGING getAvailableSlots QUERY LOGIC ===\n');
    
    // 1. Test the exact query from getAvailableSlots
    const sixWeeksOut = new Date();
    sixWeeksOut.setDate(sixWeeksOut.getDate() + 42);
    
    console.log('1. Testing the exact query from getAvailableSlots...');
    console.log(`Query date range: NOW to ${sixWeeksOut.toISOString()}`);
    
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
    
    console.log(`Raw query returned ${slotsResult.rows.length} slots`);
    
    // Show first 10 slots with timezone info
    console.log('\nFirst 10 raw slots:');
    slotsResult.rows.slice(0, 10).forEach((slot, i) => {
      const utcTime = new Date(slot.slot_start);
      const localTime = utcTime.toLocaleString('en-US', {
        timeZone: 'America/New_York',
        weekday: 'short',
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
        hour12: true
      });
      console.log(`  ${i + 1}. UTC: ${slot.slot_start} -> Local: ${localTime}`);
    });
    
    // 2. Test the filter logic for appointments
    console.log('\n2. Testing appointment filtering logic...');
    const existingAppointments = await pool.query(`
      SELECT start_time, end_time 
      FROM appointments 
      WHERE business_id = $1 
      AND status IN ('scheduled', 'confirmed')
      AND start_time >= NOW()
    `, [businessId]);
    
    console.log(`Found ${existingAppointments.rows.length} appointments to filter`);
    
    const bookedTimes = existingAppointments.rows.map(apt => ({
      start: new Date(apt.start_time),
      end: new Date(apt.end_time)
    }));
    
    // Test filtering on first 20 slots
    console.log('\n3. Testing conflict detection on first 20 slots...');
    const firstTwentySlots = slotsResult.rows.slice(0, 20);
    
    firstTwentySlots.forEach((slot, i) => {
      const slotStart = new Date(slot.slot_start);
      const slotEnd = new Date(slot.slot_end);
      
      const conflict = bookedTimes.find(booked => 
        (slotStart < booked.end && slotEnd > booked.start)
      );
      
      const localTime = slotStart.toLocaleString('en-US', {
        timeZone: 'America/New_York',
        hour: 'numeric',
        minute: '2-digit',
        hour12: true
      });
      
      if (conflict) {
        const conflictLocalStart = conflict.start.toLocaleString('en-US', {
          timeZone: 'America/New_York',
          hour: 'numeric',
          minute: '2-digit',
          hour12: true
        });
        const conflictLocalEnd = conflict.end.toLocaleString('en-US', {
          timeZone: 'America/New_York',
          hour: 'numeric',
          minute: '2-digit',
          hour12: true
        });
        console.log(`  ${i + 1}. ${localTime} - ❌ BLOCKED (conflicts with ${conflictLocalStart} - ${conflictLocalEnd})`);
      } else {
        console.log(`  ${i + 1}. ${localTime} - ✅ AVAILABLE`);
      }
    });
    
    // 4. Check if the issue is in the "NOW()" comparison
    console.log('\n4. Checking NOW() comparison...');
    const nowCheck = await pool.query(`
      SELECT 
        NOW() as db_now,
        NOW() AT TIME ZONE 'America/New_York' as db_now_local
    `);
    
    const dbNow = nowCheck.rows[0].db_now;
    const dbNowLocal = nowCheck.rows[0].db_now_local;
    
    console.log(`Database NOW(): ${dbNow}`);
    console.log(`Database NOW() local: ${dbNowLocal}`);
    
    // Check if any morning slots are being filtered out by NOW()
    const morningSlotCheck = await pool.query(`
      SELECT 
        slot_start,
        slot_start AT TIME ZONE 'UTC' AT TIME ZONE 'America/New_York' as local_time,
        slot_start >= NOW() as is_future
      FROM calendar_slots
      WHERE business_id = $1
      AND DATE(slot_start AT TIME ZONE 'UTC' AT TIME ZONE 'America/New_York') = '2025-06-16'
      AND EXTRACT(hour FROM slot_start AT TIME ZONE 'UTC' AT TIME ZONE 'America/New_York') BETWEEN 8 AND 11
      ORDER BY slot_start
    `, [businessId]);
    
    console.log('\nMonday morning slots and their future status:');
    morningSlotCheck.rows.forEach((slot, i) => {
      console.log(`  ${i + 1}. ${slot.local_time} - Future: ${slot.is_future}`);
    });
    
  } catch (error) {
    console.error('❌ Error debugging getAvailableSlots query:', error.message);
    console.error(error.stack);
  } finally {
    await pool.end();
  }
}

debugGetAvailableSlotsQuery();