require('dotenv').config();
const twilio = require('twilio');
const { Pool } = require('pg');

async function cleanupTomGaragePhones() {
  const twilioClient = twilio(process.env.TWILIO_SID, process.env.TWILIO_TOKEN);
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  
  try {
    console.log('🧹 Cleaning up Tom\'s Garage duplicate phone numbers...\n');
    
    // Get what's currently in the database for Tom's Garage
    const dbResult = await pool.query(
      'SELECT phone_number, twilio_phone_sid FROM businesses WHERE id = $1',
      ['8fea02b5-850a-4167-913b-a12043c65d17']
    );
    
    if (dbResult.rows.length === 0) {
      console.log('❌ Tom\'s Garage not found in database');
      return;
    }
    
    const dbPhone = dbResult.rows[0].phone_number;
    const dbTwilioSid = dbResult.rows[0].twilio_phone_sid;
    
    console.log(`📋 Database shows:`);
    console.log(`   Phone: ${dbPhone}`);
    console.log(`   Twilio SID: ${dbTwilioSid}\n`);
    
    // Get all Tom's Garage numbers from Twilio
    const allNumbers = await twilioClient.incomingPhoneNumbers.list();
    const tomNumbers = allNumbers.filter(num => 
      (num.friendlyName && num.friendlyName.includes("Tom's Garage")) ||
      (num.voiceUrl && num.voiceUrl.includes('8fea02b5-850a-4167-913b-a12043c65d17'))
    );
    
    console.log(`🔍 Found ${tomNumbers.length} Tom's Garage numbers in Twilio:`);
    tomNumbers.forEach((num, index) => {
      const isInDb = num.sid === dbTwilioSid;
      console.log(`${index + 1}. ${num.phoneNumber} (${num.sid}) ${isInDb ? '✅ IN DATABASE' : '❌ DUPLICATE'}`);
      console.log(`   Created: ${num.dateCreated}`);
    });
    
    // Find numbers to release (not in database)
    const numbersToRelease = tomNumbers.filter(num => num.sid !== dbTwilioSid);
    
    console.log(`\n🗑️  Numbers to release: ${numbersToRelease.length}`);
    
    if (numbersToRelease.length === 0) {
      console.log('✅ No duplicate numbers to clean up!');
      return;
    }
    
    // Confirm cleanup
    console.log('\n⚠️  About to release these phone numbers:');
    numbersToRelease.forEach((num, index) => {
      console.log(`${index + 1}. ${num.phoneNumber} (${num.sid})`);
    });
    
    console.log('\n🔧 Starting cleanup...');
    
    let releasedCount = 0;
    let failedReleases = [];
    
    for (const number of numbersToRelease) {
      try {
        console.log(`🗑️  Releasing ${number.phoneNumber} (${number.sid})...`);
        await twilioClient.incomingPhoneNumbers(number.sid).remove();
        console.log(`   ✅ Released successfully`);
        releasedCount++;
      } catch (error) {
        console.log(`   ❌ Failed to release: ${error.message}`);
        failedReleases.push({ number: number.phoneNumber, sid: number.sid, error: error.message });
      }
    }
    
    console.log(`\n📊 CLEANUP SUMMARY:`);
    console.log(`✅ Successfully released: ${releasedCount} numbers`);
    console.log(`❌ Failed to release: ${failedReleases.length} numbers`);
    console.log(`🎯 Kept in service: ${dbPhone} (${dbTwilioSid})`);
    
    if (failedReleases.length > 0) {
      console.log(`\n⚠️  Failed releases:`);
      failedReleases.forEach((failure, index) => {
        console.log(`${index + 1}. ${failure.number} (${failure.sid}): ${failure.error}`);
      });
    }
    
    // Verify final state
    console.log(`\n🔍 Verifying final state...`);
    const finalNumbers = await twilioClient.incomingPhoneNumbers.list();
    const finalTomNumbers = finalNumbers.filter(num => 
      (num.friendlyName && num.friendlyName.includes("Tom's Garage")) ||
      (num.voiceUrl && num.voiceUrl.includes('8fea02b5-850a-4167-913b-a12043c65d17'))
    );
    
    console.log(`📱 Tom's Garage now has ${finalTomNumbers.length} phone number(s):`);
    finalTomNumbers.forEach((num, index) => {
      console.log(`${index + 1}. ${num.phoneNumber} (${num.sid})`);
    });
    
    if (finalTomNumbers.length === 1) {
      console.log(`\n🎉 SUCCESS: Tom's Garage now has exactly 1 phone number as expected!`);
    } else {
      console.log(`\n⚠️  Tom's Garage still has ${finalTomNumbers.length} phone numbers. Manual intervention may be needed.`);
    }
    
  } catch (error) {
    console.error('❌ Cleanup error:', error);
  } finally {
    await pool.end();
  }
}

// Run the cleanup - ONLY if you want to actually perform the cleanup
// Comment out the line below if you just want to test/analyze
cleanupTomGaragePhones();