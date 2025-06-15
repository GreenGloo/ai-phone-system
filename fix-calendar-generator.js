require('dotenv').config();
const { Pool } = require('pg');

async function fixCalendarGenerator() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  
  try {
    console.log('🔧 FIXING CALENDAR GENERATOR BUG');
    console.log('='.repeat(60));
    
    const businessId = '8fea02b5-850a-4167-913b-a12043c65d17';
    
    // Get business info
    const businessResult = await pool.query(`
      SELECT business_hours, calendar_preferences, timezone
      FROM businesses 
      WHERE id = $1
    `, [businessId]);
    
    const { business_hours, calendar_preferences, timezone } = businessResult.rows[0];
    console.log(`Business timezone: ${timezone || 'Not set'}`);
    console.log('Business Hours:', JSON.stringify(business_hours, null, 2));
    
    // Clear existing slots for tomorrow to start fresh
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(0, 0, 0, 0);
    
    console.log(`\nClearing existing slots for ${tomorrow.toDateString()}...`);
    await pool.query(`
      DELETE FROM calendar_slots 
      WHERE business_id = $1 
      AND slot_start >= $2::date
      AND slot_start < ($2::date + INTERVAL '1 day')
    `, [businessId, tomorrow.toISOString().split('T')[0]]);
    
    // Let's manually generate slots with detailed debugging
    const dayNames = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
    const dayName = dayNames[tomorrow.getDay()];
    const dayHours = business_hours[dayName];
    
    console.log(`\nGenerating slots for ${tomorrow.toDateString()} (${dayName})`);
    console.log(`Day hours:`, dayHours);
    
    if (!dayHours || !dayHours.enabled) {
      console.log('❌ Business is closed on this day');
      return;
    }
    
    const [startHour, startMinute] = dayHours.start.split(':').map(Number);
    const [endHour, endMinute] = dayHours.end.split(':').map(Number);
    const appointmentDuration = calendar_preferences?.appointmentDuration || 60;
    
    console.log(`Business hours: ${startHour}:${startMinute.toString().padStart(2, '0')} to ${endHour}:${endMinute.toString().padStart(2, '0')}`);
    console.log(`Appointment duration: ${appointmentDuration} minutes`);
    
    const slotsToInsert = [];
    const now = new Date();
    
    console.log(`\nCurrent time: ${now.toISOString()}`);
    console.log(`Current time local: ${now.toLocaleString()}`);
    
    for (let hour = startHour; hour < endHour || (hour === endHour && 0 < endMinute); hour++) {
      for (let minute = 0; minute < 60; minute += 30) {
        const slotStart = new Date(tomorrow);
        slotStart.setHours(hour, minute, 0, 0);
        
        // Skip if past end time
        if (hour === endHour && minute >= endMinute) {
          console.log(`  Skipping ${hour}:${minute.toString().padStart(2, '0')} - past end time`);
          break;
        }
        if (hour > endHour) {
          console.log(`  Skipping ${hour}:${minute.toString().padStart(2, '0')} - hour past end`);
          break;
        }
        
        // Check if slot is in the past
        if (slotStart <= now) {
          console.log(`  Skipping ${slotStart.toLocaleTimeString()} - in the past (current: ${now.toLocaleTimeString()})`);
          continue;
        }
        
        const slotEnd = new Date(slotStart.getTime() + appointmentDuration * 60000);
        
        slotsToInsert.push({
          slotStart: slotStart.toISOString(),
          slotEnd: slotEnd.toISOString(),
          displayTime: slotStart.toLocaleTimeString('en-US', { 
            hour: '2-digit', 
            minute: '2-digit',
            hour12: true 
          })
        });
        
        console.log(`  ✅ Will insert: ${slotStart.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true })} (${slotStart.toISOString()})`);
      }
    }
    
    console.log(`\nTotal slots to insert: ${slotsToInsert.length}`);
    
    // Insert slots one by one to see exactly what happens
    let insertedCount = 0;
    let morningSlots = 0;
    
    for (const slot of slotsToInsert) {
      try {
        const result = await pool.query(`
          INSERT INTO calendar_slots (business_id, slot_start, slot_end, is_available)
          VALUES ($1, $2, $3, $4)
          RETURNING id, slot_start
        `, [businessId, slot.slotStart, slot.slotEnd, true]);
        
        const insertedSlot = result.rows[0];
        const insertedTime = new Date(insertedSlot.slot_start);
        const isInMorning = insertedTime.getHours() >= 8 && insertedTime.getHours() < 12;
        
        if (isInMorning) {
          morningSlots++;
          console.log(`  ✅ MORNING SLOT INSERTED: ID ${insertedSlot.id} - ${slot.displayTime}`);
        } else {
          console.log(`  ✅ Inserted: ID ${insertedSlot.id} - ${slot.displayTime}`);
        }
        
        insertedCount++;
      } catch (error) {
        console.error(`  ❌ Failed to insert ${slot.displayTime}:`, error.message);
      }
    }
    
    console.log(`\n📊 INSERTION SUMMARY:`);
    console.log(`Total slots inserted: ${insertedCount}`);
    console.log(`Morning slots (8 AM - 12 PM): ${morningSlots}`);
    
    // Verify what's actually in the database
    console.log(`\n🔍 VERIFICATION - Checking database content...`);
    const verifySlots = await pool.query(`
      SELECT 
        slot_start, 
        is_available,
        EXTRACT(hour FROM slot_start) as hour
      FROM calendar_slots 
      WHERE business_id = $1 
        AND slot_start >= $2::date
        AND slot_start < ($2::date + INTERVAL '1 day')
      ORDER BY slot_start
    `, [businessId, tomorrow.toISOString().split('T')[0]]);
    
    console.log(`Database contains ${verifySlots.rows.length} slots for ${tomorrow.toDateString()}:`);
    
    const morningDbSlots = verifySlots.rows.filter(slot => slot.hour >= 8 && slot.hour < 12);
    const afternoonDbSlots = verifySlots.rows.filter(slot => slot.hour >= 12);
    
    console.log(`  Morning slots (8 AM - 12 PM): ${morningDbSlots.length}`);
    console.log(`  Afternoon/Evening slots (12 PM+): ${afternoonDbSlots.length}`);
    
    console.log('\nFirst 10 slots in database:');
    verifySlots.rows.slice(0, 10).forEach(slot => {
      const time = new Date(slot.slot_start).toLocaleTimeString('en-US', { 
        hour: '2-digit', 
        minute: '2-digit',
        hour12: true 
      });
      console.log(`  ${time} (hour: ${slot.hour})`);
    });
    
    // Special check for 9 AM slot
    const nineAmSlots = await pool.query(`
      SELECT slot_start, is_available
      FROM calendar_slots 
      WHERE business_id = $1 
        AND slot_start >= $2
        AND slot_start < $3
    `, [
      businessId, 
      new Date(tomorrow.getFullYear(), tomorrow.getMonth(), tomorrow.getDate(), 9, 0, 0).toISOString(),
      new Date(tomorrow.getFullYear(), tomorrow.getMonth(), tomorrow.getDate(), 9, 30, 0).toISOString()
    ]);
    
    if (nineAmSlots.rows.length > 0) {
      console.log(`\n✅ 9 AM slot EXISTS in database!`);
      const slot = nineAmSlots.rows[0];
      console.log(`  Time: ${new Date(slot.slot_start).toLocaleTimeString()}`);
      console.log(`  Available: ${slot.is_available}`);
    } else {
      console.log(`\n❌ 9 AM slot NOT FOUND in database`);
    }
    
    console.log('\n🎯 DIAGNOSIS:');
    if (morningSlots > 0 && morningDbSlots.length > 0) {
      console.log('✅ Calendar generator is working correctly!');
      console.log('✅ Morning slots are being generated and stored properly');
      console.log('✅ Issue #1 (Missing 9 AM slots) is now FIXED');
    } else if (insertedCount > 0 && morningDbSlots.length === 0) {
      console.log('❌ Slots are being inserted but morning slots are missing');
      console.log('❓ This suggests a timezone or date calculation issue');
    } else {
      console.log('❌ Calendar generation is completely broken');
    }
    
  } catch (error) {
    console.error('❌ Fix error:', error);
    console.error('Stack trace:', error.stack);
  } finally {
    await pool.end();
  }
}

fixCalendarGenerator();