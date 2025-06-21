require('dotenv').config();
const { Pool } = require('pg');

async function fixCalendarTimezoneStorage() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const businessId = '8fea02b5-850a-4167-913b-a12043c65d17'; // Tom's Garage
  
  try {
    console.log('=== FIXING CALENDAR TIMEZONE STORAGE ISSUE ===\n');
    
    console.log('🔍 DIAGNOSIS: Calendar slots are stored with incorrect timezone data');
    console.log('   - Slots that should be 8:00 AM local are stored as 12:00 PM timestamps');
    console.log('   - This happens because they were stored as local times but treated as UTC');
    console.log('   - JavaScript then interprets them as the wrong local time');
    console.log('');
    
    // 1. Check a sample of current problematic slots
    console.log('1. Current problematic Monday morning slots:');
    const currentSlots = await pool.query(`
      SELECT 
        slot_start,
        slot_end,
        slot_start AT TIME ZONE 'UTC' AT TIME ZONE 'America/New_York' as local_time
      FROM calendar_slots
      WHERE business_id = $1
      AND DATE(slot_start AT TIME ZONE 'UTC' AT TIME ZONE 'America/New_York') = '2025-06-16'
      AND EXTRACT(hour FROM slot_start AT TIME ZONE 'UTC' AT TIME ZONE 'America/New_York') BETWEEN 8 AND 11
      ORDER BY slot_start
      LIMIT 8
    `, [businessId]);
    
    currentSlots.rows.forEach((slot, i) => {
      console.log(`  ${i + 1}. Stored as: ${slot.slot_start} -> Shows as: ${slot.local_time}`);
    });
    
    console.log('\n2. The fix: Convert stored times to proper UTC...');
    console.log('   If a slot is stored as 12:00 PM but should show as 8:00 AM local:');
    console.log('   We need to shift it by 4 hours earlier (12:00 PM -> 8:00 AM UTC)');
    console.log('   Because 8:00 AM EDT = 12:00 PM UTC');
    
    // 3. Apply the fix - shift all slots 4 hours earlier
    console.log('\n3. Applying the timezone fix...');
    
    const updateResult = await pool.query(`
      UPDATE calendar_slots 
      SET 
        slot_start = slot_start - INTERVAL '4 hours',
        slot_end = slot_end - INTERVAL '4 hours',
        updated_at = CURRENT_TIMESTAMP
      WHERE business_id = $1
    `, [businessId]);
    
    console.log(`✅ Updated ${updateResult.rowCount} calendar slots`);
    
    // 4. Verify the fix
    console.log('\n4. Verifying the fix...');
    const fixedSlots = await pool.query(`
      SELECT 
        slot_start,
        slot_end,
        slot_start AT TIME ZONE 'UTC' AT TIME ZONE 'America/New_York' as local_time
      FROM calendar_slots
      WHERE business_id = $1
      AND DATE(slot_start AT TIME ZONE 'UTC' AT TIME ZONE 'America/New_York') = '2025-06-16'
      AND EXTRACT(hour FROM slot_start AT TIME ZONE 'UTC' AT TIME ZONE 'America/New_York') BETWEEN 8 AND 11
      ORDER BY slot_start
      LIMIT 8
    `, [businessId]);
    
    console.log('Fixed Monday morning slots:');
    fixedSlots.rows.forEach((slot, i) => {
      console.log(`  ${i + 1}. Stored as: ${slot.slot_start} -> Shows as: ${slot.local_time}`);
    });
    
    // 5. Test that getAvailableSlots now works correctly
    console.log('\n5. Testing getAvailableSlots function...');
    
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
      LIMIT 50
    `, [businessId, sixWeeksOut.toISOString()]);
    
    const existingAppointments = await pool.query(`
      SELECT start_time, end_time 
      FROM appointments 
      WHERE business_id = $1 
      AND status IN ('scheduled', 'confirmed')
      AND start_time >= NOW()
    `, [businessId]);
    
    const bookedTimes = existingAppointments.rows.map(apt => ({
      start: new Date(apt.start_time),
      end: new Date(apt.end_time)
    }));
    
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
    
    console.log(`getAvailableSlots returned ${availableSlots.length} slots`);
    console.log('\nFirst 10 available slots:');
    availableSlots.slice(0, 10).forEach((slot, i) => {
      console.log(`  ${i + 1}. ${slot.day} ${slot.time}`);
    });
    
    // Check for morning slots
    const morningSlots = availableSlots.filter(slot => {
      const hour = parseInt(slot.time.split(':')[0]);
      const ampm = slot.time.includes('AM') ? 'AM' : 'PM';
      return ampm === 'AM' && hour >= 8 && hour <= 11;
    });
    
    console.log(`\n=== FINAL RESULT ===`);
    if (morningSlots.length > 0) {
      console.log(`🎉 SUCCESS! Found ${morningSlots.length} morning slots available:`);
      morningSlots.forEach((slot, i) => {
        console.log(`  ${i + 1}. ${slot.day} ${slot.time}`);
      });
      console.log('\n✅ Morning appointments are now bookable by customers!');
    } else {
      console.log('❌ Still no morning slots found - may need further investigation');
    }
    
  } catch (error) {
    console.error('❌ Error fixing calendar timezone storage:', error.message);
    console.error(error.stack);
  } finally {
    await pool.end();
  }
}

fixCalendarTimezoneStorage();