require('dotenv').config();
const express = require('express');
const twilio = require('twilio');
const OpenAI = require('openai');
const cors = require('cors');

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cors());

// Initialize services
const twilioClient = twilio(process.env.TWILIO_SID, process.env.TWILIO_TOKEN);
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// In-memory storage (replace with database later)
const callLogs = new Map();
const businesses = new Map();

// Default business configuration
const defaultBusinessConfig = {
  businessName: "Professional Services",
  ownerName: "Business Owner",
  ownerPhone: process.env.OWNER_PHONE || "+15551234567",
  businessHours: { start: "08:00", end: "18:00" },
  emergencyRate: "$150/hour",
  regularRate: "$100/hour",
  services: ["Emergency Repairs", "Regular Service", "Consultations", "Estimates"],
  personality: "friendly but professional"
};

// AI Prompt for receptionist
const createAIPrompt = (businessConfig) => `
You are a professional receptionist for ${businessConfig.businessName}.

CRITICAL INSTRUCTIONS:
- Sound completely human and professional
- NEVER mention you're an AI unless directly asked
- Keep conversations natural and flowing
- Your job is to help customers and book appointments

BUSINESS INFO:
- Services: ${businessConfig.services.join(", ")}
- Hours: ${businessConfig.businessHours.start} to ${businessConfig.businessHours.end}
- Emergency rate: ${businessConfig.emergencyRate}
- Regular rate: ${businessConfig.regularRate}

CALL HANDLING:
1. Greet warmly: "Hello, ${businessConfig.businessName}, this is Sarah. How can I help you today?"
2. Determine if emergency or regular service
3. For emergencies: Quote emergency rate, find next available slot, book immediately
4. For regular: Schedule during business hours, explain services
5. Always get: Name, phone, address, brief description of issue
6. Confirm all details before ending call

EMERGENCY CRITERIA:
- Urgent repairs needed
- No heat/cooling in extreme weather
- Water damage/flooding
- Safety concerns
- Anything causing business disruption

If you can't help, say you'll have ${businessConfig.ownerName} call them back within 30 minutes.

Stay in character as Sarah, the helpful receptionist. Be warm, efficient, and professional.
`;

// Handle incoming calls
app.post('/voice/incoming', async (req, res) => {
  console.log('Incoming call:', req.body);
  
  const { CallSid, From, To } = req.body;
  const businessId = To;
  
  const business = businesses.get(businessId) || defaultBusinessConfig;
  
  // Log the call
  const callLog = {
    id: CallSid,
    from: From,
    to: To,
    startTime: new Date(),
    status: 'in-progress',
    businessId,
    conversation: []
  };
  callLogs.set(CallSid, callLog);

  // Create TwiML response
  const twiml = new twilio.twiml.VoiceResponse();
  
  // Initial greeting
  const greeting = `Hello, ${business.businessName}, this is Sarah. How can I help you today?`;
  
  // Use Twilio's built-in text-to-speech for now
  twiml.say({
    voice: 'Polly.Joanna',
    language: 'en-US'
  }, greeting);
  
  // Gather customer input
  const gather = twiml.gather({
    input: 'speech',
    timeout: 5,
    speechTimeout: 'auto',
    action: '/voice/process',
    method: 'POST'
  });
  
  // If no input, redirect to voicemail
  twiml.say('I didn\'t hear anything. Let me transfer you to voicemail.');
  twiml.record({
    action: '/voice/voicemail',
    maxLength: 60,
    playBeep: true
  });

  res.type('text/xml').send(twiml.toString());
});

// Process customer speech
app.post('/voice/process', async (req, res) => {
  const { CallSid, SpeechResult } = req.body;
  const callLog = callLogs.get(CallSid);
  
  console.log(`Customer said: ${SpeechResult}`);
  
  if (!callLog) {
    return res.status(404).send('Call not found');
  }
  
  // Add customer message to conversation
  callLog.conversation.push({ role: 'user', content: SpeechResult });
  
  try {
    // Get business config
    const business = businesses.get(callLog.businessId) || defaultBusinessConfig;
    
    // Generate AI response
    const aiResponse = await openai.chat.completions.create({
      model: "gpt-4",
      messages: [
        { role: 'system', content: createAIPrompt(business) },
        ...callLog.conversation
      ],
      max_tokens: 150,
      temperature: 0.7
    });
    
    const responseText = aiResponse.choices[0].message.content;
    callLog.conversation.push({ role: 'assistant', content: responseText });
    
    console.log(`AI response: ${responseText}`);
    
    // Create TwiML response
    const twiml = new twilio.twiml.VoiceResponse();
    
    twiml.say({
      voice: 'Polly.Joanna',
      language: 'en-US'
    }, responseText);
    
    // Continue gathering input
    const gather = twiml.gather({
      input: 'speech',
      timeout: 5,
      speechTimeout: 'auto',
      action: '/voice/process',
      method: 'POST'
    });
    
    // Extract booking information
    await extractBookingInfo(SpeechResult, responseText, CallSid);
    
    res.type('text/xml').send(twiml.toString());
    
  } catch (error) {
    console.error('Error processing speech:', error);
    
    const twiml = new twilio.twiml.VoiceResponse();
    twiml.say('I\'m sorry, I\'m having trouble right now. Let me have someone call you back.');
    twiml.hangup();
    
    res.type('text/xml').send(twiml.toString());
  }
});

