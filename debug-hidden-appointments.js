// Debug script to find hidden appointments blocking service deletion
const { Pool } = require('pg');

async function debugHiddenAppointments() {
  if (!process.env.DATABASE_URL) {
    console.log('❌ DATABASE_URL not configured - run this on the server');
    return;
  }

  const pool = new Pool({
    connectionString: process.env.DATABASE_URL
  });

  try {
    // Get Tom's garage business ID
    const businessResult = await pool.query(
      "SELECT id, name FROM businesses WHERE name ILIKE '%tom%' OR name ILIKE '%garage%'"
    );

    if (businessResult.rows.length === 0) {
      console.log('❌ No Tom\'s garage found');
      return;
    }

    const business = businessResult.rows[0];
    console.log(`🏢 Found business: ${business.name} (ID: ${business.id})`);

    // Get all service types for this business
    const servicesResult = await pool.query(
      "SELECT id, name FROM service_types WHERE business_id = $1",
      [business.id]
    );

    console.log(`\n🔧 Found ${servicesResult.rows.length} services:`);
    servicesResult.rows.forEach(service => {
      console.log(`   - ${service.name} (ID: ${service.id})`);
    });

    // For each service, find ALL appointments (including hidden ones)
    for (const service of servicesResult.rows) {
      console.log(`\n🔍 Checking appointments for service: ${service.name}`);
      
      const appointmentsResult = await pool.query(
        `SELECT id, customer_name, customer_phone, start_time, status, created_at
         FROM appointments 
         WHERE service_type_id = $1 
         ORDER BY start_time DESC`,
        [service.id]
      );

      console.log(`   Found ${appointmentsResult.rows.length} appointments:`);
      
      if (appointmentsResult.rows.length === 0) {
        console.log(`   ✅ No appointments - service can be deleted`);
      } else {
        appointmentsResult.rows.forEach(apt => {
          const startTime = new Date(apt.start_time).toLocaleString();
          console.log(`   - ${apt.customer_name} | ${apt.customer_phone} | ${startTime} | Status: ${apt.status} | ID: ${apt.id}`);
        });

        // Show option to bulk cancel
        const scheduledCount = appointmentsResult.rows.filter(apt => apt.status === 'scheduled').length;
        if (scheduledCount > 0) {
          console.log(`   ⚠️ ${scheduledCount} scheduled appointments blocking deletion`);
        }
      }
    }

    // Summary of all appointments for this business
    console.log(`\n📊 SUMMARY - All appointments for ${business.name}:`);
    const allAppointmentsResult = await pool.query(
      `SELECT a.id, a.customer_name, a.start_time, a.status, st.name as service_name
       FROM appointments a
       JOIN service_types st ON a.service_type_id = st.id
       WHERE a.business_id = $1
       ORDER BY a.start_time DESC`,
      [business.id]
    );

    console.log(`Total appointments: ${allAppointmentsResult.rows.length}`);
    
    const statusCounts = {};
    allAppointmentsResult.rows.forEach(apt => {
      statusCounts[apt.status] = (statusCounts[apt.status] || 0) + 1;
    });
    
    Object.entries(statusCounts).forEach(([status, count]) => {
      console.log(`   ${status}: ${count}`);
    });

  } catch (error) {
    console.error('❌ Error:', error.message);
  } finally {
    await pool.end();
  }
}

debugHiddenAppointments();