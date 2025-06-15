require('dotenv').config();
const twilio = require('twilio');
const { Pool } = require('pg');

async function cleanupTomGarageComprehensive() {
  const twilioClient = twilio(process.env.TWILIO_SID, process.env.TWILIO_TOKEN);
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  
  const TOM_GARAGE_ID = '8fea02b5-850a-4167-913b-a12043c65d17';
  const CORRECT_PHONE_NUMBER = '+18285768205'; // The number to keep
  const CORRECT_TWILIO_SID = 'PN8ebb4a06026f510879323d5feea7dda3'; // SID for the number to keep
  
  try {
    console.log('🧹 COMPREHENSIVE CLEANUP: Tom\'s Garage Phone Numbers\n');
    console.log('='.repeat(60));
    
    // ===== STEP 1: DATABASE INVESTIGATION =====
    console.log('\n📊 STEP 1: DATABASE INVESTIGATION');
    console.log('-'.repeat(40));
    
    const dbResult = await pool.query(
      'SELECT id, name, phone_number, twilio_phone_sid, created_at, updated_at FROM businesses WHERE id = $1',
      [TOM_GARAGE_ID]
    );
    
    if (dbResult.rows.length === 0) {
      console.log('❌ Tom\'s Garage not found in database');
      return;
    }
    
    const business = dbResult.rows[0];
    console.log('Current database record:');
    console.log(`  Name: ${business.name}`);
    console.log(`  Phone: ${business.phone_number}`);
    console.log(`  Twilio SID: ${business.twilio_phone_sid}`);
    console.log(`  Created: ${business.created_at}`);
    console.log(`  Updated: ${business.updated_at}`);
    
    // ===== STEP 2: TWILIO INVESTIGATION =====
    console.log('\n📞 STEP 2: TWILIO INVESTIGATION');
    console.log('-'.repeat(40));
    
    const allNumbers = await twilioClient.incomingPhoneNumbers.list();
    const tomNumbers = allNumbers.filter(num => 
      (num.friendlyName && num.friendlyName.includes("Tom's Garage")) ||
      (num.voiceUrl && num.voiceUrl.includes(TOM_GARAGE_ID))
    );
    
    console.log(`Found ${tomNumbers.length} Tom's Garage numbers in Twilio:`);
    tomNumbers.forEach((num, index) => {
      const isCorrect = num.phoneNumber === CORRECT_PHONE_NUMBER;
      const isInDB = num.sid === business.twilio_phone_sid;
      console.log(`${index + 1}. ${num.phoneNumber} (${num.sid})`);
      console.log(`   Created: ${num.dateCreated}`);
      console.log(`   Status: ${isCorrect ? '✅ KEEP THIS ONE' : '❌ DUPLICATE'} ${isInDB ? '(Currently in DB)' : ''}`);
      console.log(`   Voice URL: ${num.voiceUrl}`);
    });
    
    // ===== STEP 3: IDENTIFY NUMBERS TO RELEASE =====
    console.log('\n🗑️  STEP 3: NUMBERS TO RELEASE');
    console.log('-'.repeat(40));
    
    const numbersToRelease = tomNumbers.filter(num => num.phoneNumber !== CORRECT_PHONE_NUMBER);
    
    console.log(`Numbers to release: ${numbersToRelease.length}`);
    numbersToRelease.forEach((num, index) => {
      console.log(`${index + 1}. ${num.phoneNumber} (${num.sid}) - Created: ${num.dateCreated}`);
    });
    
    if (numbersToRelease.length === 0) {
      console.log('✅ No numbers to release - cleanup already complete!');
      return;
    }
    
    // ===== STEP 4: UPDATE DATABASE =====
    console.log('\n💾 STEP 4: UPDATE DATABASE');
    console.log('-'.repeat(40));
    
    const needsDatabaseUpdate = business.phone_number !== CORRECT_PHONE_NUMBER || 
                               business.twilio_phone_sid !== CORRECT_TWILIO_SID;
    
    if (needsDatabaseUpdate) {
      console.log(`Updating database from ${business.phone_number} to ${CORRECT_PHONE_NUMBER}`);
      
      const updateResult = await pool.query(
        'UPDATE businesses SET phone_number = $1, twilio_phone_sid = $2, updated_at = CURRENT_TIMESTAMP WHERE id = $3 RETURNING *',
        [CORRECT_PHONE_NUMBER, CORRECT_TWILIO_SID, TOM_GARAGE_ID]
      );
      
      console.log('✅ Database updated successfully');
      console.log(`   New phone: ${updateResult.rows[0].phone_number}`);
      console.log(`   New SID: ${updateResult.rows[0].twilio_phone_sid}`);
    } else {
      console.log('✅ Database already has correct phone number');
    }
    
    // ===== STEP 5: RELEASE DUPLICATE NUMBERS =====
    console.log('\n🗑️  STEP 5: RELEASE DUPLICATE NUMBERS');
    console.log('-'.repeat(40));
    
    console.log(`⚠️  About to release ${numbersToRelease.length} duplicate phone numbers:`);
    numbersToRelease.forEach((num, index) => {
      console.log(`   ${index + 1}. ${num.phoneNumber} (${num.sid})`);
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
        
        // Small delay to avoid API rate limits
        await new Promise(resolve => setTimeout(resolve, 500));
        
      } catch (error) {
        console.log(`   ❌ Failed to release: ${error.message}`);
        failedReleases.push({ 
          number: number.phoneNumber, 
          sid: number.sid, 
          error: error.message 
        });
      }
    }
    
    // ===== STEP 6: FINAL VERIFICATION =====
    console.log('\n🔍 STEP 6: FINAL VERIFICATION');
    console.log('-'.repeat(40));
    
    const finalNumbers = await twilioClient.incomingPhoneNumbers.list();
    const finalTomNumbers = finalNumbers.filter(num => 
      (num.friendlyName && num.friendlyName.includes("Tom's Garage")) ||
      (num.voiceUrl && num.voiceUrl.includes(TOM_GARAGE_ID))
    );
    
    console.log(`Tom's Garage now has ${finalTomNumbers.length} phone number(s):`);
    finalTomNumbers.forEach((num, index) => {
      console.log(`${index + 1}. ${num.phoneNumber} (${num.sid})`);
      console.log(`   Created: ${num.dateCreated}`);
      console.log(`   Voice URL: ${num.voiceUrl}`);
    });
    
    // ===== CLEANUP SUMMARY =====
    console.log('\n📊 CLEANUP SUMMARY');
    console.log('='.repeat(60));
    console.log(`✅ Successfully released: ${releasedCount} numbers`);
    console.log(`❌ Failed to release: ${failedReleases.length} numbers`);
    console.log(`🎯 Kept in service: ${CORRECT_PHONE_NUMBER} (${CORRECT_TWILIO_SID})`);
    console.log(`💾 Database updated: ${needsDatabaseUpdate ? 'Yes' : 'No'}`);
    
    if (failedReleases.length > 0) {
      console.log(`\n⚠️  FAILED RELEASES:`);
      failedReleases.forEach((failure, index) => {
        console.log(`${index + 1}. ${failure.number} (${failure.sid}): ${failure.error}`);
      });
    }
    
    if (finalTomNumbers.length === 1 && finalTomNumbers[0].phoneNumber === CORRECT_PHONE_NUMBER) {
      console.log(`\n🎉 SUCCESS: Tom's Garage cleanup complete!`);
      console.log(`✅ Exactly 1 phone number: ${CORRECT_PHONE_NUMBER}`);
      console.log(`✅ Database matches Twilio`);
      console.log(`✅ All duplicates removed`);
    } else {
      console.log(`\n⚠️  MANUAL REVIEW NEEDED:`);
      console.log(`Expected: 1 number (${CORRECT_PHONE_NUMBER})`);
      console.log(`Actual: ${finalTomNumbers.length} numbers`);
      if (finalTomNumbers.length > 0) {
        console.log(`Current numbers: ${finalTomNumbers.map(n => n.phoneNumber).join(', ')}`);
      }
    }
    
    // ===== NEXT STEPS =====
    console.log('\n📋 POST-CLEANUP TASKS');
    console.log('-'.repeat(40));
    console.log('1. ✅ Verify final phone number count: 1');
    console.log('2. ✅ Verify database has correct number');
    console.log('3. 🔍 Test incoming calls to verify functionality');
    console.log('4. 🔍 Check call logs for any disruption');
    console.log('5. 📞 Inform Tom\'s Garage of their correct number');
    
  } catch (error) {
    console.error('❌ CLEANUP ERROR:', error);
    console.error('Stack trace:', error.stack);
  } finally {
    await pool.end();
  }
}

// Run the comprehensive cleanup
console.log('🚀 Starting Tom\'s Garage phone number cleanup...\n');
cleanupTomGarageComprehensive();