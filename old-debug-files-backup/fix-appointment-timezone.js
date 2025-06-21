require('dotenv').config();
const { Pool } = require('pg');

async function fixAppointmentTimezone() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const businessId = '8fea02b5-850a-4167-913b-a12043c65d17'; // Tom's Garage
  
  try {
    console.log('=== FIXING APPOINTMENT TIMEZONE STORAGE ISSUE ===\n');
    
    // First, show the current problematic appointments
    console.log('1. Current problematic appointments:');
    const currentApts = await pool.query(`
      SELECT 
        id,
        start_time,
        end_time,
        start_time AT TIME ZONE 'America/New_York' as local_start,
        end_time AT TIME ZONE 'America/New_York' as local_end,
        service_name,
        customer_name
      FROM appointments 
      WHERE business_id = $1 
      AND status IN ('scheduled', 'confirmed')
      AND start_time >= NOW()
      AND DATE(start_time) = '2025-06-16'
      ORDER BY start_time
    `, [businessId]);
    
    console.log('Monday June 16 appointments (BEFORE fix):');
    currentApts.rows.forEach((apt, i) => {
      console.log(`  ${i + 1}. UTC: ${apt.start_time} | Local: ${apt.local_start}`);
      console.log(`     Service: ${apt.service_name} | Customer: ${apt.customer_name}`);
    });
    
    console.log('\n2. Analyzing the timezone issue...');
    console.log('The appointments appear to be stored in UTC but were created as if they were local times.');
    console.log('For example: 8 AM local appointment was stored as 8 AM UTC (which is 12 PM local)');
    
    // Calculate the correction needed
    // If an appointment was meant to be at 8 AM local but stored as 8 AM UTC,
    // we need to convert it to 12:00 UTC (which is 8 AM EDT in summer)
    
    console.log('\n3. Fixing the timezone storage...');
    
    // Fix each Monday appointment
    for (const apt of currentApts.rows) {
      const utcTime = new Date(apt.start_time);
      const endUtcTime = new Date(apt.end_time);
      
      // The appointment was intended to be at the local time shown in start_time
      // But it was stored as UTC. We need to shift it by the timezone offset.
      // EDT is UTC-4, so we need to add 4 hours to get the correct UTC time
      const correctedStartUtc = new Date(utcTime.getTime() + (4 * 60 * 60 * 1000));
      const correctedEndUtc = new Date(endUtcTime.getTime() + (4 * 60 * 60 * 1000));
      
      console.log(`Fixing appointment ${apt.id}:`);
      console.log(`  OLD: ${utcTime.toISOString()} - ${endUtcTime.toISOString()}`);
      console.log(`  NEW: ${correctedStartUtc.toISOString()} - ${correctedEndUtc.toISOString()}`);
      
      // Update the appointment
      await pool.query(`
        UPDATE appointments 
        SET 
          start_time = $2,
          end_time = $3,
          updated_at = CURRENT_TIMESTAMP
        WHERE id = $1
      `, [apt.id, correctedStartUtc.toISOString(), correctedEndUtc.toISOString()]);
      
      console.log(`  ✅ Updated successfully`);
    }
    
    console.log('\n4. Verifying the fix...');
    const fixedApts = await pool.query(`
      SELECT 
        id,
        start_time,
        end_time,
        start_time AT TIME ZONE 'America/New_York' as local_start,
        end_time AT TIME ZONE 'America/New_York' as local_end,
        service_name,
        customer_name
      FROM appointments 
      WHERE business_id = $1 
      AND status IN ('scheduled', 'confirmed')
      AND start_time >= NOW()
      AND DATE(start_time AT TIME ZONE 'America/New_York') = '2025-06-16'
      ORDER BY start_time
    `, [businessId]);
    
    console.log('Monday June 16 appointments (AFTER fix):');
    fixedApts.rows.forEach((apt, i) => {
      console.log(`  ${i + 1}. UTC: ${apt.start_time} | Local: ${apt.local_start}`);
      console.log(`     Service: ${apt.service_name} | Customer: ${apt.customer_name}`);
    });
    
    console.log('\n5. Testing if morning slots are now available...');
    // Run a quick test of getAvailableSlots logic
    const testSlots = await pool.query(`
      SELECT 
        slot_start,
        slot_start AT TIME ZONE 'America/New_York' as local_start
      FROM calendar_slots
      WHERE business_id = $1
      AND is_available = true
      AND is_blocked = false
      AND DATE(slot_start AT TIME ZONE 'America/New_York') = '2025-06-16'
      AND EXTRACT(hour FROM slot_start AT TIME ZONE 'America/New_York') BETWEEN 8 AND 11
      ORDER BY slot_start
      LIMIT 10
    `, [businessId]);
    
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
    
    const availableMorningSlots = testSlots.rows.filter(slot => {
      const slotStart = new Date(slot.slot_start);
      const slotEnd = new Date(slotStart.getTime() + 60 * 60 * 1000); // 1 hour duration
      
      return !bookedTimes.some(booked => 
        (slotStart < booked.end && slotEnd > booked.start)
      );
    });
    
    console.log(`Available morning slots after fix: ${availableMorningSlots.length}`);
    availableMorningSlots.forEach((slot, i) => {
      console.log(`  ${i + 1}. ${slot.local_start}`);
    });
    
  } catch (error) {
    console.error('❌ Error fixing appointments:', error.message);
    console.error(error.stack);
  } finally {
    await pool.end();
  }
}

fixAppointmentTimezone();