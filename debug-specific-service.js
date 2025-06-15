// Debug the specific service that's failing to delete
const { Pool } = require('pg');

async function debugSpecificService() {
  if (!process.env.DATABASE_URL) {
    console.log('❌ DATABASE_URL not configured - run this on the server');
    return;
  }

  const pool = new Pool({
    connectionString: process.env.DATABASE_URL
  });

  try {
    const businessId = '8fea02b5-850a-4167-913b-a12043c65d17';
    const serviceId = '622e37a6-ba4d-4684-bc3c-540f3e8d6398';
    
    console.log('🔍 Debugging specific service deletion issue...');
    console.log(`Business ID: ${businessId}`);
    console.log(`Service ID: ${serviceId}`);
    
    // Check if service exists
    const serviceResult = await pool.query(
      'SELECT * FROM service_types WHERE id = $1 AND business_id = $2',
      [serviceId, businessId]
    );
    
    if (serviceResult.rows.length === 0) {
      console.log('❌ Service not found - this might be why deletion fails');
      return;
    }
    
    const service = serviceResult.rows[0];
    console.log(`✅ Service found: ${service.name}`);
    
    // Check ALL appointments for this service with ALL statuses
    const allAppointmentsResult = await pool.query(
      'SELECT id, customer_name, start_time, status, created_at FROM appointments WHERE service_type_id = $1 ORDER BY status, start_time',
      [serviceId]
    );
    
    console.log(`\n📋 ALL appointments for this service (${allAppointmentsResult.rows.length} total):`);
    
    const statusGroups = {};
    allAppointmentsResult.rows.forEach(apt => {
      if (!statusGroups[apt.status]) {
        statusGroups[apt.status] = [];
      }
      statusGroups[apt.status].push(apt);
    });
    
    Object.entries(statusGroups).forEach(([status, appointments]) => {
      console.log(`\n${status.toUpperCase()} (${appointments.length}):`);
      appointments.forEach(apt => {
        const startTime = new Date(apt.start_time).toLocaleString();
        console.log(`   - ${apt.customer_name} | ${startTime} | ID: ${apt.id}`);
      });
    });
    
    // Check the exact count that the deletion check would find
    const countResult = await pool.query(
      'SELECT COUNT(*) as count FROM appointments WHERE service_type_id = $1',
      [serviceId]
    );
    
    const totalCount = parseInt(countResult.rows[0].count);
    console.log(`\n🔢 Total count that blocks deletion: ${totalCount}`);
    
    if (totalCount > 0) {
      console.log('❌ This explains why service deletion fails');
      console.log('💡 Solution: Change deletion check to only count scheduled/confirmed appointments');
    } else {
      console.log('✅ No appointments should be blocking deletion');
      console.log('🤔 The 400 error might be coming from elsewhere');
    }
    
    // Check calendar slots
    const calendarSlotsResult = await pool.query(
      'SELECT id, start_time, is_booked, appointment_id FROM calendar_slots WHERE appointment_id IN (SELECT id FROM appointments WHERE service_type_id = $1)',
      [serviceId]
    );
    
    console.log(`\n📅 Related calendar slots: ${calendarSlotsResult.rows.length}`);
    calendarSlotsResult.rows.forEach(slot => {
      const startTime = new Date(slot.start_time).toLocaleString();
      console.log(`   - ${startTime} | Booked: ${slot.is_booked} | Apt ID: ${slot.appointment_id}`);
    });

  } catch (error) {
    console.error('❌ Error:', error.message);
    console.error('Stack:', error.stack);
  } finally {
    await pool.end();
  }
}

debugSpecificService();