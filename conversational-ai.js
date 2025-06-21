// HUMAN-FIRST CONVERSATIONAL AI
// Natural, flowing conversations that feel genuinely human

require('dotenv').config();
const twilio = require('twilio');
const { Pool } = require('pg');
const { generateElevenLabsAudio } = require('./elevenlabs-integration');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const twilioClient = twilio(process.env.TWILIO_SID, process.env.TWILIO_TOKEN);

// Core conversation state
const conversations = new Map();

// Simple, focused AI prompt
async function getAIResponse(context) {
  const axios = require('axios');
  
  const prompt = `You are a helpful booking assistant for ${context.businessName}.

Customer just said: "${context.customerMessage}"
Customer name: ${context.customerName || 'Not provided yet'}
Previous context: ${context.previousContext || 'First interaction'}

Your job:
1. Be natural and conversational - like a real person
2. If no name, ask for it naturally 
3. If they need a service, offer specific morning/afternoon times
4. If they confirm a time, book it
5. Keep responses short and human

Available services: ${context.services.join(', ')}
Available times: ${context.availableTimes}

Respond with JSON:
{
  "message": "Your natural response",
  "action": "continue" or "book",
  "data": {"customerName": "John", "service": "repair", "time": "Monday 9 AM"}
}`;

  try {
    const response = await axios.post('https://api.anthropic.com/v1/messages', {
      model: 'claude-3-5-sonnet-20241022',
      max_tokens: 150,
      temperature: 0.7,
      messages: [{ role: 'user', content: prompt }]
    }, {
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      timeout: 5000
    });
    
    const aiText = response.data.content[0].text;
    return JSON.parse(aiText);
  } catch (error) {
    console.error('AI Error:', error.message);
    return {
      message: "I'd be happy to help you schedule an appointment. What service do you need?",
      action: "continue",
      data: {}
    };
  }
}

// Get available times in simple format
async function getAvailableTimes(businessId, requestedDate = null) {
  try {
    let dateFilter = '';
    if (requestedDate) {
      // Handle specific date requests
      const targetDate = new Date(requestedDate);
      if (!isNaN(targetDate)) {
        dateFilter = `AND DATE(slot_start) = DATE('${targetDate.toISOString()}')`;
      }
    } else {
      // Default: next 7 days
      const nextWeek = new Date();
      nextWeek.setDate(nextWeek.getDate() + 7);
      dateFilter = `AND slot_start BETWEEN NOW() AND '${nextWeek.toISOString()}'`;
    }
    
    const result = await pool.query(`
      SELECT slot_start 
      FROM calendar_slots 
      WHERE business_id = $1 
      AND is_available = true 
      ${dateFilter}
      ORDER BY slot_start 
      LIMIT 20
    `, [businessId]);
    
    // Group by morning/afternoon
    const morning = [];
    const afternoon = [];
    
    result.rows.forEach(row => {
      const date = new Date(row.slot_start);
      const timeStr = date.toLocaleString('en-US', {
        weekday: 'long',
        month: 'short', 
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
        hour12: true,
        timeZone: 'America/New_York'
      });
      
      if (date.getHours() < 12) {
        if (morning.length < 2) morning.push(timeStr);
      } else {
        if (afternoon.length < 2) afternoon.push(timeStr);
      }
    });
    
    let timeString = '';
    if (morning.length > 0) {
      timeString += `Morning: ${morning.join(', ')}`;
    }
    if (afternoon.length > 0) {
      if (timeString) timeString += ' | ';
      timeString += `Afternoon: ${afternoon.join(', ')}`;
    }
    
    return timeString || 'No available times found';
    
  } catch (error) {
    console.error('Error getting times:', error);
    return 'Let me check our schedule and call you back';
  }
}

// Main conversation handler
async function handleConversation(req, res) {
  const { CallSid, SpeechResult, From } = req.body;
  const businessId = req.params.businessId;
  
  try {
    // Get business info
    const businessResult = await pool.query(
      'SELECT name, ai_voice_id FROM businesses WHERE id = $1',
      [businessId]
    );
    
    if (businessResult.rows.length === 0) {
      return sendResponse(res, "Sorry, this business is not available.");
    }
    
    const business = businessResult.rows[0];
    
    // Initial call - warm greeting
    if (!SpeechResult) {
      const greeting = `Hi there! Thanks for calling ${business.name}. I'm here to help you schedule an appointment. What can I do for you today?`;
      return sendResponse(res, greeting, business.ai_voice_id, true, businessId);
    }
    
    // Get conversation context
    let conversation = conversations.get(CallSid) || {
      customerName: null,
      previousContext: '',
      requestedService: null,
      voiceId: business.ai_voice_id // Preserve voice consistency
    };
    
    // Get services and times
    const [servicesResult, availableTimes] = await Promise.all([
      pool.query('SELECT name FROM service_types WHERE business_id = $1 AND is_active = true', [businessId]),
      getAvailableTimes(businessId, extractDateFromSpeech(SpeechResult))
    ]);
    
    const services = servicesResult.rows.map(r => r.name);
    
    // Prepare AI context
    const context = {
      businessName: business.name,
      customerMessage: SpeechResult,
      customerName: conversation.customerName,
      previousContext: conversation.previousContext,
      services: services,
      availableTimes: availableTimes
    };
    
    // Get AI response
    const aiResponse = await getAIResponse(context);
    
    // Clean response
    const cleanMessage = aiResponse.message
      .replace(/<[^>]*>/g, '')
      .replace(/\{[^}]*\}/g, '')
      .replace(/[\\\/]/g, '')
      .replace(/\b(json|xml|response)\b/gi, '')
      .trim();
    
    // Update conversation state
    if (aiResponse.data.customerName && !conversation.customerName) {
      conversation.customerName = aiResponse.data.customerName;
    }
    conversation.previousContext = `Customer said: "${SpeechResult}" | AI said: "${cleanMessage}"`;
    conversations.set(CallSid, conversation);
    
    // Handle booking
    if (aiResponse.action === 'book' && aiResponse.data.service && aiResponse.data.time) {
      await bookAppointment(businessId, conversation.customerName, From, aiResponse.data.service, aiResponse.data.time);
      return sendResponse(res, cleanMessage, conversation.voiceId, false, businessId); // End call
    }
    
    // Continue conversation
    return sendResponse(res, cleanMessage, conversation.voiceId, true, businessId);
    
  } catch (error) {
    console.error('Conversation error:', error);
    return sendResponse(res, "I'm having some technical difficulties. Let me have someone call you back.", null, false, businessId);
  }
}

