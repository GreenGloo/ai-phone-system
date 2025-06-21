require('dotenv').config();
const { Pool } = require('pg');

async function debugCalendarGeneration() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  
  try {
    console.log('🔍 DEBUGGING CALENDAR GENERATION');
    console.log('='.repeat(60));
    
    const businessId = '8fea02b5-850a-4167-913b-a12043c65d17';
    
    // Get business hours and preferences
    const businessResult = await pool.query(`
      SELECT business_hours, calendar_preferences 
      FROM businesses 
      WHERE id = $1
    `, [businessId]);
    
    const { business_hours, calendar_preferences } = businessResult.rows[0];
    console.log('Business Hours:', JSON.stringify(business_hours, null, 2));
    console.log('Calendar Preferences:', JSON.stringify(calendar_preferences, null, 2));
    
    // Let's manually simulate the calendar generation for June 16, 2025 (Monday)
    const targetDate = new Date('2025-06-16T00:00:00');
    console.log(`\nTarget Date: ${targetDate.toDateString()} (${targetDate.toLocaleDateString('en-US', { weekday: 'long' })})`);
    
    const dayNames = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
    const dayName = dayNames[targetDate.getDay()];
    console.log(`Day name: ${dayName}`);
    
    const dayHours = business_hours[dayName];
    console.log(`Day hours for ${dayName}:`, dayHours);
    
    if (!dayHours || !dayHours.enabled) {
      console.log('❌ Day is not enabled for business!');
      return;
    }
    
    const [startHour, startMinute] = dayHours.start.split(':').map(Number);
    const [endHour, endMinute] = dayHours.end.split(':').map(Number);
    
    console.log(`Business hours: ${startHour}:${startMinute} to ${endHour}:${endMinute}`);
    console.log(`That's ${startHour}:${startMinute.toString().padStart(2, '0')} ${startHour >= 12 ? 'PM' : 'AM'} to ${endHour}:${endMinute.toString().padStart(2, '0')} ${endHour >= 12 ? 'PM' : 'AM'}`);
    
    // Simulate slot generation
    console.log('\n🕐 Simulating slot generation:');
    const slots = [];
    const appointmentDuration = calendar_preferences?.appointmentDuration || 60;
    
    for (let hour = startHour; hour < endHour || (hour === endHour && 0 < endMinute); hour++) {
      for (let minute = 0; minute < 60; minute += 30) {
        const slotStart = new Date(targetDate);
        slotStart.setHours(hour, minute, 0, 0);
        
        // Skip if past end time
        if (hour === endHour && minute >= endMinute) break;
        if (hour > endHour) break;
        
        const slotEnd = new Date(slotStart.getTime() + appointmentDuration * 60000);
        
        slots.push({
          start: slotStart,
          end: slotEnd,
          startTime: slotStart.toLocaleTimeString('en-US', { 
            hour: '2-digit', 
            minute: '2-digit',
            hour12: true 
          })
        });
        
        console.log(`  Generated: ${slotStart.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true })}`);
      }
    }
    
    console.log(`\nTotal slots that should be generated: ${slots.length}`);
    
    // Check what's actually in the database for this date
    console.log('\n📊 Checking actual database slots:');
    const dbSlots = await pool.query(`
      SELECT 
        slot_start, 
        slot_end, 
        is_available
      FROM calendar_slots 
      WHERE business_id = $1 
        AND slot_start >= $2::date
        AND slot_start < ($2::date + INTERVAL '1 day')
      ORDER BY slot_start
    `, [businessId, '2025-06-16']);
    
    console.log(`Database has ${dbSlots.rows.length} slots for June 16, 2025:`);
    dbSlots.rows.forEach(slot => {
      const time = new Date(slot.slot_start).toLocaleTimeString('en-US', { 
        hour: '2-digit', 
        minute: '2-digit',
        hour12: true 
      });
      console.log(`  ${time} | Available: ${slot.is_available}`);
    });
    
    // Check if the problem is in the calendar generator logic
    console.log('\n🔍 Checking calendar generator logic issue...');
    
    // Let's manually run a simplified version of the generator for debugging
    const now = new Date();
    const testDate = new Date('2025-06-16');
    const daysSinceNow = Math.floor((testDate - now) / (1000 * 60 * 60 * 24));
    
    console.log(`Current date: ${now.toISOString()}`);
    console.log(`Test date: ${testDate.toISOString()}`);
    console.log(`Days difference: ${daysSinceNow}`);
    
    // The issue might be that June 16, 2025 is in the past relative to when the generator runs
    // Or there might be a timezone issue
    
    // Let's check a more recent date
    const futureDate = new Date();
    futureDate.setDate(futureDate.getDate() + 1); // Tomorrow
    
    console.log(`\n🔍 Checking tomorrow's slots: ${futureDate.toDateString()}`);
    const tomorrowSlots = await pool.query(`
      SELECT 
        slot_start, 
        slot_end, 
        is_available
      FROM calendar_slots 
      WHERE business_id = $1 
        AND slot_start >= $2::date
        AND slot_start < ($2::date + INTERVAL '1 day')
      ORDER BY slot_start
    `, [businessId, futureDate.toISOString().split('T')[0]]);
    
    console.log(`Tomorrow has ${tomorrowSlots.rows.length} slots:`);
    tomorrowSlots.rows.slice(0, 10).forEach(slot => {
      const time = new Date(slot.slot_start).toLocaleTimeString('en-US', { 
        hour: '2-digit', 
        minute: '2-digit',
        hour12: true 
      });
      console.log(`  ${time} | Available: ${slot.is_available}`);
    });
    
    // Check for morning slots specifically
    const morningSlots = tomorrowSlots.rows.filter(slot => {
      const hour = new Date(slot.slot_start).getHours();
      return hour >= 8 && hour < 12;
    });
    
    console.log(`\nMorning slots (8 AM - 12 PM): ${morningSlots.length}`);
    morningSlots.forEach(slot => {
      const time = new Date(slot.slot_start).toLocaleTimeString('en-US', { 
        hour: '2-digit', 
        minute: '2-digit',
        hour12: true 
      });
      console.log(`  ${time} | Available: ${slot.is_available}`);
    });
    
    if (morningSlots.length === 0) {
      console.log('\n❌ ISSUE CONFIRMED: No morning slots are being generated');
      console.log('This suggests a bug in the calendar generator logic');
      
      // Let's check the exact calendar generator code execution
      console.log('\n🔧 Running calendar generator with debug logging...');
      
      // Clear existing slots for tomorrow to test regeneration
      await pool.query(`
        DELETE FROM calendar_slots 
        WHERE business_id = $1 
        AND slot_start >= $2::date
        AND slot_start < ($2::date + INTERVAL '1 day')
      `, [businessId, futureDate.toISOString().split('T')[0]]);
      
      // Now manually generate slots with debug output
      const debugSlots = [];
      const tomorrowDayName = dayNames[futureDate.getDay()];
      const tomorrowDayHours = business_hours[tomorrowDayName];
      
      console.log(`Tomorrow is ${tomorrowDayName}, hours:`, tomorrowDayHours);
      
      if (tomorrowDayHours && tomorrowDayHours.enabled) {
        const [startH, startM] = tomorrowDayHours.start.split(':').map(Number);
        const [endH, endM] = tomorrowDayHours.end.split(':').map(Number);
        
        console.log(`Generating slots from ${startH}:${startM} to ${endH}:${endM}`);
        
        for (let hour = startH; hour < endH || (hour === endH && 0 < endM); hour++) {
          for (let minute = 0; minute < 60; minute += 30) {
            const slotStart = new Date(futureDate);
            slotStart.setHours(hour, minute, 0, 0);
            
            // Skip if past end time
            if (hour === endH && minute >= endM) break;
            if (hour > endH) break;
            
            // Skip past times
            if (slotStart <= now) {
              console.log(`  Skipping past time: ${slotStart.toLocaleTimeString()}`);
              continue;
            }
            
            const slotEnd = new Date(slotStart.getTime() + appointmentDuration * 60000);
            
            debugSlots.push({
              businessId,
              slotStart: slotStart.toISOString(),
              slotEnd: slotEnd.toISOString(),
              isAvailable: true
            });
            
            console.log(`  Generated: ${slotStart.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true })}`);
          }
        }
        
        // Insert the debug slots
        if (debugSlots.length > 0) {
          for (const slot of debugSlots) {
            await pool.query(`
              INSERT INTO calendar_slots (business_id, slot_start, slot_end, is_available)
              VALUES ($1, $2, $3, $4)
            `, [slot.businessId, slot.slotStart, slot.slotEnd, slot.isAvailable]);
          }
          
          console.log(`\n✅ Manually inserted ${debugSlots.length} debug slots`);
          
          // Check if morning slots now exist
          const newMorningSlots = await pool.query(`
            SELECT slot_start
            FROM calendar_slots 
            WHERE business_id = $1 
              AND slot_start >= $2::date
              AND slot_start < ($2::date + INTERVAL '1 day')
              AND EXTRACT(hour FROM slot_start) >= 8
              AND EXTRACT(hour FROM slot_start) < 12
            ORDER BY slot_start
          `, [businessId, futureDate.toISOString().split('T')[0]]);
          
          console.log(`\n✅ Morning slots after manual generation: ${newMorningSlots.rows.length}`);
          newMorningSlots.rows.forEach(slot => {
            const time = new Date(slot.slot_start).toLocaleTimeString('en-US', { 
              hour: '2-digit', 
              minute: '2-digit',
              hour12: true 
            });
            console.log(`  ${time}`);
          });
        }
      }
    } else {
      console.log('✅ Morning slots ARE being generated correctly');
    }
    
  } catch (error) {
    console.error('❌ Debug error:', error);
    console.error('Stack trace:', error.stack);
  } finally {
    await pool.end();
  }
}

debugCalendarGeneration();