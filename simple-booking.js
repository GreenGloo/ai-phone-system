// SIMPLE REDESIGNED BOOKING SYSTEM
// This replaces the complex AI logic with a straightforward approach

require('dotenv').config();
const express = require('express');
const twilio = require('twilio');
const { Pool } = require('pg');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const twilioClient = twilio(process.env.TWILIO_SID, process.env.TWILIO_TOKEN);

// Simple conversation state management
const callStates = new Map(); // callSid -> state

// Conversation states
const STATES = {
  GREETING: 'greeting',
  GET_SERVICE: 'get_service', 
  GET_NAME: 'get_name',
  GET_PHONE: 'get_phone',
  GET_TIME: 'get_time',
  CONFIRM: 'confirm',
  COMPLETE: 'complete'
};

// Simple voice processing endpoint
async function processSimpleVoice(req, res) {
  const { CallSid, SpeechResult, From } = req.body;
  const businessId = req.params.businessId;
  
  try {
    console.log(`📞 Call ${CallSid}: "${SpeechResult}"`);
    
    // Get or create call state
    let state = callStates.get(CallSid) || {
      stage: STATES.GREETING,
      business: null,
      service: null,
      customerName: null,
      customerPhone: From,
      appointmentTime: null,
      attempts: 0
    };
    
    // Get business info
    if (!state.business) {
      const businessResult = await pool.query(
        'SELECT * FROM businesses WHERE id = $1',
        [businessId]
      );
      
      if (businessResult.rows.length === 0) {
        const twiml = new twilio.twiml.VoiceResponse();
        twiml.say('Sorry, this business is not available.');
        return res.type('text/xml').send(twiml.toString());
      }
      
      state.business = businessResult.rows[0];
    }
    
    const twiml = new twilio.twiml.VoiceResponse();
    let nextStage = state.stage;
    
    // Get personality-based responses
    const responses = getPersonalityResponses(state.business.ai_personality || 'professional');
    
    // Process based on current stage
    switch (state.stage) {
      case STATES.GREETING:
        // First interaction - ask what they need
        twiml.say(responses.greeting.replace('{businessName}', state.business.name));
        nextStage = STATES.GET_SERVICE;
        break;
        
      case STATES.GET_SERVICE:
        // They described their service need
        state.service = SpeechResult;
        twiml.say(responses.serviceConfirm);
        nextStage = STATES.GET_NAME;
        break;
        
      case STATES.GET_NAME:
        // Extract name
        state.customerName = extractName(SpeechResult);
        twiml.say(responses.getName.replace('{customerName}', state.customerName));
        nextStage = STATES.GET_TIME;
        break;
        
      case STATES.GET_TIME:
        // Parse time preference using AI
        try {
          const timeInfo = await parseTimePreference(SpeechResult, state.business.timezone || 'America/New_York', state.business);
          state.appointmentTime = timeInfo;
          
          console.log(`⏰ Customer said: "${SpeechResult}"`);
          console.log(`⏰ Parsed time: ${timeInfo.description}`);
          console.log(`⏰ Actual date/time: ${timeInfo.date}`);
          
          if (timeInfo.success) {
            twiml.say(responses.timeConfirm.replace('{timeDescription}', timeInfo.description));
            nextStage = STATES.CONFIRM;
          } else {
            twiml.say(responses.timeError);
            // Stay in GET_TIME stage
          }
        } catch (error) {
          console.error('Time parsing error:', error);
          twiml.say('I\'m having trouble understanding the time. Could you say it differently?');
          // Stay in GET_TIME stage
        }
        break;
        
      case STATES.CONFIRM:
        // Check for confirmation
        const confirmation = SpeechResult.toLowerCase();
        console.log(`✅ Customer confirmation: "${SpeechResult}"`);
        
        if (confirmation.includes('yes') || confirmation.includes('yeah') || confirmation.includes('correct') || confirmation.includes('right')) {
          // Book the appointment
          const bookingResult = await bookSimpleAppointment(state, businessId);
          
          if (bookingResult.success) {
            twiml.say(responses.bookingSuccess
              .replace('{timeDescription}', bookingResult.timeDescription)
              .replace('{businessName}', state.business.name));
            nextStage = STATES.COMPLETE;
          } else {
            twiml.say(responses.bookingError);
          }
          twiml.hangup();
          callStates.delete(CallSid); // Clean up
        } else if (confirmation.includes('no') || confirmation.includes('different') || confirmation.includes('change')) {
          twiml.say(responses.timeChange);
          nextStage = STATES.GET_TIME;
        } else {
          twiml.say(responses.confirmationError);
          // Stay in CONFIRM stage
        }
        break;
        
      default:
        twiml.say('Thank you for calling. Goodbye!');
        twiml.hangup();
        callStates.delete(CallSid);
        break;
    }
    
    // Update state and continue conversation (unless hanging up)
    if (nextStage !== STATES.COMPLETE) {
      state.stage = nextStage;
      state.attempts++;
      callStates.set(CallSid, state);
      
      // Add gather for next input
      twiml.gather({
        input: 'speech',
        timeout: 10,
        speechTimeout: 'auto',
        action: `/voice/simple/${businessId}`,
        method: 'POST'
      });
      
      // Fallback only if gather times out
      twiml.say('I didn\'t hear you. Let me have someone call you back.');
      twiml.hangup();
    }
    
    res.type('text/xml').send(twiml.toString());
    
  } catch (error) {
    console.error('Simple booking error:', error);
    const twiml = new twilio.twiml.VoiceResponse();
    twiml.say('Sorry, there was a technical issue. Please try calling back.');
    twiml.hangup();
    res.type('text/xml').send(twiml.toString());
  }
}

