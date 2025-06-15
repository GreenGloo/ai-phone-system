// Fix existing cancelled appointments to remove service references
const { Pool } = require('pg');

async function fixExistingCancelledAppointments() {
  if (!process.env.DATABASE_URL) {
    console.log('❌ DATABASE_URL not configured - run this on the server');
    return;
  }

  const pool = new Pool({
    connectionString: process.env.DATABASE_URL
  });

  try {
    console.log('🔄 Fixing existing cancelled appointments...');
    
    // Find cancelled appointments that still have service references
    const cancelledWithServiceResult = await pool.query(
      `SELECT id, customer_name, status, service_type_id
       FROM appointments 
       WHERE status IN ('cancelled', 'completed', 'no_show') 
       AND service_type_id IS NOT NULL`
    );

    console.log(`📋 Found ${cancelledWithServiceResult.rows.length} cancelled appointments with service references:`);
    
    if (cancelledWithServiceResult.rows.length === 0) {
      console.log('✅ No cancelled appointments need fixing');
      return;
    }

    cancelledWithServiceResult.rows.forEach(apt => {
      console.log(`   - ${apt.customer_name} | Status: ${apt.status} | Service: ${apt.service_type_id}`);
    });

    // Remove service references from cancelled appointments
    const fixResult = await pool.query(
      `UPDATE appointments 
       SET service_type_id = NULL, 
           updated_at = CURRENT_TIMESTAMP
       WHERE status IN ('cancelled', 'completed', 'no_show') 
       AND service_type_id IS NOT NULL
       RETURNING id, customer_name, status`
    );

    console.log(`\n✅ Fixed ${fixResult.rows.length} appointments:`);
    fixResult.rows.forEach(apt => {
      console.log(`   - ${apt.customer_name} (${apt.status}) - service reference removed`);
    });

    console.log('\n🎯 Services should now be deletable!');

  } catch (error) {
    console.error('❌ Error:', error.message);
  } finally {
    await pool.end();
  }
}

fixExistingCancelledAppointments();