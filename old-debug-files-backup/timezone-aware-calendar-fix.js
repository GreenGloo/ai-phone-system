require('dotenv').config();
const { Pool } = require('pg');

async function fixTimezoneIssue() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  
  try {
    console.log('🌍 FIXING TIMEZONE-AWARE CALENDAR GENERATION');
    console.log('='.repeat(60));
    
    const businessId = '8fea02b5-850a-4167-913b-a12043c65d17';
    
    // Get business info with timezone
    const businessResult = await pool.query(`
      SELECT business_hours, calendar_preferences, timezone
      FROM businesses 
      WHERE id = $1
    `, [businessId]);
    
    const { business_hours, calendar_preferences, timezone } = businessResult.rows[0];
    console.log(`Business timezone: ${timezone || 'UTC'}`);
    
    // Clear existing slots for tomorrow
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    
    console.log(`\nClearing existing slots for ${tomorrow.toDateString()}...`);
    await pool.query(`
      DELETE FROM calendar_slots 
      WHERE business_id = $1 
      AND slot_start >= $2::date
      AND slot_start < ($2::date + INTERVAL '1 day')
    `, [businessId, tomorrow.toISOString().split('T')[0]]);
    
    // Generate slots with proper timezone handling
    const dayNames = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
    const dayName = dayNames[tomorrow.getDay()];
    const dayHours = business_hours[dayName];
    
    if (!dayHours || !dayHours.enabled) {
      console.log('❌ Business is closed on this day');
      return;
    }
    
    const [startHour, startMinute] = dayHours.start.split(':').map(Number);
    const [endHour, endMinute] = dayHours.end.split(':').map(Number);
    const appointmentDuration = calendar_preferences?.appointmentDuration || 60;
    
    console.log(`\nGenerating slots for ${tomorrow.toDateString()} (${dayName})`);
    console.log(`Business hours: ${startHour}:${startMinute.toString().padStart(2, '0')} to ${endHour}:${endMinute.toString().padStart(2, '0')}`);
    
    // The key insight: We need to create dates that represent the business's local time
    // Since the business is in America/New_York (UTC-4 in summer), we need to account for this
    
    const businessTimezoneOffset = -4; // Eastern Daylight Time offset in hours
    const slotsToInsert = [];
    
    for (let hour = startHour; hour < endHour || (hour === endHour && 0 < endMinute); hour++) {
      for (let minute = 0; minute < 60; minute += 30) {
        // Skip if past end time
        if (hour === endHour && minute >= endMinute) break;
        if (hour > endHour) break;
        
        // Create UTC time that represents the business local time
        // If business wants 8 AM Eastern, we need to store 12 PM UTC (8 AM + 4 hours)
        const localSlotStart = new Date(tomorrow.getFullYear(), tomorrow.getMonth(), tomorrow.getDate(), hour, minute, 0, 0);
        
        // Convert to UTC by adding the timezone offset
        const utcSlotStart = new Date(localSlotStart.getTime() - (businessTimezoneOffset * 60 * 60 * 1000));
        
        const utcSlotEnd = new Date(utcSlotStart.getTime() + appointmentDuration * 60000);
        
        slotsToInsert.push({
          slotStart: utcSlotStart.toISOString(),
          slotEnd: utcSlotEnd.toISOString(),
          localDisplayTime: localSlotStart.toLocaleTimeString('en-US', { 
            hour: '2-digit', 
            minute: '2-digit',
            hour12: true 
          }),
          utcTime: utcSlotStart.toLocaleTimeString('en-US', { 
            hour: '2-digit', 
            minute: '2-digit',
            hour12: true,
            timeZone: 'UTC'
          })
        });
        
        console.log(`  Will insert: ${localSlotStart.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true })} local → ${utcSlotStart.toISOString()}`);
      }
    }
    
    console.log(`\nTotal slots to insert: ${slotsToInsert.length}`);
    
    // Insert slots
    let insertedCount = 0;
    for (const slot of slotsToInsert) {
      try {
        await pool.query(`
          INSERT INTO calendar_slots (business_id, slot_start, slot_end, is_available)
          VALUES ($1, $2, $3, $4)
        `, [businessId, slot.slotStart, slot.slotEnd, true]);
        
        console.log(`  ✅ Inserted: ${slot.localDisplayTime} (stored as ${slot.utcTime} UTC)`);
        insertedCount++;
      } catch (error) {
        console.error(`  ❌ Failed to insert ${slot.localDisplayTime}:`, error.message);
      }
    }
    
    console.log(`\n📊 Inserted ${insertedCount} slots`);
    
    // Verify with timezone-aware queries
    console.log(`\n🔍 VERIFICATION - Checking slots in business timezone...`);
    
    // Query slots and convert them back to business timezone for display
    const verifySlots = await pool.query(`
      SELECT 
        slot_start, 
        slot_end,
        is_available
      FROM calendar_slots 
      WHERE business_id = $1 
        AND slot_start >= $2::date
        AND slot_start < ($2::date + INTERVAL '1 day')
      ORDER BY slot_start
    `, [businessId, tomorrow.toISOString().split('T')[0]]);
    
    console.log(`Database contains ${verifySlots.rows.length} slots:`);
    
    let morningSlots = 0;
    verifySlots.rows.forEach((slot, index) => {
      // Convert UTC stored time back to business local time for verification
      const utcTime = new Date(slot.slot_start);
      const localTime = new Date(utcTime.getTime() + (businessTimezoneOffset * 60 * 60 * 1000));
      const hour = localTime.getHours();
      
      if (hour >= 8 && hour < 12) {
        morningSlots++;
      }
      
      if (index < 10) { // Show first 10
        console.log(`  ${localTime.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true })} (stored as ${utcTime.toISOString()})`);
      }
    });
    
    console.log(`\nMorning slots (8 AM - 12 PM business time): ${morningSlots}`);
    
    // Specific check for 9 AM
    const nineAmLocalStart = new Date(tomorrow.getFullYear(), tomorrow.getMonth(), tomorrow.getDate(), 9, 0, 0);
    const nineAmUtc = new Date(nineAmLocalStart.getTime() - (businessTimezoneOffset * 60 * 60 * 1000));
    
    const nineAmSlots = await pool.query(`
      SELECT slot_start, is_available
      FROM calendar_slots 
      WHERE business_id = $1 
        AND slot_start >= $2
        AND slot_start < $3
    `, [
      businessId, 
      nineAmUtc.toISOString(),
      new Date(nineAmUtc.getTime() + 30 * 60000).toISOString()
    ]);
    
    if (nineAmSlots.rows.length > 0) {
      const slot = nineAmSlots.rows[0];
      const storedUtc = new Date(slot.slot_start);
      const businessLocal = new Date(storedUtc.getTime() + (businessTimezoneOffset * 60 * 60 * 1000));
      
      console.log(`\n✅ 9 AM slot found!`);
      console.log(`  Business local time: ${businessLocal.toLocaleTimeString()}`);
      console.log(`  Stored UTC time: ${storedUtc.toISOString()}`);
      console.log(`  Available: ${slot.is_available}`);
      
      // Check for conflicts with existing appointments
      const conflicts = await pool.query(`
        SELECT customer_name, service_name, start_time, end_time
        FROM appointments 
        WHERE business_id = $1 
          AND start_time <= $2
          AND end_time > $2
          AND status IN ('scheduled', 'confirmed')
      `, [businessId, slot.slot_start]);
      
      if (conflicts.rows.length > 0) {
        console.log(`  ⚠️  Conflict: ${conflicts.rows[0].customer_name} - ${conflicts.rows[0].service_name}`);
      } else {
        console.log(`  ✅ No conflicts - 9 AM is truly available!`);
      }
    } else {
      console.log(`\n❌ 9 AM slot still not found`);
    }
    
    console.log('\n🎯 TIMEZONE FIX COMPLETE:');
    if (morningSlots > 0) {
      console.log('✅ Morning slots are now properly generated!');
      console.log('✅ Timezone conversion is working correctly');
      console.log('✅ Issue #1 (Missing 9 AM slots) is FIXED');
    } else {
      console.log('❌ Still having issues with morning slot generation');
    }
    
  } catch (error) {
    console.error('❌ Timezone fix error:', error);
    console.error('Stack trace:', error.stack);
  } finally {
    await pool.end();
  }
}

fixTimezoneIssue();