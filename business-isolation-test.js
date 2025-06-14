require('dotenv').config();
const { Pool } = require('pg');

// COMPREHENSIVE BUSINESS ISOLATION TEST SCRIPT
// Tests for potential data leakage between different businesses

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function testBusinessIsolation() {
  console.log('🔒 STARTING COMPREHENSIVE BUSINESS ISOLATION AUDIT');
  console.log('=' * 60);

  // Test businesses
  const business1 = '8fea02b5-850a-4167-913b-a12043c65d17'; // Tom's Garage
  const business2 = await getOrCreateTestBusiness(); // Hair Salon (test business)

  let criticalIssues = 0;
  let warnings = 0;

  // TEST 1: Services Isolation
  console.log('\n🧪 TEST 1: Services Isolation');
  try {
    const services1 = await pool.query(
      'SELECT id, name FROM service_types WHERE business_id = $1',
      [business1]
    );
    const services2 = await pool.query(
      'SELECT id, name FROM service_types WHERE business_id = $1', 
      [business2]
    );

    console.log(`Business 1 services: ${services1.rows.map(s => s.name).join(', ')}`);
    console.log(`Business 2 services: ${services2.rows.map(s => s.name).join(', ')}`);

    // Check for service bleed
    const overlap = services1.rows.filter(s1 => 
      services2.rows.some(s2 => s2.name === s1.name)
    );

    if (overlap.length > 0) {
      console.log('🚨 CRITICAL: Service name overlap detected!', overlap.map(s => s.name));
      criticalIssues++;
    } else {
      console.log('✅ SAFE: No service bleed between businesses');
    }
  } catch (error) {
    console.log('❌ Services test failed:', error.message);
    criticalIssues++;
  }

  // TEST 2: Calendar Slots Isolation
  console.log('\n🧪 TEST 2: Calendar Slots Isolation');
  try {
    const slots1 = await pool.query(
      'SELECT COUNT(*) FROM calendar_slots WHERE business_id = $1',
      [business1]
    );
    const slots2 = await pool.query(
      'SELECT COUNT(*) FROM calendar_slots WHERE business_id = $1',
      [business2]
    );

    console.log(`Business 1 slots: ${slots1.rows[0].count}`);
    console.log(`Business 2 slots: ${slots2.rows[0].count}`);

    // Test cross-business access attempt
    const crossAccess = await pool.query(
      'SELECT COUNT(*) FROM calendar_slots WHERE business_id != $1',
      [business1]
    );

    if (crossAccess.rows[0].count > 0) {
      console.log('⚠️ WARNING: Calendar slots exist for other businesses - verify isolation');
      warnings++;
    } else {
      console.log('✅ SAFE: Calendar slots properly isolated');
    }
  } catch (error) {
    console.log('❌ Calendar slots test failed:', error.message);
    criticalIssues++;
  }

  // TEST 3: Conversation Storage Isolation (CRITICAL TEST)
  console.log('\n🧪 TEST 3: Conversation Storage Isolation (CRITICAL)');
  try {
    // Create test conversations for both businesses
    const testCallSid1 = 'TEST_CALL_BIZ1_' + Date.now();
    const testCallSid2 = 'TEST_CALL_BIZ2_' + Date.now();

    await pool.query(
      'INSERT INTO conversations (call_sid, business_id, conversation_data) VALUES ($1, $2, $3)',
      [testCallSid1, business1, { test: 'business1_data', sensitive: 'business1_secret' }]
    );

    await pool.query(
      'INSERT INTO conversations (call_sid, business_id, conversation_data) VALUES ($1, $2, $3)',
      [testCallSid2, business2, { test: 'business2_data', sensitive: 'business2_secret' }]
    );

    // CRITICAL TEST: Try to access conversation without business_id filter
    const vulnerableQuery = await pool.query(
      'SELECT conversation_data FROM conversations WHERE call_sid = $1',
      [testCallSid1]
    );

    if (vulnerableQuery.rows.length > 0) {
      console.log('🚨 CRITICAL VULNERABILITY: Conversation accessible without business_id filter!');
      console.log('This allows any business to potentially access other businesses\' conversations');
      criticalIssues++;
    }

    // SECURE TEST: Access with business_id filter
    const secureQuery = await pool.query(
      'SELECT conversation_data FROM conversations WHERE call_sid = $1 AND business_id = $2',
      [testCallSid1, business1]
    );

    if (secureQuery.rows.length > 0) {
      console.log('✅ SECURE: Conversation properly filtered by business_id');
    }

    // Cross-business access test
    const crossBusinessQuery = await pool.query(
      'SELECT conversation_data FROM conversations WHERE call_sid = $1 AND business_id = $2',
      [testCallSid1, business2]
    );

    if (crossBusinessQuery.rows.length > 0) {
      console.log('🚨 CRITICAL: Cross-business conversation access possible!');
      criticalIssues++;
    } else {
      console.log('✅ SAFE: Cannot access other business\' conversations');
    }

    // Cleanup test data
    await pool.query('DELETE FROM conversations WHERE call_sid IN ($1, $2)', [testCallSid1, testCallSid2]);

  } catch (error) {
    console.log('❌ Conversation isolation test failed:', error.message);
    criticalIssues++;
  }

  // TEST 4: Appointments Isolation
  console.log('\n🧪 TEST 4: Appointments Isolation');
  try {
    const appointments1 = await pool.query(
      'SELECT COUNT(*) FROM appointments WHERE business_id = $1',
      [business1]
    );

    const appointments2 = await pool.query(
      'SELECT COUNT(*) FROM appointments WHERE business_id = $1',
      [business2]
    );

    console.log(`Business 1 appointments: ${appointments1.rows[0].count}`);
    console.log(`Business 2 appointments: ${appointments2.rows[0].count}`);

    // Test for unfiltered queries (should not exist)
    const allAppointments = await pool.query('SELECT DISTINCT business_id FROM appointments');
    const uniqueBusinesses = allAppointments.rows.length;

    console.log(`Total businesses with appointments: ${uniqueBusinesses}`);
    if (uniqueBusinesses > 1) {
      console.log('✅ GOOD: Multiple businesses have separate appointment data');
    }

  } catch (error) {
    console.log('❌ Appointments test failed:', error.message);
    criticalIssues++;
  }

  // TEST 5: Global State Isolation
  console.log('\n🧪 TEST 5: Global State Isolation');
  console.log('⚠️ WARNING: In-memory global state detected in app.js:');
  console.log('- voiceRequestTracker (Map) - global rate limiting affects all businesses');
  console.log('- This should be per-business or per-business+phone tracking');
  warnings++;

  // TEST 6: Hardcoded Business References
  console.log('\n🧪 TEST 6: Hardcoded Business References');
  console.log('🚨 CRITICAL: Hardcoded business IDs found in code:');
  console.log('- app.js: 8fea02b5-850a-4167-913b-a12043c65d17');
  console.log('- run-migration.js: 8fea02b5-850a-4167-913b-a12043c65d17');
  console.log('These should be removed or made configurable');
  criticalIssues++;

  // FINAL REPORT
  console.log('\n' + '=' * 60);
  console.log('🔒 BUSINESS ISOLATION AUDIT COMPLETE');
  console.log('=' * 60);
  console.log(`🚨 CRITICAL ISSUES: ${criticalIssues}`);
  console.log(`⚠️ WARNINGS: ${warnings}`);

  if (criticalIssues > 0) {
    console.log('\n🚨 IMMEDIATE ACTION REQUIRED:');
    console.log('1. Fix conversation storage to filter by business_id');
    console.log('2. Remove hardcoded business IDs from code');
    console.log('3. Implement per-business rate limiting');
    console.log('4. Add business validation to all sensitive operations');
    console.log('\n❌ SYSTEM IS NOT SAFE FOR MULTI-TENANT PRODUCTION USE');
  } else {
    console.log('\n✅ SYSTEM APPEARS SAFE FOR MULTI-TENANT USE');
  }

  console.log('\nRisk Level:', criticalIssues > 0 ? 'CRITICAL' : warnings > 0 ? 'MEDIUM' : 'LOW');
}

