require('dotenv').config();
const twilio = require('twilio');

const twilioClient = twilio(process.env.TWILIO_SID, process.env.TWILIO_TOKEN);

async function fixWebhook() {
  try {
    const phoneNumber = '+18445401735';
    const businessId = '9e075387-b066-4b70-ac33-6bce880f73df';
    const baseUrl = 'https://nodejs-production-5e30.up.railway.app';
    
    console.log('🔍 Finding phone number in Twilio...');
    
    // List all phone numbers
    const phoneNumbers = await twilioClient.incomingPhoneNumbers.list();
    console.log(`📞 Found ${phoneNumbers.length} phone numbers`);
    
    const targetNumber = phoneNumbers.find(num => num.phoneNumber === phoneNumber);
    
    if (!targetNumber) {
      console.error('❌ Phone number not found in Twilio');
      return;
    }
    
    console.log(`📞 Found phone number: ${targetNumber.phoneNumber}`);
    console.log(`🔗 Current webhook: ${targetNumber.voiceUrl}`);
    
    // Update the webhook URL
    const newVoiceUrl = `${baseUrl}/voice/incoming/${businessId}`;
    
    console.log(`🔧 Updating webhook to: ${newVoiceUrl}`);
    
    await twilioClient.incomingPhoneNumbers(targetNumber.sid).update({
      voiceUrl: newVoiceUrl,
      voiceMethod: 'POST'
    });
    
    console.log('✅ Webhook updated successfully!');
    
  } catch (error) {
    console.error('❌ Error:', error.message);
  }
}

fixWebhook();