require('dotenv').config();
const { Pool } = require('pg');

async function quickFixMorningSlots() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const businessId = '8fea02b5-850a-4167-913b-a12043c65d17'; // Tom's Garage
  
  try {
    console.log('=== QUICK FIX: GENERATING MORNING SLOTS FOR NEXT 2 WEEKS ===\n');
    
    // Generate slots for just the next 2 weeks to test the fix
    const startDate = new Date('2025-06-16'); // Start from Monday
    const endDate = new Date('2025-06-30'); // End in 2 weeks
    
    let totalSlots = 0;
    let currentDate = new Date(startDate);
    
    console.log('1. Generating morning slots (8-12 PM) for next 2 weeks...');
    
    while (currentDate <= endDate) {
      const dayName = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'][currentDate.getDay()];
      
      // Only generate for Monday-Friday (Tom's Garage business days)
      if (['monday', 'tuesday', 'wednesday', 'thursday', 'friday'].includes(dayName)) {
        
        // Generate morning slots: 8:00 AM - 12:00 PM
        for (let hour = 8; hour < 12; hour++) {
          for (let minute of [0, 30]) {
            
            // Create the slot time as UTC directly (this is the key fix!)
            // 8:00 AM EDT = 12:00 PM UTC
            // 9:00 AM EDT = 1:00 PM UTC, etc.
            const localHour = hour + 4; // Convert EDT to UTC by adding 4 hours
            
            const utcSlotStart = new Date(currentDate);
            utcSlotStart.setUTCHours(localHour, minute, 0, 0);
            const utcSlotEnd = new Date(utcSlotStart.getTime() + (60 * 60 * 1000)); // Add 1 hour
            
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
              `, [businessId, utcSlotStart.toISOString(), utcSlotEnd.toISOString()]);
              
              totalSlots++;
            } catch (error) {
              if (!error.message.includes('duplicate key')) {
                throw error;
              }
              // Skip duplicates silently
            }
          }
        }
      }
      
      // Move to next day
      currentDate.setDate(currentDate.getDate() + 1);
    }
    
    console.log(`✅ Generated ${totalSlots} new morning slots`);
    
    // 2. Verify the morning slots are correctly stored
    console.log('\n2. Verifying morning slots are correctly stored...');
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
      console.log(`  ${i + 1}. UTC: ${slot.slot_start} -> Local: ${slot.local_time}`);
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
      LIMIT 20
    `, [businessId, sixWeeksOut.toISOString()]);
    
    console.log(`Raw query returned ${slotsResult.rows.length} slots`);
    
    // Show first 10 with timezone conversion
    console.log('First 10 raw slots with JavaScript conversion:');
    slotsResult.rows.slice(0, 10).forEach((slot, i) => {
      const slotStart = new Date(slot.slot_start);
      const timeStr = slotStart.toLocaleTimeString('en-US', { 
        hour: 'numeric', 
        minute: '2-digit',
        hour12: true 
      });
      console.log(`  ${i + 1}. UTC: ${slot.slot_start} -> JS Local: ${timeStr}`);
    });
    
    // Check for morning slots in the results
    const morningCount = slotsResult.rows.filter(slot => {
      const slotStart = new Date(slot.slot_start);
      const hour = slotStart.getHours();
      return hour >= 8 && hour <= 11;
    }).length;
    
    console.log(`\n=== FINAL RESULT ===`);
    if (morningCount > 0) {
      console.log(`🎉 SUCCESS! Found ${morningCount} morning slots in the first 20 results!`);
      console.log('✅ Morning appointments should now be bookable by customers!');
    } else {
      console.log('❌ Still no morning slots found in the results');
    }
    
  } catch (error) {
    console.error('❌ Error in quick fix:', error.message);
    console.error(error.stack);
  } finally {
    await pool.end();
  }
}

quickFixMorningSlots();