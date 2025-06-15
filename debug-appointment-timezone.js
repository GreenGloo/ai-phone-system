require('dotenv').config();
const { Pool } = require('pg');

async function debugAppointmentTimezone() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const businessId = '8fea02b5-850a-4167-913b-a12043c65d17'; // Tom's Garage
  
  try {
    console.log('=== DEBUGGING APPOINTMENT TIMEZONE CONVERSION ===\n');
    
    // Check the first Monday morning appointment in detail
    console.log('1. Checking specific Monday morning appointments...');
    const mondayApts = await pool.query(`
      SELECT 
        id,
        start_time,
        end_time,
        start_time AT TIME ZONE 'America/New_York' as local_start,
        end_time AT TIME ZONE 'America/New_York' as local_end,
        DATE(start_time AT TIME ZONE 'America/New_York') as local_date,
        EXTRACT(hour FROM start_time AT TIME ZONE 'America/New_York') as local_hour,
        service_name,
        customer_name
      FROM appointments 
      WHERE business_id = $1 
      AND status IN ('scheduled', 'confirmed')
      AND start_time >= NOW()
      ORDER BY start_time
      LIMIT 5
    `, [businessId]);
    
    console.log('First 5 appointments with timezone conversion:');
    mondayApts.rows.forEach((apt, i) => {
      console.log(`\n${i + 1}. ID: ${apt.id}`);
      console.log(`   Raw start: ${apt.start_time}`);
      console.log(`   Local start: ${apt.local_start}`);
      console.log(`   Local date: ${apt.local_date}`);
      console.log(`   Local hour: ${apt.local_hour}`);
      console.log(`   Service: ${apt.service_name}`);
      console.log(`   Customer: ${apt.customer_name}`);
    });
    
    // Test the exact query used in getAvailableSlots
    console.log('\n2. Testing the exact query from getAvailableSlots...');
    const exactQuery = await pool.query(`
      SELECT start_time, end_time 
      FROM appointments 
      WHERE business_id = $1 
      AND status IN ('scheduled', 'confirmed')
      AND start_time >= NOW()
    `, [businessId]);
    
    console.log(`Exact query result: ${exactQuery.rows.length} appointments`);
    exactQuery.rows.forEach((apt, i) => {
      const start = new Date(apt.start_time);
      const end = new Date(apt.end_time);
      console.log(`  ${i + 1}. ${start.toLocaleString()} to ${end.toLocaleString()}`);
    });
    
    // Check if there's a date issue
    console.log('\n3. Testing date comparison...');
    const dateTest = await pool.query(`
      SELECT 
        '2025-06-16'::date as target_date,
        DATE(start_time AT TIME ZONE 'America/New_York') as apt_date,
        DATE(start_time AT TIME ZONE 'America/New_York') = '2025-06-16'::date as date_match,
        start_time AT TIME ZONE 'America/New_York' as local_time,
        service_name
      FROM appointments 
      WHERE business_id = $1 
      AND status IN ('scheduled', 'confirmed')
      AND start_time >= NOW()
      AND start_time AT TIME ZONE 'America/New_York' < '2025-06-17 00:00:00'::timestamp
      ORDER BY start_time
    `, [businessId]);
    
    console.log('Date comparison test:');
    dateTest.rows.forEach((apt, i) => {
      console.log(`  ${i + 1}. ${apt.apt_date} = ${apt.target_date}? ${apt.date_match} | ${apt.local_time} - ${apt.service_name}`);
    });
    
  } catch (error) {
    console.error('❌ Error debugging appointments:', error.message);
    console.error(error.stack);
  } finally {
    await pool.end();
  }
}

debugAppointmentTimezone();