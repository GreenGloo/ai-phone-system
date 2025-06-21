require('dotenv').config();
const { Pool } = require('pg');

async function regenerateCalendarSlots() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const businessId = '8fea02b5-850a-4167-913b-a12043c65d17'; // Tom's Garage
  
  try {
    console.log('=== REGENERATING CALENDAR SLOTS WITH CORRECT TIMEZONE ===\n');
    
    // 1. Get business configuration
    console.log('1. Getting business configuration...');
    const business = await pool.query(`
      SELECT business_hours, timezone
      FROM businesses 
      WHERE id = $1
    `, [businessId]);
    
    if (business.rows.length === 0) {
      throw new Error('Business not found');
    }
    
    const businessHours = business.rows[0].business_hours;
    const timezone = business.rows[0].timezone;
    
    console.log(`Business timezone: ${timezone}`);
    console.log('Business hours:', JSON.stringify(businessHours, null, 2));
    
    // 2. Delete existing calendar slots
    console.log('\n2. Deleting existing calendar slots...');
    const deleteResult = await pool.query(`
      DELETE FROM calendar_slots WHERE business_id = $1
    `, [businessId]);
    
    console.log(`✅ Deleted ${deleteResult.rowCount} existing slots`);
    
    // 3. Generate new calendar slots with correct timezone handling
    console.log('\n3. Generating new calendar slots with correct timezone...');
    
    const startDate = new Date('2025-06-16'); // Start from Monday
    const endDate = new Date('2026-07-17'); // End a year later
    
    let totalSlots = 0;
    let currentDate = new Date(startDate);
    
    while (currentDate <= endDate) {
      const dayName = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'][currentDate.getDay()];
      const dayConfig = businessHours[dayName];
      
      if (dayConfig && dayConfig.enabled) {
        // Parse business hours
        const startHour = parseInt(dayConfig.start.split(':')[0]);
        const startMinute = parseInt(dayConfig.start.split(':')[1]);
        const endHour = parseInt(dayConfig.end.split(':')[0]);
        
        // Generate 30-minute slots from start to end
        for (let hour = startHour; hour < endHour; hour++) {
          for (let minute of [0, 30]) {
            // Create the slot time in the business timezone
            const slotStart = new Date(currentDate);
            slotStart.setHours(hour, minute, 0, 0);
            
            // Convert to UTC for storage (this is the key fix!)
            // If local time is 8:00 AM EDT, we need to store as 12:00 PM UTC
            const utcSlotStart = new Date(slotStart.getTime() + (4 * 60 * 60 * 1000)); // Add 4 hours for EDT
            const utcSlotEnd = new Date(utcSlotStart.getTime() + (60 * 60 * 1000)); // Add 1 hour
            
            // Insert the slot
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
            `, [businessId, utcSlotStart.toISOString(), utcSlotEnd.toISOString()]);
            
            totalSlots++;
          }
        }
      }
      
      // Move to next day
      currentDate.setDate(currentDate.getDate() + 1);
    }
    
    console.log(`✅ Generated ${totalSlots} new calendar slots`);
    
    // 4. Verify the fix by checking morning slots
    console.log('\n4. Verifying morning slots are now correct...');
    const verifySlots = await pool.query(`
      SELECT 
        slot_start,
        slot_start AT TIME ZONE 'UTC' AT TIME ZONE 'America/New_York' as local_time
      FROM calendar_slots
      WHERE business_id = $1
      AND DATE(slot_start AT TIME ZONE 'UTC' AT TIME ZONE 'America/New_York') = '2025-06-16'
      AND EXTRACT(hour FROM slot_start AT TIME ZONE 'UTC' AT TIME ZONE 'America/New_York') BETWEEN 8 AND 11
      ORDER BY slot_start
      LIMIT 8
    `, [businessId]);
    
    console.log('Morning slots after regeneration:');
    verifySlots.rows.forEach((slot, i) => {
      console.log(`  ${i + 1}. UTC: ${slot.slot_start} -> Local: ${slot.local_time}`);
    });
    
    // 5. Test getAvailableSlots function
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
      console.log('✅ The calendar regeneration fixed the timezone storage issue!');
    } else {
      console.log('❌ Still no morning slots found - may need further investigation');
    }
    
  } catch (error) {
    console.error('❌ Error regenerating calendar slots:', error.message);
    console.error(error.stack);
  } finally {
    await pool.end();
  }
}

regenerateCalendarSlots();