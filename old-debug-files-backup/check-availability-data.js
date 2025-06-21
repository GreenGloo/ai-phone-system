require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
});

// Copy the exact getAvailableSlots function from conversational-ai.js
async function getAvailableSlots(businessId) {
  try {
    console.log(`📅 Getting PRE-GENERATED calendar slots for business ${businessId}`);
    
    // Check if calendar_slots table exists, if not use basic method
    const tableCheck = await pool.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_name = 'calendar_slots'
      );
    `);
    
    if (!tableCheck.rows[0].exists) {
      console.error('📅 calendar_slots table does not exist - NO FAKE SLOTS');
      return [];
    }
    
    // Get available slots from pre-generated calendar - FULL YEAR AVAILABLE
    const slotsResult = await pool.query(`
      SELECT slot_start, slot_end
      FROM calendar_slots
      WHERE business_id = $1
      AND is_available = true
      AND is_blocked = false
      AND slot_start >= NOW()
      ORDER BY slot_start
      LIMIT 2000
    `, [businessId]);
    
    if (slotsResult.rows.length === 0) {
      console.log('📅 No pre-generated slots found - business may need calendar setup');
      return [];
    }
    
    console.log(`📅 Found ${slotsResult.rows.length} available slots`);
    
    // Format slots for the AI
    const formattedSlots = slotsResult.rows.map(slot => {
      const startTime = new Date(slot.slot_start);
      const endTime = new Date(slot.slot_end);
      
      // Format as readable date/time
      const day = startTime.toLocaleDateString('en-US', { 
        weekday: 'long', 
        month: 'long', 
        day: 'numeric',
        year: 'numeric'
      });
      
      const time = startTime.toLocaleTimeString('en-US', { 
        hour: 'numeric', 
        minute: '2-digit', 
        hour12: true 
      });
      
      return {
        day,
        time,
        datetime: slot.slot_start // ISO format for booking
      };
    });
    
    console.log(`📅 Formatted ${formattedSlots.length} slots for AI`);
    return formattedSlots;
    
  } catch (error) {
    console.error('❌ Error getting available slots:', error);
    return [];
  }
}

async function checkAvailabilityData() {
  try {
    const businessId = '8fea02b5-850a-4167-913b-a12043c65d17';
    
    console.log('=== CHECKING AVAILABILITY DATA FOR AI ===\n');
    
    const availability = await getAvailableSlots(businessId);
    
    console.log(`Total slots available: ${availability.length}`);
    
    if (availability.length > 0) {
      console.log('\nFirst 5 slots:');
      availability.slice(0, 5).forEach((slot, index) => {
        console.log(`  ${index + 1}. ${slot.day} at ${slot.time} (${slot.datetime})`);
      });
      
      console.log('\nLast 5 slots:');
      availability.slice(-5).forEach((slot, index) => {
        console.log(`  ${availability.length - 4 + index}. ${slot.day} at ${slot.time} (${slot.datetime})`);
      });
      
      // Check for February 2026 slots specifically
      const feb2026Slots = availability.filter(slot => {
        const date = new Date(slot.datetime);
        return date.getFullYear() === 2026 && date.getMonth() === 1; // February is month 1
      });
      
      console.log(`\nFebruary 2026 slots available: ${feb2026Slots.length}`);
      
      if (feb2026Slots.length > 0) {
        console.log('February 2026 slots:');
        feb2026Slots.slice(0, 10).forEach((slot, index) => {
          console.log(`  ${index + 1}. ${slot.day} at ${slot.time} (${slot.datetime})`);
        });
      }
      
      // Show the booking range that would be calculated
      const lastSlot = availability[availability.length - 1];
      const currentDate = new Date();
      const todayStr = currentDate.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
      const endDateStr = new Date(lastSlot.datetime).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
      
      console.log(`\nBooking range that AI sees:`);
      console.log(`From: ${todayStr}`);
      console.log(`To: ${endDateStr}`);
      console.log(`\nFull booking range message: "We have appointments available from ${todayStr} through ${endDateStr} - CUSTOMERS CAN BOOK WEEKS OR MONTHS IN ADVANCE!"`);
    }
    
  } catch (error) {
    console.error('Check failed:', error);
  } finally {
    await pool.end();
  }
}

checkAvailabilityData();