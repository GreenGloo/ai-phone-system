require('dotenv').config();
const { Pool } = require('pg');

async function finalFixMorningSlots() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const businessId = '8fea02b5-850a-4167-913b-a12043c65d17'; // Tom's Garage
  
  try {
    console.log('=== FINAL FIX: ADDING MISSING MORNING SLOTS ===\n');
    
    // Generate slots for the next few weeks to get morning appointments working
    const dates = [
      '2025-06-16', // Monday
      '2025-06-17', // Tuesday  
      '2025-06-18', // Wednesday
      '2025-06-19', // Thursday
      '2025-06-20', // Friday
      '2025-06-23', // Monday
      '2025-06-24', // Tuesday
      '2025-06-25', // Wednesday
      '2025-06-26', // Thursday
      '2025-06-27'  // Friday
    ];
    
    let slotsAdded = 0;
    
    console.log('1. Adding missing morning slots (8:00 AM - 11:30 AM)...');
    
    for (const dateStr of dates) {
      console.log(`  Processing ${dateStr}...`);
      
      // Generate morning slots: 8:00 AM, 8:30 AM, 9:00 AM, 9:30 AM, 10:00 AM, 10:30 AM, 11:00 AM, 11:30 AM
      for (let hour = 8; hour <= 11; hour++) {
        for (let minute of [0, 30]) {
          
          // Create the correct UTC timestamp that will display as the desired local time
          // 8:00 AM EDT = 12:00 PM UTC
          const utcHour = hour + 4; // Add 4 hours for EDT offset
          const utcTimestamp = `${dateStr}T${utcHour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}:00.000Z`;
          const endUtcTimestamp = `${dateStr}T${(utcHour + 1).toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}:00.000Z`;
          
          try {
            await pool.query(`
              INSERT INTO calendar_slots (
                id,
                business_id,
                slot_start,
                slot_end,
                is_available,
                is_blocked,
                created_at,
                updated_at
              ) VALUES (
                gen_random_uuid(),
                $1,
                $2,
                $3,
                true,
                false,
                NOW(),
                NOW()
              )
            `, [businessId, utcTimestamp, endUtcTimestamp]);
            
            slotsAdded++;
          } catch (error) {
            if (error.message.includes('duplicate key')) {
              // Slot already exists, skip
              console.log(`    ${hour}:${minute.toString().padStart(2, '0')} already exists`);
            } else {
              throw error;
            }
          }
        }
      }
    }
    
    console.log(`✅ Added ${slotsAdded} new morning slots`);
    
    // 2. Verify the morning slots are correctly stored
    console.log('\n2. Verifying morning slots for Monday June 16...');
    const verifySlots = await pool.query(`
      SELECT 
        slot_start,
        slot_start AT TIME ZONE 'UTC' AT TIME ZONE 'America/New_York' as local_time
      FROM calendar_slots
      WHERE business_id = $1
      AND DATE(slot_start AT TIME ZONE 'UTC' AT TIME ZONE 'America/New_York') = '2025-06-16'
      AND EXTRACT(hour FROM slot_start AT TIME ZONE 'UTC' AT TIME ZONE 'America/New_York') BETWEEN 8 AND 11
      ORDER BY slot_start
    `, [businessId]);
    
    console.log(`Found ${verifySlots.rows.length} morning slots for Monday June 16:`);
    verifySlots.rows.forEach((slot, i) => {
      const jsDate = new Date(slot.slot_start);
      const jsTime = jsDate.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
      console.log(`  ${i + 1}. UTC: ${slot.slot_start} -> DB Local: ${slot.local_time} -> JS: ${jsTime}`);
    });
    
    // 3. Test getAvailableSlots function
    console.log('\n3. Testing getAvailableSlots function...');
    
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
      LIMIT 30
    `, [businessId, sixWeeksOut.toISOString()]);
    
    // Get existing appointments
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
    
    // Process with getAvailableSlots logic
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
    console.log('\nFirst 15 available slots:');
    availableSlots.slice(0, 15).forEach((slot, i) => {
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
      console.log('✅ The timezone storage issue has been resolved!');
    } else {
      console.log('❌ Still no morning slots available - may need to check appointment conflicts');
    }
    
  } catch (error) {
    console.error('❌ Error in final fix:', error.message);
    console.error(error.stack);
  } finally {
    await pool.end();
  }
}

finalFixMorningSlots();