// Simple name extraction
function extractName(speech) {
  const words = speech.toLowerCase().split(' ');
  
  // Look for "my name is X" or "I'm X" patterns
  if (speech.includes('my name is')) {
    return speech.split('my name is')[1].trim().split(' ')[0];
  }
  if (speech.includes("I'm ")) {
    return speech.split("I'm ")[1].trim().split(' ')[0];
  }
  
  // Just take first word if it seems like a name
  const firstWord = words[0];
  if (firstWord && firstWord.length > 2) {
    return firstWord.charAt(0).toUpperCase() + firstWord.slice(1);
  }
  
  return 'Customer'; // Fallback
}

// AI-powered time parsing using OpenAI with personality context
async function parseTimePreference(speech, businessTimezone = 'America/New_York', businessData = {}) {
  console.log(`🤖 AI parsing time from: "${speech}"`);
  
  try {
    const now = new Date();
    const currentDateTime = now.toLocaleString('en-US', {
      timeZone: businessTimezone,
      weekday: 'long',
      year: 'numeric',
      month: 'long', 
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true
    });

    const personality = businessData.ai_personality || 'professional';
    const businessType = businessData.business_type || 'service business';

    const prompt = `You are a smart appointment scheduler for a ${businessType} business with a ${personality} personality. Parse the customer's time preference and return a specific date and time.

Current date/time: ${currentDateTime} (${businessTimezone})

Customer said: "${speech}"

Return a JSON object with:
{
  "date": "YYYY-MM-DD", 
  "time": "HH:MM",
  "period": "AM" or "PM",
  "description": "human readable description like 'tomorrow at 2:00 PM'"
}

Examples:
- "tomorrow at 3" → {"date": "2025-06-13", "time": "15:00", "period": "PM", "description": "tomorrow at 3:00 PM"}
- "next Monday morning" → {"date": "2025-06-16", "time": "09:00", "period": "AM", "description": "Monday at 9:00 AM"}
- "this coming Wednesday around lunchtime" → {"date": "2025-06-18", "time": "12:00", "period": "PM", "description": "Wednesday at 12:00 PM"}

Be intelligent about:
- "morning" = 9 AM, "afternoon" = 2 PM, "evening" = 6 PM, "lunchtime" = 12 PM
- "next week" means the following week, not this week
- If no time specified, default to 2 PM
- If no day specified, default to tomorrow
- Consider business type context (e.g., dental appointments might prefer morning slots)`;

    const response = await openai.chat.completions.create({
      model: 'gpt-3.5-turbo',
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 200,
      temperature: 0.1
    });

    const aiResponse = response.choices[0].message.content.trim();
    console.log(`🤖 AI response: ${aiResponse}`);
    
    const parsed = JSON.parse(aiResponse);
    
    // Create the actual Date object
    const appointmentDate = new Date(`${parsed.date}T${parsed.time}:00`);
    
    console.log(`🎯 AI parsed result: ${parsed.description}`);
    console.log(`📅 Appointment date: ${appointmentDate.toString()}`);
    
    return {
      success: true,
      date: appointmentDate,
      description: parsed.description
    };
    
  } catch (error) {
    console.error('❌ AI parsing failed, falling back to simple parsing:', error);
    
    // Fallback to simple time parsing if AI fails
    return parseTimePreferenceSimple(speech, businessTimezone);
  }
}

