// AUTOMATIC CALENDAR SLOT GENERATION
// When business sets hours, generate slots for the next 365 days automatically

const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

// Generate calendar slots for a business based on their business_hours
async function generateCalendarSlots(businessId, daysAhead = 400) {
  try {
    console.log(`📅 Generating ${daysAhead} days of calendar slots for business ${businessId} (13+ months for annual appointments)`);
    
    // Get business hours, preferences, and timezone
    const businessResult = await pool.query(`
      SELECT business_hours, calendar_preferences, timezone 
      FROM businesses 
      WHERE id = $1
    `, [businessId]);
    
    if (businessResult.rows.length === 0) {
      throw new Error('Business not found');
    }
    
    const { business_hours, calendar_preferences, timezone } = businessResult.rows[0];
    const businessTimezone = timezone || 'America/New_York';
    console.log(`📅 Generating slots in timezone: ${businessTimezone}`);
    const appointmentDuration = calendar_preferences?.appointmentDuration || 60;
    const bufferTime = calendar_preferences?.bufferTime || 30;
    
    // Clear existing future slots (regenerate)
    await pool.query(`
      DELETE FROM calendar_slots 
      WHERE business_id = $1 
      AND slot_start >= NOW()
    `, [businessId]);
    
    const slots = [];
    const now = new Date();
    
    for (let day = 0; day < daysAhead; day++) {
      // Create proper business date in business timezone
      const businessDate = new Date();
      businessDate.setDate(businessDate.getDate() + day);
      
      // Convert to business timezone to get the correct day/date for business hours lookup
      const businessDateStr = businessDate.toLocaleDateString('en-CA', { timeZone: businessTimezone }); // YYYY-MM-DD format
      const [year, month, date] = businessDateStr.split('-').map(Number);
      const businessLocalDate = new Date(year, month - 1, date); // Create date in local system time
      
      const dayNames = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
      const dayName = dayNames[businessLocalDate.getDay()];
      
      const dayHours = business_hours[dayName];
      if (!dayHours || !dayHours.enabled) continue;
      
      const [startHour, startMinute] = dayHours.start.split(':').map(Number);
      const [endHour, endMinute] = dayHours.end.split(':').map(Number);
      
      // Generate slots every 30 minutes during business hours
      for (let hour = startHour; hour < endHour || (hour === endHour && 0 < endMinute); hour++) {
        for (let minute = 0; minute < 60; minute += 30) {
          // Skip if past end time
          if (hour === endHour && minute >= endMinute) break;
          if (hour > endHour) break;
          
          // FIXED: Direct UTC calculation for business timezone using correct business date
          const isDST = businessLocalDate.getMonth() >= 2 && businessLocalDate.getMonth() <= 10; // Rough DST check
          const utcOffset = businessTimezone === 'America/New_York' ? (isDST ? 4 : 5) : 5; // Default to 5 for other timezones
          
          // Create UTC time by adding the offset to business time
          const slotStart = new Date(Date.UTC(
            year,
            month - 1, // Date.UTC expects 0-based month
            date,
            hour + utcOffset, // Add offset to convert business time to UTC
            minute,
            0
          ));
          
          
          // Skip past times for today
          if (day === 0 && slotStart <= now) continue;
          
          const slotEnd = new Date(slotStart.getTime() + appointmentDuration * 60000);
          
          slots.push({
            businessId,
            slotStart: slotStart.toISOString(),
            slotEnd: slotEnd.toISOString(),
            isAvailable: true
          });
        }
      }
    }
    
    // OPTIMIZED: Batch insert all slots in chunks for better performance
    if (slots.length > 0) {
      const BATCH_SIZE = 1000; // Insert 1000 slots at a time
      
      for (let i = 0; i < slots.length; i += BATCH_SIZE) {
        const batch = slots.slice(i, i + BATCH_SIZE);
        
        // Build multi-row INSERT for better performance
        const values = batch.map((_, index) => {
          const base = index * 4;
          return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4})`;
        }).join(',');
        
        const params = batch.flatMap(slot => [
          slot.businessId, 
          slot.slotStart, 
          slot.slotEnd, 
          slot.isAvailable
        ]);
        
        await pool.query(
          `INSERT INTO calendar_slots (business_id, slot_start, slot_end, is_available) VALUES ${values}`,
          params
        );
        
        console.log(`📊 Inserted batch ${Math.floor(i/BATCH_SIZE) + 1}/${Math.ceil(slots.length/BATCH_SIZE)} (${batch.length} slots)`);
      }
    }
    
    console.log(`📅 Generated ${slots.length} calendar slots for business ${businessId}`);
    return slots.length;
    
  } catch (error) {
    console.error('❌ Error generating calendar slots:', error);
    throw error;
  }
}

module.exports = { generateCalendarSlots };