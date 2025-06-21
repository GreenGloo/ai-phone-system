require('dotenv').config();
const { Pool } = require('pg');

async function checkExistingAppointments() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const businessId = '8fea02b5-850a-4167-913b-a12043c65d17'; // Tom's Garage
  
  try {
    console.log('=== CHECKING EXISTING APPOINTMENTS ===\n');
    
    // Check appointments table structure first
    const structure = await pool.query(`
      SELECT column_name, data_type, is_nullable
      FROM information_schema.columns
      WHERE table_name = 'appointments'
      ORDER BY ordinal_position
    `);
    
    console.log('Appointments table structure:');
    structure.rows.forEach(col => {
      console.log(`  ${col.column_name}: ${col.data_type} (nullable: ${col.is_nullable})`);
    });
    console.log('');
    
    // Check existing appointments for Tom's Garage
    const existingAppointments = await pool.query(`
      SELECT 
        id,
        start_time,
        end_time,
        start_time AT TIME ZONE 'America/New_York' as local_start,
        end_time AT TIME ZONE 'America/New_York' as local_end,
        status,
        service_name,
        customer_name,
        customer_phone,
        created_at
      FROM appointments 
      WHERE business_id = $1 
      AND status IN ('scheduled', 'confirmed')
      AND start_time >= NOW()
      ORDER BY start_time
    `, [businessId]);
    
    console.log(`Found ${existingAppointments.rows.length} existing appointments:`);
    
    if (existingAppointments.rows.length === 0) {
      console.log('❌ No existing appointments found - something else is wrong!');
    } else {
      existingAppointments.rows.forEach((apt, i) => {
        console.log(`\n${i + 1}. Appointment ID: ${apt.id}`);
        console.log(`   Time: ${apt.local_start} to ${apt.local_end}`);
        console.log(`   Status: ${apt.status}`);
        console.log(`   Service: ${apt.service_name}`);
        console.log(`   Customer: ${apt.customer_name} (${apt.customer_phone})`);
        console.log(`   Created: ${apt.created_at}`);
      });
    }
    
    // Check specifically for Monday morning appointments
    console.log('\n=== MONDAY MORNING APPOINTMENT CHECK ===');
    const mondayMorningApts = await pool.query(`
      SELECT 
        start_time AT TIME ZONE 'America/New_York' as local_start,
        end_time AT TIME ZONE 'America/New_York' as local_end,
        status,
        service_name,
        customer_name
      FROM appointments 
      WHERE business_id = $1 
      AND DATE(start_time AT TIME ZONE 'America/New_York') = '2025-06-16'
      AND EXTRACT(hour FROM start_time AT TIME ZONE 'America/New_York') BETWEEN 8 AND 11
      AND status IN ('scheduled', 'confirmed')
      ORDER BY start_time
    `, [businessId]);
    
    if (mondayMorningApts.rows.length === 0) {
      console.log('✅ No Monday morning appointments found - morning slots should be available!');
    } else {
      console.log(`❌ Found ${mondayMorningApts.rows.length} Monday morning appointments blocking slots:`);
      mondayMorningApts.rows.forEach((apt, i) => {
        console.log(`  ${i + 1}. ${apt.local_start} - ${apt.local_end} (${apt.service_name}) - ${apt.customer_name}`);
      });
    }
    
    // Check for any appointments that might be overlapping with ALL morning slots
    console.log('\n=== CHECKING FOR WIDE-RANGE BLOCKING APPOINTMENTS ===');
    const longAppointments = await pool.query(`
      SELECT 
        start_time AT TIME ZONE 'America/New_York' as local_start,
        end_time AT TIME ZONE 'America/New_York' as local_end,
        EXTRACT(EPOCH FROM (end_time - start_time)) / 3600 as duration_hours,
        status,
        service_name,
        customer_name
      FROM appointments 
      WHERE business_id = $1 
      AND status IN ('scheduled', 'confirmed')
      AND start_time >= NOW()
      AND EXTRACT(EPOCH FROM (end_time - start_time)) / 3600 > 4
      ORDER BY start_time
    `, [businessId]);
    
    if (longAppointments.rows.length > 0) {
      console.log(`Found ${longAppointments.rows.length} long appointments (>4 hours) that might be blocking multiple slots:`);
      longAppointments.rows.forEach((apt, i) => {
        console.log(`  ${i + 1}. ${apt.local_start} - ${apt.local_end} (${apt.duration_hours.toFixed(1)} hours) - ${apt.service_name}`);
      });
    } else {
      console.log('✅ No unusually long appointments found');
    }
    
  } catch (error) {
    console.error('❌ Error checking appointments:', error.message);
    console.error(error.stack);
  } finally {
    await pool.end();
  }
}

checkExistingAppointments();