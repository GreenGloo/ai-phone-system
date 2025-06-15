require('dotenv').config();
const { Pool } = require('pg');

async function testGetAvailableSlotsWithMorningFix() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const businessId = '8fea02b5-850a-4167-913b-a12043c65d17'; // Tom's Garage
  
  try {
    console.log('=== TESTING getAvailableSlots WITH MORNING SLOT FOCUS ===\n');
    
    // Run the EXACT same query as in getAvailableSlots but with detailed logging
    const sixWeeksOut = new Date();
    sixWeeksOut.setDate(sixWeeksOut.getDate() + 42);
    
    console.log('1. Running the exact getAvailableSlots query...');
    console.log(`Date range: NOW() to ${sixWeeksOut.toISOString()}`);
    
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
    
    console.log(`Query returned ${slotsResult.rows.length} slots`);
    
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
    
    console.log(`Found ${bookedTimes.length} booked appointments to filter out`);
    
    // Now process with the EXACT same logic as getAvailableSlots
    const availableSlots = slotsResult.rows
      .filter(slot => {
        const slotStart = new Date(slot.slot_start);
        const slotEnd = new Date(slot.slot_end);
        
        const hasConflict = bookedTimes.some(booked => 
          (slotStart < booked.end && slotEnd > booked.start)
        );
        
        if (hasConflict) {
          const localTime = slotStart.toLocaleString('en-US', {
            timeZone: 'America/New_York',
            hour: 'numeric',
            minute: '2-digit',
            hour12: true
          });
          console.log(`    Filtering out: ${localTime} (conflict)`);
        }
        
        return !hasConflict;
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
          datetime: slotStart.toISOString(),
          localTime: slotStart.toLocaleString('en-US', {
            timeZone: 'America/New_York',
            hour: 'numeric',
            minute: '2-digit',
            hour12: true
          })
        };
      });
    
    console.log(`\n2. After filtering: ${availableSlots.length} available slots`);
    
    // Show first 15 slots with explicit times
    console.log('\nFirst 15 available slots:');
    availableSlots.slice(0, 15).forEach((slot, i) => {
      console.log(`  ${i + 1}. ${slot.day} ${slot.time} (Local: ${slot.localTime})`);
    });
    
    // Check if morning slots are included
    const morningSlots = availableSlots.filter(slot => {
      const hour = parseInt(slot.time.split(':')[0]);
      const ampm = slot.time.includes('AM') ? 'AM' : 'PM';
      return ampm === 'AM' && hour >= 8 && hour <= 11;
    });
    
    console.log(`\n3. Morning slots (8-11 AM) found: ${morningSlots.length}`);
    morningSlots.forEach((slot, i) => {
      console.log(`  ${i + 1}. ${slot.day} ${slot.time}`);
    });
    
    if (morningSlots.length === 0) {
      console.log('\n❌ STILL NO MORNING SLOTS - Let me check the timezone conversion issue...');
      
      // Check timezone conversion in the mapping
      console.log('\nChecking timezone conversion in mapping:');
      slotsResult.rows.slice(0, 10).forEach((slot, i) => {
        const slotStart = new Date(slot.slot_start);
        
        // Test different timezone approaches
        const jsLocal = slotStart.toLocaleTimeString('en-US', { 
          hour: 'numeric', 
          minute: '2-digit',
          hour12: true 
        });
        
        const jsLocalWithTZ = slotStart.toLocaleTimeString('en-US', { 
          timeZone: 'America/New_York',
          hour: 'numeric', 
          minute: '2-digit',
          hour12: true 
        });
        
        console.log(`  ${i + 1}. UTC: ${slot.slot_start}`);
        console.log(`      JS local: ${jsLocal}`);
        console.log(`      JS local with TZ: ${jsLocalWithTZ}`);
      });
    } else {
      console.log('\n✅ SUCCESS: Morning slots are now available!');
    }
    
  } catch (error) {
    console.error('❌ Error testing getAvailableSlots:', error.message);
    console.error(error.stack);
  } finally {
    await pool.end();
  }
}

testGetAvailableSlotsWithMorningFix();