// Test different voice formats to see what Twilio actually supports
const twilio = require('twilio');

// Test different voice formats that might work
const testVoices = [
  'matthew',           // Simple name
  'Matthew',           // Capitalized 
  'Polly.matthew',     // Lowercase
  'Polly.Matthew',     // Our current format
  'Amazon.Matthew',    // Alternative provider prefix
  'man',              // Generic male voice
  'male',             // Generic male voice
  'alice',            // Known working voice
  'Polly.Joanna',     // Known working voice
];

console.log('🎤 Testing different voice formats for Twilio TTS...\n');

testVoices.forEach((voice, index) => {
  console.log(`Test ${index + 1}: "${voice}"`);
  
  try {
    const twiml = new twilio.twiml.VoiceResponse();
    
    // Try the voice with explicit settings
    twiml.say({
      voice: voice,
      language: 'en-US',
      rate: '1.0'
    }, `Testing voice ${voice}. This is a test message to verify voice quality.`);
    
    const twimlString = twiml.toString();
    console.log(`   TwiML: ${twimlString}`);
    console.log('   ✅ Voice format accepted by TwiML\n');
    
  } catch (error) {
    console.log(`   ❌ Voice format rejected: ${error.message}\n`);
  }
});

console.log('🧪 To test these voices:');
console.log('1. Replace the voice in getVoiceSettings() with each format');
console.log('2. Make a test call');  
console.log('3. See which one produces a male voice');
console.log('\nNote: Twilio may accept the format but still use default voice if unsupported.');