// Fallback simple parser for when AI fails
function parseTimePreferenceSimple(speech, businessTimezone = 'America/New_York') {
  const lower = speech.toLowerCase().replace(/[.,]/g, '');
  const now = new Date();
  
  // Simple fallback - just try to find a time and default to tomorrow
  let hour = 14; // Default 2 PM
  
  if (lower.includes('morning') || lower.includes('am')) {
    hour = 9;
  } else if (lower.includes('evening')) {
    hour = 18;
  }
  
  // Look for numbers
  const numberMatch = lower.match(/(\d{1,2})/);
  if (numberMatch) {
    const num = parseInt(numberMatch[1]);
    if (num >= 1 && num <= 12) {
      hour = lower.includes('pm') || lower.includes('afternoon') || lower.includes('evening') ? 
            (num === 12 ? 12 : num + 12) : 
            (num === 12 ? 0 : num);
    }
  }
  
  const targetDate = new Date(now);
  targetDate.setDate(targetDate.getDate() + 1); // Default to tomorrow
  targetDate.setHours(hour, 0, 0, 0);
  
  return {
    success: true,
    date: targetDate,
    description: `tomorrow at ${targetDate.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })}`
  };
}

function getNextWeekday(date, targetDay, forceNextWeek = false) {
  const currentDay = date.getDay();
  let daysUntilTarget = (targetDay - currentDay + 7) % 7;
  
  if (forceNextWeek) {
    // Always go to next week
    daysUntilTarget = daysUntilTarget === 0 ? 7 : daysUntilTarget + 7;
  } else {
    // Regular logic - if today is the target day, go to next week
    daysUntilTarget = daysUntilTarget === 0 ? 7 : daysUntilTarget;
  }
  
  const targetDate = new Date(date);
  targetDate.setDate(date.getDate() + daysUntilTarget);
  return targetDate;
}

// Simple appointment booking
async function bookSimpleAppointment(state, businessId) {
  try {
    // Get first available service type
    const serviceResult = await pool.query(
      'SELECT id, name, duration_minutes, base_rate FROM service_types WHERE business_id = $1 AND is_active = true LIMIT 1',
      [businessId]
    );
    
    if (serviceResult.rows.length === 0) {
      throw new Error('No services available');
    }
    
    const service = serviceResult.rows[0];
    
    // Validate appointment time
    if (!state.appointmentTime || !state.appointmentTime.date) {
      console.error('❌ Invalid appointment time:', state.appointmentTime);
      throw new Error('Invalid appointment time data');
    }
    
    const appointmentTime = state.appointmentTime.date;
    if (!(appointmentTime instanceof Date) || isNaN(appointmentTime.getTime())) {
      console.error('❌ Invalid date object:', appointmentTime);
      throw new Error('Invalid appointment date');
    }
    
    const endTime = new Date(appointmentTime.getTime() + service.duration_minutes * 60000);
    
    console.log(`📅 BOOKING DETAILS:`);
    console.log(`📅 Customer requested: "${state.service}"`);
    console.log(`📅 Scheduled start: ${appointmentTime.toISOString()}`);
    console.log(`📅 Scheduled end: ${endTime.toISOString()}`);
    console.log(`📅 Business timezone: ${state.business.timezone || 'America/New_York'}`);
    console.log(`📅 Local time: ${appointmentTime.toLocaleString('en-US', { timeZone: state.business.timezone || 'America/New_York' })}`);
    console.log(`📅 Description: ${state.appointmentTime.description}`);
    
    // Insert appointment
    const result = await pool.query(
      `INSERT INTO appointments (
        business_id, customer_name, customer_phone, service_type_id, service_name,
        issue_description, start_time, end_time, duration_minutes, estimated_revenue,
        booking_source, status
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
      RETURNING id, start_time`,
      [
        businessId,
        state.customerName,
        state.customerPhone,
        service.id,
        service.name,
        state.service,
        appointmentTime.toISOString(),
        endTime.toISOString(),
        service.duration_minutes,
        service.base_rate,
        'simple_ai_phone',
        'scheduled'
      ]
    );
    
    console.log('✅ Simple booking successful:', result.rows[0].id);
    
    // Send SMS notification to business owner
    await sendOwnerNotification(state, businessId, service, result.rows[0]);
    
    return {
      success: true,
      appointmentId: result.rows[0].id,
      timeDescription: state.appointmentTime.description
    };
    
  } catch (error) {
    console.error('Simple booking failed:', error);
    return { success: false, error: error.message };
  }
}

