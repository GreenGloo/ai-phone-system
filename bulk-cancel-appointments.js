// Bulk cancel all appointments for a specific service to allow service deletion
const { Pool } = require('pg');

async function bulkCancelAppointments(serviceId, serviceName) {
  if (!process.env.DATABASE_URL) {
    console.log('❌ DATABASE_URL not configured - run this on the server');
    return;
  }

  const pool = new Pool({
    connectionString: process.env.DATABASE_URL
  });

  try {
    console.log(`🔄 Bulk cancelling all appointments for service: ${serviceName || serviceId}`);
    
    // First, show what will be cancelled
    const appointmentsToCancel = await pool.query(
      `SELECT id, customer_name, customer_phone, start_time, status
       FROM appointments 
       WHERE service_type_id = $1 AND status IN ('scheduled', 'confirmed')`,
      [serviceId]
    );

    if (appointmentsToCancel.rows.length === 0) {
      console.log('✅ No scheduled appointments to cancel');
      return;
    }

    console.log(`\n📋 Appointments to be cancelled (${appointmentsToCancel.rows.length}):`);
    appointmentsToCancel.rows.forEach(apt => {
      const startTime = new Date(apt.start_time).toLocaleString();
      console.log(`   - ${apt.customer_name} | ${apt.customer_phone} | ${startTime}`);
    });

    // Cancel all appointments
    const cancelResult = await pool.query(
      `UPDATE appointments 
       SET status = 'cancelled', 
           updated_at = CURRENT_TIMESTAMP
       WHERE service_type_id = $1 AND status IN ('scheduled', 'confirmed')
       RETURNING id`,
      [serviceId]
    );

    console.log(`\n✅ Cancelled ${cancelResult.rows.length} appointments`);

    // Free up calendar slots
    for (const appointment of cancelResult.rows) {
      try {
        await pool.query(
          `UPDATE calendar_slots 
           SET is_booked = false, 
               appointment_id = NULL,
               updated_at = CURRENT_TIMESTAMP
           WHERE appointment_id = $1`,
          [appointment.id]
        );

        await pool.query(
          `UPDATE notifications 
           SET read = true,
               updated_at = CURRENT_TIMESTAMP
           WHERE data->>'appointment_id' = $1 OR data->>'appointmentId' = $1`,
          [appointment.id]
        );
      } catch (cleanupError) {
        console.log(`⚠️ Cleanup error for appointment ${appointment.id}:`, cleanupError.message);
      }
    }

    console.log(`✅ Freed calendar slots and cleared notifications`);
    console.log(`🎯 Service ${serviceName || serviceId} should now be deletable`);

  } catch (error) {
    console.error('❌ Error:', error.message);
  } finally {
    await pool.end();
  }
}

// Get service ID from command line args or use default
const serviceId = process.argv[2];
const serviceName = process.argv[3];

if (!serviceId) {
  console.log('Usage: node bulk-cancel-appointments.js <service-id> [service-name]');
  console.log('Example: node bulk-cancel-appointments.js 622e37a6-ba4d-4684-bc3c-540f3e8d6398 "Oil Change"');
  process.exit(1);
}

bulkCancelAppointments(serviceId, serviceName);