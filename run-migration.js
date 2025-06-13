require('dotenv').config();
const fs = require('fs');
const { Pool } = require('pg');

async function runMigration() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  
  try {
    console.log('🔧 Running calendar database migration...');
    
    const migrationSQL = fs.readFileSync('./fix-calendar-database.sql', 'utf8');
    await pool.query(migrationSQL);
    
    console.log('✅ Database fixed - calendar_preferences column added');
    console.log('✅ calendar_slots table created');
    
    // Now generate REAL slots for Tom's Garage
    console.log('📅 Generating REAL calendar slots for Toms Garage...');
    
    const businessId = '8fea02b5-850a-4167-913b-a12043c65d17';
    
    // Get business hours
    const business = await pool.query('SELECT business_hours FROM businesses WHERE id = $1', [businessId]);
    
    if (business.rows.length > 0) {
      const business_hours = business.rows[0].business_hours;
      console.log('Business hours:', business_hours);
      
      // Clear existing slots
      await pool.query('DELETE FROM calendar_slots WHERE business_id = $1', [businessId]);
      
      // Generate slots for next 30 days
      const slots = [];
      const now = new Date();
      
      for (let day = 0; day < 30; day++) {
        const currentDate = new Date(now);
        currentDate.setDate(now.getDate() + day);
        
        const dayNames = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
        const dayName = dayNames[currentDate.getDay()];
        
        const dayHours = business_hours[dayName];
        if (!dayHours || !dayHours.enabled) continue;
        
        const [startHour] = dayHours.start.split(':').map(Number);
        const [endHour] = dayHours.end.split(':').map(Number);
        
        for (let hour = startHour; hour < endHour; hour++) {
          const slotStart = new Date(currentDate);
          slotStart.setHours(hour, 0, 0, 0);
          
          if (day === 0 && slotStart <= now) continue;
          
          const slotEnd = new Date(slotStart.getTime() + 60 * 60000);
          
          slots.push([businessId, slotStart.toISOString(), slotEnd.toISOString()]);
        }
      }
      
      if (slots.length > 0) {
        // Insert slots in batches
        for (let i = 0; i < slots.length; i += 100) {
          const batch = slots.slice(i, i + 100);
          const values = batch.map((_, idx) => `($${idx * 3 + 1}, $${idx * 3 + 2}, $${idx * 3 + 3})`).join(',');
          const params = batch.flat();
          
          await pool.query(`INSERT INTO calendar_slots (business_id, slot_start, slot_end) VALUES ${values}`, params);
        }
        console.log(`✅ Generated ${slots.length} REAL calendar slots for Toms Garage`);
      }
    } else {
      console.log('❌ Business not found');
    }
    
  } catch (error) {
    console.error('❌ Error:', error.message);
    console.error('Stack:', error.stack);
  } finally {
    await pool.end();
  }
}

runMigration();