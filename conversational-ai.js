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

CONVERSATION RULES:
1. Be natural and conversational - like a real person
2. NEVER ask "what can I help you with" or "what do you need" - you already know they want an appointment
3. If they mention a date (like "July", "July 28th", "tomorrow"), offer available times for that date
4. If they mention a service, offer times for that service
5. If they just say a month/date without service, ask what service they need AND show available times
6. Keep responses short and human - max 2 sentences
7. Always move the conversation forward toward booking
8. If confused, offer specific available times instead of asking open questions

Available services: ${context.services.join(', ')}
Available times for requested date: ${context.availableTimes}

EXAMPLES:
Customer says "July" → "What service do you need for July? I have morning slots at 8 AM, 9:30 AM and afternoon slots at 1 PM, 2:30 PM available."
Customer says "game delivery" → "Perfect! I can schedule that. I have morning slots at 8 AM, 9:30 AM and afternoon slots at 1 PM, 2:30 PM. Which works better?"
Customer says "tomorrow at 2" → Book it immediately

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
      message: "Let me help you book an appointment. I have morning and afternoon slots available.",
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
        // If it's a month request (like "July"), get the whole month
        if (requestedDate.includes('-01')) {
          const endOfMonth = new Date(targetDate);
          endOfMonth.setMonth(endOfMonth.getMonth() + 1);
          dateFilter = `AND slot_start >= '${targetDate.toISOString()}' AND slot_start < '${endOfMonth.toISOString()}'`;
        } else {
          // Specific date
          dateFilter = `AND DATE(slot_start) = DATE('${targetDate.toISOString()}')`;
        }
      }
    } else {
      // Default: next 13 months (400+ days)
      const next13Months = new Date();
      next13Months.setMonth(next13Months.getMonth() + 13);
      dateFilter = `AND slot_start BETWEEN NOW() AND '${next13Months.toISOString()}'`;
    }
    
    const result = await pool.query(`
      SELECT slot_start 
      FROM calendar_slots 
      WHERE business_id = $1 
      AND is_available = true 
      ${dateFilter}
      ORDER BY slot_start 
      LIMIT 100
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
      const greeting = `Hi there! Thanks for calling ${business.name}. I'm here to help you schedule an appointment. What service do you need?`;
      // For initial call, no conversation object yet
      return sendResponse(res, greeting, business.ai_voice_id, true, businessId, null);
    }
    
    // Get conversation context
    let conversation = conversations.get(CallSid) || {
      customerName: null,
      previousContext: '',
      requestedService: null,
      voiceId: business.ai_voice_id, // Preserve voice consistency
      voiceMode: null // Track whether we're using ElevenLabs or Twilio
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
      try {
        await bookAppointment(businessId, conversation.customerName, From, aiResponse.data.service, aiResponse.data.time);
        return sendResponse(res, cleanMessage, conversation.voiceId, false, businessId, conversation); // End call
      } catch (bookingError) {
        console.error('Booking failed:', bookingError);
        const errorMsg = `I'm sorry, I couldn't book that appointment. ${bookingError.message.includes('No available slots') ? 'That date is not available.' : 'There was a technical issue.'} Let me have someone call you back to help.`;
        return sendResponse(res, errorMsg, conversation.voiceId, false, businessId, conversation);
      }
    }
    
    // Continue conversation
    return sendResponse(res, cleanMessage, conversation.voiceId, true, businessId, conversation);
    
  } catch (error) {
    console.error('Conversation error:', error);
    return sendResponse(res, "I'm having some technical difficulties. Let me have someone call you back.", null, false, businessId, null);
  }
}