// Extract date from speech
function extractDateFromSpeech(speech) {
  const months = ['january', 'february', 'march', 'april', 'may', 'june', 
                  'july', 'august', 'september', 'october', 'november', 'december'];
  
  for (const month of months) {
    if (speech.toLowerCase().includes(month)) {
      // Try to extract full date
      const dateMatch = speech.match(new RegExp(`${month}\\s+(\\d{1,2})`, 'i'));
      if (dateMatch) {
        const day = dateMatch[1];
        const year = new Date().getFullYear();
        return `${month} ${day}, ${year}`;
      }
    }
  }
  return null;
}

// Book appointment
async function bookAppointment(businessId, customerName, customerPhone, service, timeString) {
  try {
    // Find matching service
    const serviceResult = await pool.query(
      'SELECT id, duration_minutes FROM service_types WHERE business_id = $1 AND name ILIKE $2',
      [businessId, `%${service}%`]
    );
    
    if (serviceResult.rows.length === 0) {
      throw new Error('Service not found');
    }
    
    const serviceRecord = serviceResult.rows[0];
    
    // Parse time - look for specific time slot from available slots
    const slotsResult = await pool.query(`
      SELECT slot_start 
      FROM calendar_slots 
      WHERE business_id = $1 AND is_available = true
      ORDER BY slot_start 
      LIMIT 50
    `, [businessId]);
    
    // Find matching time slot (simplified matching)
    let appointmentTime = new Date();
    for (const slot of slotsResult.rows) {
      const slotDate = new Date(slot.slot_start);
      const slotStr = slotDate.toLocaleString('en-US', {
        weekday: 'long',
        month: 'short',
        day: 'numeric', 
        hour: 'numeric',
        minute: '2-digit',
        hour12: true
      });
      
      if (timeString.toLowerCase().includes(slotStr.toLowerCase().slice(0, 10))) {
        appointmentTime = slotDate;
        break;
      }
    }
    
    await pool.query(`
      INSERT INTO appointments (
        business_id, customer_name, customer_phone, service_type_id, 
        service_name, start_time, end_time, booking_source
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, 'conversational_ai')
    `, [
      businessId,
      customerName || 'Customer',
      customerPhone,
      serviceRecord.id,
      service,
      appointmentTime,
      new Date(appointmentTime.getTime() + (serviceRecord.duration_minutes * 60000)),
    ]);
    
    console.log(`✅ Appointment booked: ${service} for ${customerName}`);
    
  } catch (error) {
    console.error('Booking error:', error);
    throw error;
  }
}

// Send response with voice
async function sendResponse(res, message, voiceId = null, continueCall = true, businessId = null) {
  const twiml = new twilio.twiml.VoiceResponse();
  
  console.log(`🎤 Voice Response - Using voice: ${voiceId}, Message: "${message.substring(0, 50)}..."`);
  
  // Try ElevenLabs first, fallback to Twilio
  if (process.env.ELEVENLABS_API_KEY) {
    try {
      const audioResult = await generateElevenLabsAudio(message, voiceId || 'matthew');
      if (audioResult.success) {
        console.log(`✅ ElevenLabs success - using audio file`);
        twiml.play(audioResult.url);
      } else {
        console.log(`⚠️ ElevenLabs failed - fallback to Twilio voice: ${voiceId}`);
        twiml.say(message, { voice: voiceId || 'Polly.Matthew' });
      }
    } catch (error) {
      console.log(`❌ ElevenLabs error - fallback to Twilio voice: ${voiceId}, Error: ${error.message}`);
      twiml.say(message, { voice: voiceId || 'Polly.Matthew' });
    }
  } else {
    console.log(`🔄 Using Twilio voice directly: ${voiceId}`);
    twiml.say(message, { voice: voiceId || 'Polly.Matthew' });
  }
  
  if (continueCall) {
    const gather = twiml.gather({
      input: 'speech',
      timeout: 20,
      speechTimeout: 'auto',
      action: `/voice/incoming/${businessId}`,
      method: 'POST'
    });
    
    twiml.say("I'm having trouble hearing you. Could you please repeat that?");
  }
  
  twiml.hangup();
  return res.type('text/xml').send(twiml.toString());
}

// Cleanup old conversations periodically
setInterval(() => {
  const now = Date.now();
  for (const [callSid, conversation] of conversations.entries()) {
    if (now - (conversation.lastActivity || 0) > 30 * 60 * 1000) { // 30 minutes
      conversations.delete(callSid);
    }
  }
}, 10 * 60 * 1000); // Every 10 minutes

module.exports = {
  handleVoiceCall: handleConversation
};