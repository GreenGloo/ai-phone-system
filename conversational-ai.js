// CONVERSATIONAL AI BOOKING SYSTEM
// Acts like a real person, not a rigid bot

require('dotenv').config();
const twilio = require('twilio');
const { Pool } = require('pg');
const OpenAI = require('openai');

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const twilioClient = twilio(process.env.TWILIO_SID, process.env.TWILIO_TOKEN);

// Simple conversation memory
const conversations = new Map();

async function handleVoiceCall(req, res) {
  const { CallSid, SpeechResult, From } = req.body;
  const businessId = req.params.businessId;
  
  try {
    console.log(`💬 CONVERSATION: Call ${CallSid}: "${SpeechResult || 'INITIAL'}"`);
    
    // Get business info
    const businessResult = await pool.query('SELECT * FROM businesses WHERE id = $1', [businessId]);
    if (businessResult.rows.length === 0) {
      return sendTwiml(res, 'Sorry, this business is not available.');
    }
    
    const business = businessResult.rows[0];
    
    // Handle initial call
    if (!SpeechResult) {
      return handleInitialCall(res, business, CallSid, From, businessId);
    }
    
    // Have a natural conversation
    return await holdConversation(res, business, CallSid, From, SpeechResult, businessId);
    
  } catch (error) {
    console.error(`🚨 Conversation error:`, error);
    return sendTwiml(res, 'Sorry, I\'m having trouble hearing you. Could you try calling back?');
  }
}

function handleInitialCall(res, business, callSid, from, businessId) {
  // Start conversation memory
  conversations.set(callSid, {
    business: business,
    customerPhone: from,
    conversationHistory: [],
    customerInfo: {},
    startTime: new Date()
  });
  
  const twiml = new twilio.twiml.VoiceResponse();
  twiml.say(`Hi! You've reached ${business.name}. How can I help you today?`);
  
  twiml.gather({
    input: 'speech',
    timeout: 15,
    speechTimeout: 'auto',
    action: `/voice/incoming/${businessId}`,
    method: 'POST'
  });
  
  twiml.say('I didn\'t hear you clearly. Please try calling back.');
  twiml.hangup();
  
  return res.type('text/xml').send(twiml.toString());
}

async function holdConversation(res, business, callSid, from, speech, businessId) {
  const conversation = conversations.get(callSid) || {
    business: business,
    customerPhone: from,
    conversationHistory: [],
    customerInfo: {},
    startTime: new Date()
  };
  
  // Add to conversation history
  conversation.conversationHistory.push({
    speaker: 'customer',
    message: speech,
    timestamp: new Date()
  });
  
  console.log(`🗣️ Conversation history: ${conversation.conversationHistory.length} messages`);
  
  // Get services for context
  const servicesResult = await pool.query(
    'SELECT id, name, duration_minutes, base_rate FROM service_types WHERE business_id = $1 AND is_active = true',
    [businessId]
  );
  const services = servicesResult.rows;
  
  // Have AI respond naturally
  const aiResponse = await getConversationalResponse(speech, conversation, business, services);
  
  // Add AI response to history
  conversation.conversationHistory.push({
    speaker: 'assistant',
    message: aiResponse.response,
    timestamp: new Date(),
    action: aiResponse.action,
    data: aiResponse.data
  });
  
  conversations.set(callSid, conversation);
  
  const twiml = new twilio.twiml.VoiceResponse();
  let shouldContinue = true;
  
  // Handle the AI's decision
  if (aiResponse.action === 'book_appointment' && aiResponse.data) {
    // AI has all the info needed - book it!
    const booking = await bookAppointment(conversation, businessId, services[0], aiResponse.data);
    if (booking.success) {
      twiml.say(`Perfect! ${aiResponse.response}`);
      shouldContinue = false;
      conversations.delete(callSid);
    } else {
      twiml.say('I\'m having trouble with the booking system. Let me try a different time.');
    }
  } else {
    // Continue conversation
    twiml.say(aiResponse.response);
  }
  
  if (shouldContinue) {
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

async function getConversationalResponse(speech, conversation, business, services) {
  const serviceList = services.map(s => `- ${s.name} (${s.duration_minutes} min, $${s.base_rate})`).join('\n');
  const history = conversation.conversationHistory.slice(-6).map(h => 
    `${h.speaker}: ${h.message}`
  ).join('\n');
  
  const prompt = `You are a friendly, professional receptionist for ${business.name}, a ${business.business_type} business. You have a natural conversation with customers to book appointments.

BUSINESS INFO:
${serviceList}

CONVERSATION SO FAR:
${history}
customer: ${speech}

PERSONALITY: Be natural, conversational, and helpful. Don't sound robotic. Talk like a real person would.

YOUR GOALS:
1. Understand what service they need
2. Find out when they want to come in  
3. Check availability and suggest times
4. Book the appointment when they confirm

IMPORTANT: You can check availability for any time. If they want "tomorrow afternoon", you can suggest "I have 2:30 PM available tomorrow, does that work?"

Be smart about understanding:
- "tomorrow afternoon" = suggest specific afternoon time
- "earlier" = suggest today or early tomorrow  
- "broken windshield wipers" = car repair service
- "yes" or "that works" = book the appointment

Respond with JSON:
{
  "response": "what you say to the customer (natural, conversational)",
  "action": "continue" | "book_appointment",
  "data": {
    "service": "service name if determined",
    "timePreference": "time preference if mentioned",  
    "suggestedTime": "specific time to suggest",
    "customerName": "name if given"
  }
}

EXAMPLES:
Customer: "my windshield wipers are broken, can I come in tomorrow afternoon?"
Response: "I can definitely help with windshield wipers! I have 2:30 PM available tomorrow afternoon. Would that work for you?"

Customer: "yes that works"  
Response: "Perfect! I'll book you for windshield wiper repair tomorrow at 2:30 PM"
Action: "book_appointment"`;

  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4",
      messages: [{ role: "user", content: prompt }],
      temperature: 0.7,
      max_tokens: 300
    });
    
    const response = JSON.parse(completion.choices[0].message.content);
    console.log(`🤖 AI: "${response.response}" | Action: ${response.action}`);
    return response;
    
  } catch (error) {
    console.error('AI Error:', error);
    return {
      response: 'I\'d be happy to help you. What can I do for you today?',
      action: 'continue',
      data: {}
    };
  }
}

async function bookAppointment(conversation, businessId, service, data) {
  try {
    // For now, book for tomorrow at 2 PM (we'll make this smarter)
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(14, 30, 0, 0);
    
    const endTime = new Date(tomorrow.getTime() + 60 * 60000);
    
    const result = await pool.query(`
      INSERT INTO appointments (
        business_id, customer_name, customer_phone, service_type_id, service_name,
        issue_description, start_time, end_time, duration_minutes, estimated_revenue,
        booking_source, status
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
      RETURNING id
    `, [
      businessId,
      data.customerName || 'Customer',
      conversation.customerPhone,
      service.id,
      service.name,
      data.service || 'Phone booking',
      tomorrow.toISOString(),
      endTime.toISOString(),
      60,
      service.base_rate,
      'conversational_ai',
      'scheduled'
    ]);
    
    console.log(`✅ Appointment booked: ${result.rows[0].id}`);
    return { success: true, appointmentId: result.rows[0].id };
    
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