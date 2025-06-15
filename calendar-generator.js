// AUTOMATIC CALENDAR SLOT GENERATION
// When business sets hours, generate slots for the next 365 days automatically

const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

// Generate calendar slots for a business based on their business_hours
async function generateCalendarSlots(businessId, daysAhead = 365) {
  try {
    console.log(`📅 Generating calendar slots for business ${businessId} for next ${daysAhead} days`);
    
    // Get business hours and preferences
    const businessResult = await pool.query(`
      SELECT business_hours, calendar_preferences 
      FROM businesses 
      WHERE id = $1
    `, [businessId]);
    
    if (businessResult.rows.length === 0) {
      throw new Error('Business not found');
    }
    
    const { business_hours, calendar_preferences } = businessResult.rows[0];
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
      const currentDate = new Date(now);
      currentDate.setDate(now.getDate() + day);
      
      const dayNames = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
      const dayName = dayNames[currentDate.getDay()];
      
      const dayHours = business_hours[dayName];
      if (!dayHours || !dayHours.enabled) continue;
      
      const [startHour, startMinute] = dayHours.start.split(':').map(Number);
      const [endHour, endMinute] = dayHours.end.split(':').map(Number);
      
      // Generate slots every 30 minutes during business hours
      for (let hour = startHour; hour < endHour || (hour === endHour && 0 < endMinute); hour++) {
        for (let minute = 0; minute < 60; minute += 30) {
          // Create slot in business timezone (Eastern Time)
          const slotStart = new Date(currentDate);
          slotStart.setHours(hour, minute, 0, 0);
          
          // Skip if past end time
          if (hour === endHour && minute >= endMinute) break;
          if (hour > endHour) break;
          
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
    
    // Batch insert all slots
    if (slots.length > 0) {
      const values = slots.map(slot => `('${slot.businessId}', '${slot.slotStart}', '${slot.slotEnd}', ${slot.isAvailable})`).join(',');
      
      await pool.query(`
        INSERT INTO calendar_slots (business_id, slot_start, slot_end, is_available)
        VALUES ${values}
      `);
    }
    
    console.log(`📅 Generated ${slots.length} calendar slots for business ${businessId}`);
    return slots.length;
    
  } catch (error) {
    console.error('❌ Error generating calendar slots:', error);
    throw error;
  }
}

module.exports = { generateCalendarSlots };