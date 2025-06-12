require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function testAvailabilityLogic() {
  try {
    console.log('🧪 Testing availability calculation logic...');
    
    const businessId = '9e075387-b066-4b70-ac33-6bce880f73df';
    const serviceId = '309b7646-1e55-4836-8342-759ecfe09b87';
    const testDate = new Date('2025-06-12'); // Tomorrow
    
    // Get business hours
    const businessResult = await pool.query(
      'SELECT business_hours FROM businesses WHERE id = $1',
      [businessId]
    );
    
    if (businessResult.rows.length === 0) {
      throw new Error('Business not found');
    }
    
    const business = businessResult.rows[0];
    console.log('✅ Business hours:', JSON.stringify(business.business_hours, null, 2));
    
    // Get service duration
    const serviceResult = await pool.query(
      'SELECT duration_minutes, name FROM service_types WHERE id = $1 AND business_id = $2',
      [serviceId, businessId]
    );
    
    if (serviceResult.rows.length === 0) {
      throw new Error('Service not found');
    }
    
    const service = serviceResult.rows[0];
    console.log('✅ Service:', service.name, '(' + service.duration_minutes + ' minutes)');
    
    // Get existing appointments
    const startOfDay = new Date(testDate);
    startOfDay.setHours(0, 0, 0, 0);
    
    const endOfDay = new Date(testDate);
    endOfDay.setHours(23, 59, 59, 999);
    
    const appointmentsResult = await pool.query(
      `SELECT start_time, end_time, duration_minutes, customer_name, service_name
       FROM appointments 
       WHERE business_id = $1 
       AND start_time >= $2 
       AND start_time <= $3 
       AND status NOT IN ('cancelled', 'no_show')
       ORDER BY start_time`,
      [businessId, startOfDay.toISOString(), endOfDay.toISOString()]
    );
    
    console.log('✅ Existing appointments for', testDate.toDateString() + ':');
    if (appointmentsResult.rows.length === 0) {
      console.log('   No appointments found');
    } else {
      appointmentsResult.rows.forEach(apt => {
        const startTime = new Date(apt.start_time).toLocaleTimeString();
        console.log(`   - ${apt.customer_name}: ${apt.service_name} at ${startTime} (${apt.duration_minutes}min)`);
      });
    }
    
    // Test availability calculation
    const dayName = testDate.toLocaleDateString('en-US', { weekday: 'long' }).toLowerCase();
    const dayHours = business.business_hours[dayName];
    
    console.log('✅ Day of week:', dayName);
    console.log('✅ Business hours for', dayName + ':', dayHours);
    
    if (!dayHours || !dayHours.enabled) {
      console.log('❌ Business closed on', dayName);
      return;
    }
    
    const serviceDuration = service.duration_minutes;
    const bufferTime = 30; // Default buffer time
    
    console.log('✅ Service duration:', serviceDuration, 'minutes');
    console.log('✅ Buffer time:', bufferTime, 'minutes');
    
    // Calculate available slots (simplified version for testing)
    const [startHour, startMinute] = dayHours.start.split(':').map(Number);
    const [endHour, endMinute] = dayHours.end.split(':').map(Number);
    
    console.log('✅ Business opens:', startHour + ':' + startMinute.toString().padStart(2, '0'));
    console.log('✅ Business closes:', endHour + ':' + endMinute.toString().padStart(2, '0'));
    
    const slots = [];
    const slotInterval = 30; // minutes
    
    let currentTime = new Date(testDate);
    currentTime.setHours(startHour, startMinute, 0, 0);
    
    const businessEnd = new Date(testDate);
    businessEnd.setHours(endHour, endMinute, 0, 0);
    
    console.log('\\n🔍 Calculating available slots...');
    
    let slotCount = 0;
    while (currentTime < businessEnd && slotCount < 10) { // Limit to first 10 slots for testing
      const slotEnd = new Date(currentTime.getTime() + (serviceDuration + bufferTime) * 60 * 1000);
      
      if (slotEnd <= businessEnd) {
        // Check for conflicts
        const hasConflict = appointmentsResult.rows.some(appointment => {
          const aptStart = new Date(appointment.start_time);
          const aptEnd = new Date(appointment.end_time);
          
          const bufferedStart = new Date(aptStart.getTime() - bufferTime * 60 * 1000);
          const bufferedEnd = new Date(aptEnd.getTime() + bufferTime * 60 * 1000);
          
          return (currentTime < bufferedEnd && slotEnd > bufferedStart);
        });
        
        const status = hasConflict ? '❌ BLOCKED' : '✅ AVAILABLE';
        const timeDisplay = currentTime.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
        
        console.log(`   ${timeDisplay} - ${status}`);
        
        if (!hasConflict) {
          slots.push({
            time: currentTime.toTimeString().slice(0, 5),
            display: timeDisplay
          });
        }
      }
      
      currentTime = new Date(currentTime.getTime() + slotInterval * 60 * 1000);
      slotCount++;
    }
    
    console.log('\\n🎯 RESULT: Found', slots.length, 'available slots');
    console.log('Available times:', slots.map(s => s.display).join(', '));
    
  } catch (error) {
    console.error('❌ Test failed:', error.message);
    console.error('Stack:', error.stack);
  } finally {
    process.exit(0);
  }
}

testAvailabilityLogic();