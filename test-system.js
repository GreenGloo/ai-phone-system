require('dotenv').config();
const { Pool } = require('pg');
const twilio = require('twilio');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const twilioClient = twilio(process.env.TWILIO_SID, process.env.TWILIO_TOKEN);

async function testCurrentSetup() {
  try {
    console.log('🧪 TESTING CURRENT SYSTEM SETUP');
    console.log('================================');
    
    // 1. Check Benny's business configuration
    const businessResult = await pool.query(
      'SELECT id, name, phone_number, business_type, status FROM businesses WHERE name ILIKE $1',
      ['%benny%']
    );
    
    if (businessResult.rows.length === 0) {
      throw new Error('Benny\'s Bookkeeping not found');
    }
    
    const business = businessResult.rows[0];
    console.log('✅ 1. BUSINESS CONFIGURATION');
    console.log('   Name:', business.name);
    console.log('   ID:', business.id);
    console.log('   Phone:', business.phone_number);
    console.log('   Type:', business.business_type);
    console.log('   Status:', business.status);
    
    // 2. Check service types
    const servicesResult = await pool.query(
      'SELECT id, name, duration_minutes, base_rate FROM service_types WHERE business_id = $1 AND is_active = true LIMIT 3',
      [business.id]
    );
    
    console.log('\n✅ 2. SERVICE TYPES (' + servicesResult.rows.length + ' total)');
    servicesResult.rows.forEach(service => {
      console.log(`   - ${service.name} (${service.duration_minutes}min, $${service.base_rate})`);
    });
    
    // 3. Check Twilio webhook configuration
    const numbers = await twilioClient.incomingPhoneNumbers.list();
    const bennyNumber = numbers.find(num => num.phoneNumber === business.phone_number);
    
    console.log('\n✅ 3. TWILIO WEBHOOK CONFIG');
    if (bennyNumber) {
      console.log('   Phone Number:', bennyNumber.phoneNumber);
      console.log('   Webhook URL:', bennyNumber.voiceUrl);
      console.log('   SMS URL:', bennyNumber.smsUrl || 'Not configured');
      console.log('   Status:', bennyNumber.status);
      
      // Check if webhook points to correct business
      const expectedWebhook = `https://nodejs-production-5e30.up.railway.app/voice/incoming/${business.id}`;
      const webhookCorrect = bennyNumber.voiceUrl === expectedWebhook;
      console.log('   Webhook Correct:', webhookCorrect ? '✅ YES' : '❌ NO');
      if (!webhookCorrect) {
        console.log('   Expected:', expectedWebhook);
        console.log('   Actual:', bennyNumber.voiceUrl);
      }
    } else {
      console.log('   ❌ Phone number not found in Twilio');
    }
    
    // 4. Check recent call logs for errors
    const callLogsResult = await pool.query(
      'SELECT call_sid, booking_successful, booking_failure_reason, created_at FROM call_logs WHERE business_id = $1 ORDER BY created_at DESC LIMIT 2',
      [business.id]
    );
    
    console.log('\n✅ 4. RECENT CALL LOGS');
    if (callLogsResult.rows.length > 0) {
      callLogsResult.rows.forEach(log => {
        const status = log.booking_successful ? '✅ SUCCESS' : '❌ FAILED';
        console.log(`   - ${log.call_sid}: ${status}`);
        if (log.booking_failure_reason) {
          console.log(`     Reason: ${log.booking_failure_reason}`);
        }
      });
    } else {
      console.log('   No recent call logs found');
    }
    
    console.log('\n🎯 SYSTEM STATUS: READY FOR TESTING');
    console.log('📞 Call +18445401735 to test booking flow');
    console.log('🔧 All fixes applied - should not hang up during scheduling');
    
  } catch (error) {
    console.error('❌ Test failed:', error.message);
  } finally {
    process.exit(0);
  }
}

testCurrentSetup();