// Handle voicemail
app.post('/voice/voicemail', async (req, res) => {
  const { CallSid, RecordingUrl } = req.body;
  
  console.log(`Voicemail received: ${RecordingUrl}`);
  
  // Send notification to business owner
  await sendOwnerNotification({
    id: CallSid,
    type: 'voicemail',
    recordingUrl: RecordingUrl,
    from: req.body.From
  });
  
  const twiml = new twilio.twiml.VoiceResponse();
  twiml.say('Thank you for your message. Someone will call you back soon. Goodbye!');
  twiml.hangup();
  
  res.type('text/xml').send(twiml.toString());
});

// Extract booking information
async function extractBookingInfo(customerInput, aiResponse, callSid) {
  try {
    const extractionPrompt = `
    Extract booking information from this conversation:
    Customer: "${customerInput}"
    AI: "${aiResponse}"
    
    Return JSON with:
    {
      "customerName": "name if mentioned",
      "phoneNumber": "phone if mentioned", 
      "serviceType": "emergency or regular",
      "issueDescription": "brief description",
      "appointmentBooked": true/false,
      "appointmentTime": "time if scheduled",
      "urgencyLevel": "low/medium/high"
    }
    `;
    
    const extraction = await openai.chat.completions.create({
      model: "gpt-3.5-turbo",
      messages: [{ role: 'user', content: extractionPrompt }],
      max_tokens: 200
    });
    
    const bookingInfo = JSON.parse(extraction.choices[0].message.content);
    
    // Update call log
    const callLog = callLogs.get(callSid);
    if (callLog) {
      callLog.bookingInfo = bookingInfo;
      callLog.lastUpdate = new Date();
      
      // Send SMS if appointment booked
      if (bookingInfo.appointmentBooked) {
        await sendOwnerNotification(callLog);
      }
    }
    
  } catch (error) {
    console.error('Booking extraction error:', error);
  }
}

// Send SMS notification
async function sendOwnerNotification(callLog) {
  try {
    const business = businesses.get(callLog.businessId) || defaultBusinessConfig;
    
    let message;
    
    if (callLog.type === 'voicemail') {
      message = `📞 NEW VOICEMAIL
      
From: ${callLog.from}
Recording: ${callLog.recordingUrl}
Time: ${new Date().toLocaleString()}

Check your voicemail system for details.`;
    } else {
      const booking = callLog.bookingInfo || {};
      message = `🔧 NEW APPOINTMENT BOOKED

Customer: ${booking.customerName || 'Name not provided'}
Phone: ${callLog.from}
Service: ${booking.serviceType} - ${booking.issueDescription}
Time: ${booking.appointmentTime}
Urgency: ${booking.urgencyLevel}

Call ID: ${callLog.id}`;
    }

    await twilioClient.messages.create({
      body: message,
      from: process.env.TWILIO_PHONE_NUMBER,
      to: business.ownerPhone
    });
    
    console.log('Owner notification sent');
  } catch (error) {
    console.error('SMS notification error:', error);
  }
}

// API Endpoints for dashboard

// Get call logs
app.get('/api/calls', (req, res) => {
  const calls = Array.from(callLogs.values())
    .sort((a, b) => b.startTime - a.startTime)
    .slice(0, 50); // Last 50 calls
  
  res.json(calls);
});

// Get business settings
app.get('/api/business/settings', (req, res) => {
  res.json(defaultBusinessConfig);
});

// Update business settings
app.post('/api/business/settings', (req, res) => {
  // In production, save to database
  Object.assign(defaultBusinessConfig, req.body);
  res.json({ success: true });
});

// Health check
app.get('/health', (req, res) => {
  res.json({ 
    status: 'healthy',
    activeCalls: callLogs.size,
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'production'
  });
});

// Root endpoint
app.get('/', (req, res) => {
  res.json({
    message: 'AI Phone System is running!',
    status: 'active',
    endpoints: {
      incoming: '/voice/incoming',
      health: '/health',
      calls: '/api/calls'
    }
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 AI Phone System running on port ${PORT}`);
  console.log(`📞 Webhook URL: https://your-domain.railway.app/voice/incoming`);
});
