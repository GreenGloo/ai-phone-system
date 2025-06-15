require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function getAvailableSlots(businessId, requestedTimeframe = 'soon') {
  try {
    console.log(`📅 Getting calendar slots for business ${businessId} (${requestedTimeframe})`);
    
    // Check if calendar_slots table exists
    const tableCheck = await pool.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_name = 'calendar_slots'
      );
    `);
    
    if (!tableCheck.rows[0].exists) {
      console.error('📅 calendar_slots table does not exist');
      return [];
    }
    
    let slotsResult;
    
    if (requestedTimeframe === 'soon' || requestedTimeframe === 'near_future') {
      // Default: Load next 6 weeks only (cost-efficient)
      const sixWeeksOut = new Date();
      sixWeeksOut.setDate(sixWeeksOut.getDate() + 42);
      
      console.log(`📅 Query date range: NOW to ${sixWeeksOut.toISOString()}`);
      
      slotsResult = await pool.query(`
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
      
    } else {
      // Customer mentioned specific far-future date - targeted search
      console.log('Using targeted search - not implemented in this test');
      return [];
    }
    
    console.log(`📅 Raw database query returned ${slotsResult.rows.length} slots`);
    
    if (slotsResult.rows.length === 0) {
      console.log('📅 No pre-generated slots found - business may need calendar setup');
      return [];
    }
    
    // Show first few raw results
    console.log('📅 First 5 raw slots from database:');
    slotsResult.rows.slice(0, 5).forEach((slot, i) => {
      console.log(`  ${i + 1}. start: ${slot.slot_start}, end: ${slot.slot_end}`);
    });
    
    // Check against existing appointments
    const existingAppointments = await pool.query(`
      SELECT start_time, end_time 
      FROM appointments 
      WHERE business_id = $1 
      AND status IN ('scheduled', 'confirmed')
      AND start_time >= NOW()
    `, [businessId]);
    
    console.log(`📅 Found ${existingAppointments.rows.length} existing appointments to filter out`);
    
    const bookedTimes = existingAppointments.rows.map(apt => ({
      start: new Date(apt.start_time),
      end: new Date(apt.end_time)
    }));
    
    // Filter out slots that conflict with appointments
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
        
        console.log(`📅 Slot processing: ${slot.slot_start} -> ${dayLabel} ${timeStr} (daysDiff: ${daysDiff})`);
        
        return {
          day: dayLabel,
          time: timeStr,
          datetime: slotStart.toISOString()
        };
      });
    
    console.log(`📅 Found ${availableSlots.length} available slots from pre-generated calendar`);
    console.log(`📅 Sample slots for AI:`, availableSlots.slice(0, 10).map(s => `${s.day} ${s.time}`));
    
    return availableSlots;
    
  } catch (error) {
    console.error('❌ Error in getAvailableSlots:', error.message);
    console.error(error.stack);
    return [];
  }
}

async function testGetAvailableSlots() {
  const businessId = '8fea02b5-850a-4167-913b-a12043c65d17'; // Tom's Garage
  
  console.log('=== TESTING getAvailableSlots FUNCTION ===\n');
  
  const slots = await getAvailableSlots(businessId, 'soon');
  
  console.log('\n=== FINAL RESULTS ===');
  console.log(`Total slots returned: ${slots.length}`);
  
  if (slots.length > 0) {
    console.log('\nFirst 10 slots:');
    slots.slice(0, 10).forEach((slot, i) => {
      console.log(`  ${i + 1}. ${slot.day} ${slot.time}`);
    });
  }
  
  await pool.end();
}

testGetAvailableSlots();