// Extract date from speech
function extractDateFromSpeech(speech) {
  const months = ['january', 'february', 'march', 'april', 'may', 'june', 
                  'july', 'august', 'september', 'october', 'november', 'december'];
  
  for (const month of months) {
    if (speech.toLowerCase().includes(month)) {
      // Try to extract full date first
      const dateMatch = speech.match(new RegExp(`${month}\\s+(\\d{1,2})`, 'i'));
      if (dateMatch) {
        const day = dateMatch[1];
        const year = new Date().getFullYear();
        return `${month} ${day}, ${year}`;
      } else {
        // Just month mentioned - return first day of that month
        const year = new Date().getFullYear();
        const monthIndex = months.indexOf(month.toLowerCase());
        const targetDate = new Date(year, monthIndex, 1);
        
        // If the month is in the past this year, use next year
        if (targetDate < new Date()) {
          targetDate.setFullYear(year + 1);
        }
        
        return targetDate.toISOString().split('T')[0]; // Return YYYY-MM-DD format
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
    
    // Parse the time string to find matching slot
    console.log(`📅 Booking appointment for timeString: "${timeString}"`);
    
    // Extract date components from timeString
    let targetDate = null;
    
    // Try to parse "January 2" or "Jan 2" format
    const monthDayMatch = timeString.match(/(january|february|march|april|may|june|july|august|september|october|november|december)\s+(\d{1,2})/i);
    if (monthDayMatch) {
      const monthName = monthDayMatch[1].toLowerCase();
      const day = parseInt(monthDayMatch[2]);
      const months = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
      const monthIndex = months.indexOf(monthName);
      
      // Determine year - if month is in past, use next year
      let year = new Date().getFullYear();
      const testDate = new Date(year, monthIndex, day);
      if (testDate < new Date()) {
        year++;
      }
      
      targetDate = new Date(year, monthIndex, day);
      console.log(`📅 Parsed date: ${targetDate.toDateString()}`);
    }
    
    // Find slots for the target date
    let slotsQuery = `
      SELECT slot_start 
      FROM calendar_slots 
      WHERE business_id = $1 AND is_available = true
    `;
    let queryParams = [businessId];
    
    if (targetDate) {
      // Get slots for specific date
      const startOfDay = new Date(targetDate);
      startOfDay.setHours(0, 0, 0, 0);
      const endOfDay = new Date(targetDate);
      endOfDay.setHours(23, 59, 59, 999);
      
      slotsQuery += ` AND slot_start >= $2 AND slot_start <= $3`;
      queryParams.push(startOfDay.toISOString(), endOfDay.toISOString());
    }
    
    slotsQuery += ` ORDER BY slot_start LIMIT 50`;
    
    const slotsResult = await pool.query(slotsQuery, queryParams);
    console.log(`📅 Found ${slotsResult.rows.length} available slots`);
    
    if (slotsResult.rows.length === 0) {
      throw new Error(`No available slots found for ${targetDate ? targetDate.toDateString() : 'requested time'}`);
    }
    
    // Use first available slot for the requested date
    const appointmentTime = new Date(slotsResult.rows[0].slot_start);
    console.log(`📅 Selected appointment time: ${appointmentTime.toLocaleString()}`);
    
    // Mark slot as unavailable
    await pool.query(`
      UPDATE calendar_slots 
      SET is_available = false 
      WHERE business_id = $1 AND slot_start = $2
    `, [businessId, appointmentTime.toISOString()]);
    
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
async function sendResponse(res, message, voiceId = null, continueCall = true, businessId = null, conversation = null) {
  const twiml = new twilio.twiml.VoiceResponse();
  
  console.log(`🎤 Voice Response - Voice: ${voiceId}, Mode: ${conversation?.voiceMode || 'unset'}, Message: "${message.substring(0, 50)}..."`);
  
  // If we already determined voice mode for this conversation, stick with it
  if (conversation?.voiceMode === 'twilio') {
    console.log(`🔒 Sticking with Twilio voice for consistency`);
    twiml.say(message, { voice: voiceId || 'Polly.Matthew' });
  } else if (conversation?.voiceMode === 'elevenlabs') {
    console.log(`🔒 Sticking with ElevenLabs for consistency`);
    try {
      const audioResult = await generateElevenLabsAudio(message, voiceId || 'matthew');
      if (audioResult.success) {
        twiml.play(audioResult.url);
      } else {
        // If ElevenLabs fails after we committed to it, fallback but warn
        console.log(`⚠️ ElevenLabs failed mid-conversation - emergency fallback to Twilio`);
        twiml.say(message, { voice: voiceId || 'Polly.Matthew' });
      }
    } catch (error) {
      console.log(`❌ ElevenLabs error mid-conversation - emergency fallback: ${error.message}`);
      twiml.say(message, { voice: voiceId || 'Polly.Matthew' });
    }
  } else {
    // First response - try ElevenLabs and remember what worked
    if (process.env.ELEVENLABS_API_KEY) {
      try {
        const audioResult = await generateElevenLabsAudio(message, voiceId || 'matthew');
        if (audioResult.success) {
          console.log(`✅ ElevenLabs success - setting voice mode to elevenlabs`);
          if (conversation) conversation.voiceMode = 'elevenlabs';
          twiml.play(audioResult.url);
        } else {
          console.log(`⚠️ ElevenLabs failed - setting voice mode to twilio`);
          if (conversation) conversation.voiceMode = 'twilio';
          twiml.say(message, { voice: voiceId || 'Polly.Matthew' });
        }
      } catch (error) {
        console.log(`❌ ElevenLabs error - setting voice mode to twilio: ${error.message}`);
        if (conversation) conversation.voiceMode = 'twilio';
        twiml.say(message, { voice: voiceId || 'Polly.Matthew' });
      }
    } else {
      console.log(`🔄 Using Twilio voice - setting voice mode to twilio`);
      if (conversation) conversation.voiceMode = 'twilio';
      twiml.say(message, { voice: voiceId || 'Polly.Matthew' });
    }
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