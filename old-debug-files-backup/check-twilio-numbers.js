require('dotenv').config();
const twilio = require('twilio');

async function checkAllTwilioNumbers() {
  const twilioClient = twilio(process.env.TWILIO_SID, process.env.TWILIO_TOKEN);
  
  try {
    console.log('🔍 Checking all Twilio phone numbers in account...\n');
    
    // Get all incoming phone numbers from Twilio
    const incomingNumbers = await twilioClient.incomingPhoneNumbers.list();
    
    console.log(`📱 Total phone numbers in Twilio account: ${incomingNumbers.length}\n`);
    
    // Group by friendly name to identify duplicates
    const numbersByFriendlyName = {};
    const tomGarageNumbers = [];
    
    incomingNumbers.forEach((number, index) => {
      console.log(`${index + 1}. Phone: ${number.phoneNumber}`);
      console.log(`   SID: ${number.sid}`);
      console.log(`   Friendly Name: ${number.friendlyName}`);
      console.log(`   Created: ${number.dateCreated}`);
      console.log(`   Voice URL: ${number.voiceUrl}`);
      console.log(`   SMS URL: ${number.smsUrl}\n`);
      
      // Track by friendly name
      if (!numbersByFriendlyName[number.friendlyName]) {
        numbersByFriendlyName[number.friendlyName] = [];
      }
      numbersByFriendlyName[number.friendlyName].push(number);
      
      // Check for Tom's Garage specifically
      if (number.friendlyName && number.friendlyName.toLowerCase().includes('tom') && number.friendlyName.toLowerCase().includes('garage')) {
        tomGarageNumbers.push(number);
      }
      
      // Also check by webhook URL pattern
      if (number.voiceUrl && number.voiceUrl.includes('8fea02b5-850a-4167-913b-a12043c65d17')) {
        tomGarageNumbers.push(number);
      }
    });
    
    console.log('📊 ANALYSIS:');
    console.log('=============');
    
    // Check for duplicates by friendly name
    console.log('\n🔍 Businesses with multiple phone numbers:');
    Object.entries(numbersByFriendlyName).forEach(([name, numbers]) => {
      if (numbers.length > 1) {
        console.log(`❗ ${name}: ${numbers.length} numbers`);
        numbers.forEach(num => {
          console.log(`   - ${num.phoneNumber} (${num.sid})`);
        });
      }
    });
    
    console.log(`\n🎯 Tom's Garage specific numbers: ${tomGarageNumbers.length}`);
    if (tomGarageNumbers.length > 0) {
      tomGarageNumbers.forEach((number, index) => {
        console.log(`${index + 1}. ${number.phoneNumber} (${number.sid})`);
        console.log(`   Name: ${number.friendlyName}`);
        console.log(`   Created: ${number.dateCreated}`);
        console.log(`   Voice URL: ${number.voiceUrl}`);
      });
    }
    
    // Remove duplicates from tomGarageNumbers based on SID
    const uniqueTomNumbers = tomGarageNumbers.filter((num, index, self) => 
      index === self.findIndex(n => n.sid === num.sid)
    );
    
    console.log(`\n📋 SUMMARY:`);
    console.log(`Total numbers in Twilio account: ${incomingNumbers.length}`);
    console.log(`Unique Tom's Garage numbers: ${uniqueTomNumbers.length}`);
    console.log(`Tom's Garage SIDs: ${uniqueTomNumbers.map(n => n.sid).join(', ')}`);
    
    if (uniqueTomNumbers.length > 1) {
      console.log('\n❌ ISSUE FOUND: Multiple phone numbers for Tom\'s Garage!');
      console.log('This explains why there are 5 phone numbers instead of 1.');
      
      console.log('\n🔧 Phone numbers that should be released:');
      uniqueTomNumbers.slice(1).forEach((number, index) => {
        console.log(`${index + 1}. ${number.phoneNumber} (${number.sid}) - SHOULD BE RELEASED`);
      });
      
      console.log(`\n✅ Phone number to keep: ${uniqueTomNumbers[0].phoneNumber} (${uniqueTomNumbers[0].sid})`);
    } else {
      console.log('\n✅ No duplicate phone numbers found for Tom\'s Garage in Twilio.');
    }
    
  } catch (error) {
    console.error('❌ Error checking Twilio numbers:', error);
  }
}

checkAllTwilioNumbers();