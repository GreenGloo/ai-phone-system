// SMART AI BOOKING SYSTEM - REWRITTEN FROM SCRATCH
// No more bullshit - this actually works

require('dotenv').config();
const twilio = require('twilio');
const { Pool } = require('pg');
const OpenAI = require('openai');

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const twilioClient = twilio(process.env.TWILIO_SID, process.env.TWILIO_TOKEN);

// Simple call state storage
const activeStates = new Map();

async function handleVoiceCall(req, res) {
  const { CallSid, SpeechResult, From } = req.body;
  const businessId = req.params.businessId;
  
  try {
    console.log(`🚀 SMART BOOKING: Call ${CallSid}: "${SpeechResult || 'INITIAL'}" for business ${businessId}`);
    console.log(`📋 Full request body:`, req.body);
    
    // Get business info
    const businessResult = await pool.query('SELECT * FROM businesses WHERE id = $1', [businessId]);
    if (businessResult.rows.length === 0) {
      console.log(`❌ Business not found: ${businessId}`);
      return sendTwiml(res, 'Sorry, this business is not available.');
    }
    
    const business = businessResult.rows[0];
    console.log(`✅ Business found: ${business.name}`);
    
    // Handle initial call (no speech yet)
    if (!SpeechResult) {
      return handleInitialCall(res, business, CallSid, From, businessId);
    }
    
    // Process speech with AI
    return await processWithAI(res, business, CallSid, From, SpeechResult, businessId);
    
  } catch (error) {
    console.error(`🚨 Call error:`, error);
    return sendTwiml(res, 'Sorry, there was a technical issue. Please try calling back.');
  }
}

function handleInitialCall(res, business, callSid, from, businessId) {
  // Initialize state
  activeStates.set(callSid, {
    stage: 'greeting',
    business: business,
    customerPhone: from,
    attempts: 0
  });
  
  const twiml = new twilio.twiml.VoiceResponse();
  twiml.say(`Hello, you've reached ${business.name}. How can I help you today?`);
  
  twiml.gather({
    input: 'speech',
    timeout: 15,
    speechTimeout: 'auto',
    action: `/voice/incoming/${businessId}`,
    method: 'POST'
  });
  
  twiml.say('I didn\'t hear you. Please try calling back.');
  twiml.hangup();
  
  return res.type('text/xml').send(twiml.toString());
}

async function processWithAI(res, business, callSid, from, speech, businessId) {
  const state = activeStates.get(callSid) || {
    stage: 'greeting',
    business: business,
    customerPhone: from,
    attempts: 0
  };
  
  console.log(`🤖 AI Processing: "${speech}" | Stage: ${state.stage}`);
  
  // Get available services
  const servicesResult = await pool.query(
    'SELECT id, name, duration_minutes, base_rate FROM service_types WHERE business_id = $1 AND is_active = true',
    [businessId]
  );
  const services = servicesResult.rows;
  
  // Use AI to understand what the customer wants
  const aiResponse = await getAIResponse(speech, state, business, services);
  
  const twiml = new twilio.twiml.VoiceResponse();
  let shouldContinue = true;
  
  switch (aiResponse.action) {
    case 'get_info':
      twiml.say(aiResponse.response);
      state.stage = 'gathering_info';
      break;
      
    case 'suggest_time':
      // AI suggests an available time
      const availableTime = await findAvailableTime(businessId, aiResponse.timePreference);
      if (availableTime) {
        state.suggestedTime = availableTime;
        state.stage = 'confirming_time';
        twiml.say(`I have ${availableTime.description} available. Does that work for you?`);
      } else {
        twiml.say('I don\'t have any availability then. What other time would work for you?');
        state.stage = 'gathering_info';
      }
      break;
      
    case 'book_appointment':
      // Customer confirmed - book it
      const booking = await bookAppointment(state, businessId, services[0]);
      if (booking.success) {
        twiml.say(`Perfect! Your appointment is confirmed for ${booking.timeDescription}. We'll see you then!`);
        shouldContinue = false;
        activeStates.delete(callSid);
      } else {
        twiml.say('There was an issue booking. Let me try a different time.');
        state.stage = 'gathering_info';
      }
      break;
      
    default:
      twiml.say('Let me understand what you need. What service are you looking for?');
      state.stage = 'gathering_info';
  }
  
  if (shouldContinue) {
    activeStates.set(callSid, state);
    
    twiml.gather({
      input: 'speech',
      timeout: 15,
      speechTimeout: 'auto',
      action: `/voice/incoming/${businessId}`,
      method: 'POST'
    });
    
    twiml.say('I didn\'t hear you. Let me have someone call you back.');
    twiml.hangup();
  }
  
  return res.type('text/xml').send(twiml.toString());
}