// Send SMS notification to business owner
async function sendOwnerNotification(state, businessId, service, appointment) {
  try {
    // Get business owner phone from users table
    const ownerResult = await pool.query(
      `SELECT u.phone, u.first_name, u.last_name, b.name as business_name, b.phone_number 
       FROM businesses b 
       JOIN users u ON b.user_id = u.id 
       WHERE b.id = $1`,
      [businessId]
    );
    
    if (ownerResult.rows.length === 0) {
      console.log('No owner found for SMS notification');
      return;
    }
    
    const owner = ownerResult.rows[0];
    const appointmentTime = new Date(appointment.start_time).toLocaleString('en-US', {
      weekday: 'long',
      month: 'long',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
      timeZone: 'America/New_York'
    });
    
    // Create calendar link (we'll implement this endpoint next)
    const calendarLink = `https://nodejs-production-5e30.up.railway.app/calendar/${businessId}`;
    
    const message = `📅 NEW APPOINTMENT BOOKED!

${owner.business_name}
👤 Customer: ${state.customerName}
📞 Phone: ${state.customerPhone}
🔧 Service: ${service.name}
⏰ Time: ${appointmentTime}
💰 Value: $${service.base_rate}

📋 Issue: ${state.service}

📅 View Calendar: ${calendarLink}

🎉 Booked via CallCatcher AI`;

    // Send SMS to owner
    if (owner.phone && owner.phone_number) {
      await twilioClient.messages.create({
        body: message,
        from: owner.phone_number, // Use business phone number as sender
        to: owner.phone
      });
      
      console.log(`📱 SMS sent to owner: ${owner.first_name} ${owner.last_name}`);
    }
    
    // Also send confirmation to customer
    const customerMessage = `✅ APPOINTMENT CONFIRMED

${owner.business_name}
📅 ${appointmentTime}
🔧 ${service.name}

We'll call if running late!
Questions? Call ${owner.phone_number}`;

    await twilioClient.messages.create({
      body: customerMessage,
      from: owner.phone_number,
      to: state.customerPhone
    });
    
    console.log(`📱 Confirmation sent to customer: ${state.customerName}`);
    
  } catch (error) {
    console.error('SMS notification error:', error);
    // Don't fail the booking if SMS fails
  }
}

// Get personality-specific responses
function getPersonalityResponses(personality) {
  const responses = {
    professional: {
      greeting: 'Hello, you\'ve reached {businessName}. How may I assist you with scheduling an appointment today?',
      serviceConfirm: 'Thank you. I can certainly help you with that. May I have your name please?',
      getName: 'Thank you, {customerName}. What day and time would work best for your appointment?',
      timeConfirm: 'Perfect. I can schedule you for {timeDescription}. Would that time work for you?',
      timeError: 'I apologize, I didn\'t catch the time. Could you please specify a day like Monday, Tuesday, or tomorrow?',
      bookingSuccess: 'Excellent. Your appointment is confirmed for {timeDescription}. You\'ll receive a text confirmation shortly. Thank you for choosing {businessName}.',
      bookingError: 'I apologize, there was an issue scheduling your appointment. Let me have someone call you back to assist you.',
      timeChange: 'Of course. What day and time would work better for you?',
      confirmationError: 'I didn\'t catch that. Could you please say yes to confirm, or let me know if you\'d like a different time?'
    },
    friendly: {
      greeting: 'Hi there! You\'ve reached {businessName}. I\'d love to help you schedule an appointment! What service are you looking for?',
      serviceConfirm: 'Awesome! I can totally help you with that. What\'s your name?',
      getName: 'Great to meet you, {customerName}! What day and time works best for you?',
      timeConfirm: 'Perfect! I can book you for {timeDescription}. Does that sound good?',
      timeError: 'Oops, I didn\'t catch that time. Could you tell me again? Like Monday, Tuesday, or maybe tomorrow?',
      bookingSuccess: 'Fantastic! You\'re all set for {timeDescription}. You\'ll get a text confirmation in just a minute. Thanks so much for calling {businessName}!',
      bookingError: 'Oh no! Something went wrong with booking. Don\'t worry though - I\'ll have someone call you back to get this sorted out!',
      timeChange: 'No worries at all! What time would work better for you?',
      confirmationError: 'Sorry, I didn\'t catch that. Just say yes if that time works, or let me know what would be better!'
    },
    urgent: {
      greeting: 'Hello, {businessName}. What service do you need scheduled?',
      serviceConfirm: 'Got it. Your name?',
      getName: 'Alright {customerName}, what day and time?',
      timeConfirm: 'I can book {timeDescription}. Confirm?',
      timeError: 'Need a specific time. Monday, Tuesday, tomorrow?',
      bookingSuccess: 'Confirmed. {timeDescription}. Text coming. Thank you.',
      bookingError: 'Booking failed. Someone will call you back.',
      timeChange: 'Different time then?',
      confirmationError: 'Yes or no? Or tell me a different time.'
    }
  };
  
  return responses[personality] || responses.professional;
}

module.exports = { processSimpleVoice };