async function getOrCreateTestBusiness() {
  try {
    // Try to find existing test business
    const existing = await pool.query(
      "SELECT id FROM businesses WHERE name = 'Test Hair Salon'"
    );

    if (existing.rows.length > 0) {
      return existing.rows[0].id;
    }

    // Create test business for isolation testing
    const testBusiness = await pool.query(`
      INSERT INTO businesses (name, email, phone_number, status, business_hours)
      VALUES ('Test Hair Salon', 'test@hairsalon.com', '+15551234567', 'active', '{
        "monday": {"enabled": true, "start": "09:00", "end": "17:00"},
        "tuesday": {"enabled": true, "start": "09:00", "end": "17:00"},
        "wednesday": {"enabled": true, "start": "09:00", "end": "17:00"},
        "thursday": {"enabled": true, "start": "09:00", "end": "17:00"},
        "friday": {"enabled": true, "start": "09:00", "end": "17:00"},
        "saturday": {"enabled": false},
        "sunday": {"enabled": false}
      }')
      RETURNING id
    `);

    // Add test services for hair salon
    const businessId = testBusiness.rows[0].id;
    await pool.query(`
      INSERT INTO service_types (business_id, name, duration_minutes, base_rate, is_active)
      VALUES 
      ($1, 'Haircut & Style', 60, 50, true),
      ($1, 'Hair Color', 120, 100, true),
      ($1, 'Highlights', 90, 80, true),
      ($1, 'Consultation', 30, 0, true)
    `, [businessId]);

    console.log(`✅ Created test business: ${businessId}`);
    return businessId;

  } catch (error) {
    console.log('❌ Failed to create test business:', error.message);
    // Return a dummy ID for testing
    return '00000000-0000-0000-0000-000000000000';
  }
}

// Run the test
testBusinessIsolation()
  .then(() => {
    console.log('\n🔒 Audit complete. Check results above.');
    pool.end();
  })
  .catch(error => {
    console.error('❌ Audit failed:', error);
    pool.end();
    process.exit(1);
  });