async function getAIResponse(speech, state, business, services) {
  const serviceList = services.map(s => `- ${s.name}`).join('\n');
  
  const prompt = `You are a smart AI assistant for ${business.name}, a ${business.business_type} business.

Current conversation stage: ${state.stage}
Customer said: "${speech}"
Previous context: ${JSON.stringify(state)}

Available services:
${serviceList}

SMART RULES:
1. If customer mentions ANY time preference (tomorrow, afternoon, morning, specific time): action = "suggest_time" immediately
2. If customer confirms/agrees (yes, sure, that works, sounds good): action = "book_appointment"
3. Only use "get_info" if you truly need more information

EXAMPLES:
- "tomorrow afternoon" → action: "suggest_time", timePreference: "afternoon"
- "windshield wipers broken" + time mentioned → action: "suggest_time"  
- "sure" or "that works" → action: "book_appointment"

BE SMART: Don't ask for more info if you have enough to book an appointment.

Respond with JSON:
{
  "action": "get_info" | "suggest_time" | "book_appointment",
  "response": "what to say to customer",
  "timePreference": "morning|afternoon|evening|specific time if mentioned",
  "customerName": "extracted name if mentioned"
}`;

  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4",
      messages: [{ role: "user", content: prompt }],
      temperature: 0.1,
      max_tokens: 200
    });
    
    const response = JSON.parse(completion.choices[0].message.content);
    console.log(`🤖 AI Response:`, response);
    return response;
    
  } catch (error) {
    console.error('AI Error:', error);
    return {
      action: 'suggest_time',
      response: 'I can help you with that. Let me find an available time.',
      timePreference: 'afternoon'
    };
  }
}

async function findAvailableTime(businessId, timePreference) {
  console.log(`🔍 Finding available time for: ${timePreference}`);
  
  const today = new Date();
  const tomorrow = new Date(today.getTime() + 24 * 60 * 60 * 1000);
  
  // Define time ranges based on preference
  let timeRanges = [];
  
  switch (timePreference) {
    case 'morning':
      timeRanges = [8, 9, 10, 11];
      break;
    case 'afternoon':
      timeRanges = [12, 13, 14, 15, 16];
      break;
    case 'evening':
      timeRanges = [17, 18];
      break;
    default:
      timeRanges = [9, 10, 11, 12, 13, 14, 15, 16, 17];
  }
  
  // Check tomorrow first (most common request)
  for (const hour of timeRanges) {
    const checkTime = new Date(tomorrow);
    checkTime.setHours(hour, 0, 0, 0);
    
    if (await isTimeAvailable(businessId, checkTime)) {
      return {
        startTime: checkTime,
        description: checkTime.toLocaleTimeString('en-US', { 
          weekday: 'long',
          hour: 'numeric', 
          minute: '2-digit', 
          hour12: true 
        })
      };
    }
  }
  
  return null;
}

async function isTimeAvailable(businessId, startTime) {
  const endTime = new Date(startTime.getTime() + 60 * 60000); // 1 hour appointment
  
  try {
    const conflicts = await pool.query(`
      SELECT id FROM appointments 
      WHERE business_id = $1 
        AND status IN ('scheduled', 'confirmed', 'in_progress')
        AND (
          (start_time <= $2 AND end_time > $2) OR
          (start_time < $3 AND end_time >= $3) OR
          (start_time >= $2 AND end_time <= $3)
        )
    `, [businessId, startTime.toISOString(), endTime.toISOString()]);
    
    return conflicts.rows.length === 0;
  } catch (error) {
    console.error('Availability check error:', error);
    return false;
  }
}

async function bookAppointment(state, businessId, service) {
  try {
    if (!state.suggestedTime) {
      throw new Error('No time selected');
    }
    
    const startTime = state.suggestedTime.startTime;
    const endTime = new Date(startTime.getTime() + 60 * 60000);
    
    const result = await pool.query(`
      INSERT INTO appointments (
        business_id, customer_name, customer_phone, service_type_id, service_name,
        issue_description, start_time, end_time, duration_minutes, estimated_revenue,
        booking_source, status
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
      RETURNING id
    `, [
      businessId,
      state.customerName || 'Customer',
      state.customerPhone,
      service.id,
      service.name,
      'Phone booking',
      startTime.toISOString(),
      endTime.toISOString(),
      60,
      service.base_rate,
      'ai_phone',
      'scheduled'
    ]);
    
    console.log(`✅ Appointment booked: ${result.rows[0].id}`);
    
    return {
      success: true,
      appointmentId: result.rows[0].id,
      timeDescription: state.suggestedTime.description
    };
    
  } catch (error) {
    console.error('Booking error:', error);
    return { success: false, error: error.message };
  }
}

function sendTwiml(res, message) {
  const twiml = new twilio.twiml.VoiceResponse();
  twiml.say(message);
  twiml.hangup();
  return res.type('text/xml').send(twiml.toString());
}

module.exports = { handleVoiceCall };