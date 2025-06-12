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
    
    // Process based on current stage
    switch (state.stage) {
      case STATES.GREETING:
        // First interaction - ask what they need
        twiml.say(`Hello, you've reached ${state.business.name}. What service do you need help with?`);
        nextStage = STATES.GET_SERVICE;
        break;
        
      case STATES.GET_SERVICE:
        // They described their service need
        state.service = SpeechResult;
        twiml.say('Perfect! I can help you with that. What\'s your name?');
        nextStage = STATES.GET_NAME;
        break;
        
      case STATES.GET_NAME:
        // Extract name
        state.customerName = extractName(SpeechResult);
        twiml.say(`Great ${state.customerName}! What day and time works best for you?`);
        nextStage = STATES.GET_TIME;
        break;
        
      case STATES.GET_TIME:
        // Parse time preference using business timezone
        const timeInfo = parseTimePreference(SpeechResult, state.business.timezone || 'America/New_York');
        state.appointmentTime = timeInfo;
        
        console.log(`⏰ Customer said: "${SpeechResult}"`);
        console.log(`⏰ Parsed time: ${timeInfo.description}`);
        console.log(`⏰ Actual date/time: ${timeInfo.date}`);
        
        if (timeInfo.success) {
          twiml.say(`Perfect! I can book you for ${timeInfo.description}. Is that time good for you?`);
          nextStage = STATES.CONFIRM;
        } else {
          twiml.say('I didn\'t catch the time. Could you say a day like Monday, Tuesday, or tomorrow?');
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
            twiml.say(`Excellent! Your appointment is confirmed for ${bookingResult.timeDescription}. You'll receive a text confirmation. Thank you for calling ${state.business.name}!`);
            nextStage = STATES.COMPLETE;
          } else {
            twiml.say('I apologize, there was an issue booking your appointment. Let me have someone call you back.');
          }
          twiml.hangup();
          callStates.delete(CallSid); // Clean up
        } else if (confirmation.includes('no') || confirmation.includes('different') || confirmation.includes('change')) {
          twiml.say('No problem! What day and time would work better for you?');
          nextStage = STATES.GET_TIME;
        } else {
          twiml.say('I didn\'t catch that. Can you say yes to confirm, or tell me a different time?');
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

// Enhanced time parsing - now accepts business timezone
function parseTimePreference(speech, businessTimezone = 'America/New_York') {
  const lower = speech.toLowerCase().replace(/[.,]/g, ''); // Remove punctuation
  const now = new Date();
  
  console.log(`🕐 Parsing time from: "${speech}"`);
  
  // Extract specific time mentions
  let hour = null;
  let period = null;
  
  // Look for time patterns like "7 am", "2 pm", "7:30", etc.
  const timePatterns = [
    /(\d{1,2})\s*(am|a\.m\.|a m)/i,  // "7 am", "7 a.m."
    /(\d{1,2})\s*(pm|p\.m\.|p m)/i,  // "2 pm", "2 p.m."
    /(\d{1,2}):(\d{2})\s*(am|pm|a\.m\.|p\.m\.)/i, // "7:30 am"
    /(\d{1,2})\s*o'?clock/i, // "7 oclock", "7 o'clock"
    /at\s+(\d{1,2})\s*(am|pm)/i, // "at 3 pm"
    /(\d{1,2})\s+in\s+the\s+(morning|afternoon|evening)/i, // "9 in the morning"
  ];
  
  for (const pattern of timePatterns) {
    const match = lower.match(pattern);
    if (match) {
      hour = parseInt(match[1]);
      
      // Handle different pattern matches
      if (match[3]) {
        // Pattern with time in match[3] (like 7:30 am)
        if (match[3].toLowerCase().includes('morning')) {
          period = 'am';
        } else if (match[3].toLowerCase().includes('afternoon')) {
          period = 'pm';
        } else if (match[3].toLowerCase().includes('evening')) {
          period = 'pm';
        } else {
          period = match[3].toLowerCase().includes('p') ? 'pm' : 'am';
        }
      } else if (match[2]) {
        // Pattern with period in match[2]
        if (match[2].toLowerCase().includes('morning')) {
          period = 'am';
        } else if (match[2].toLowerCase().includes('afternoon')) {
          period = 'pm';
        } else if (match[2].toLowerCase().includes('evening')) {
          period = 'pm';
        } else {
          period = match[2].toLowerCase().includes('p') ? 'pm' : 'am';
        }
      }
      
      console.log(`🕐 Found time: ${hour} ${period}`);
      break;
    }
  }
  
  // If no specific time found, look for general time indicators
  if (hour === null) {
    if (lower.includes('morning') || lower.includes('a m') || lower.includes('am')) {
      hour = 9; // Default morning time
      period = 'am';
    } else if (lower.includes('afternoon') || lower.includes('p m') || lower.includes('pm')) {
      hour = 2; // Default afternoon time  
      period = 'pm';
    } else if (lower.includes('evening')) {
      hour = 6; // Default evening time
      period = 'pm';
    } else {
      hour = 14; // Default 2 PM if no time specified
      period = 'pm';
    }
  }
  
  // Convert to 24-hour format
  let hour24 = hour;
  if (period === 'pm' && hour !== 12) {
    hour24 = hour + 12;
  } else if (period === 'am' && hour === 12) {
    hour24 = 0;
  }
  
  console.log(`🕐 Converted to 24-hour: ${hour24}:00`);
  
  // Find the target date
  let targetDate = new Date(now);
  
  // Check for specific days (including next week context)
  const days = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
  let dayFound = false;
  let isNextWeek = lower.includes('next week') || lower.includes('next monday') || 
                   lower.includes('next tuesday') || lower.includes('next wednesday') ||
                   lower.includes('next thursday') || lower.includes('next friday') ||
                   lower.includes('next saturday') || lower.includes('next sunday');
  
  for (let i = 0; i < days.length; i++) {
    if (lower.includes(days[i])) {
      if (isNextWeek) {
        // Force next week for this day
        targetDate = getNextWeekday(now, i + 1, true);
        console.log(`🗓️ Found NEXT WEEK ${days[i]}`);
      } else {
        // Regular next occurrence
        targetDate = getNextWeekday(now, i + 1);
        console.log(`🗓️ Found day: ${days[i]}`);
      }
      dayFound = true;
      break;
    }
  }
  
  // Check for "tomorrow"
  if (lower.includes('tomorrow')) {
    targetDate = new Date(now);
    targetDate.setDate(targetDate.getDate() + 1);
    dayFound = true;
    console.log(`🗓️ Found: tomorrow`);
  }
  
  // Check for "today"
  if (lower.includes('today')) {
    targetDate = new Date(now);
    dayFound = true;
    console.log(`🗓️ Found: today`);
  }
  
  // If no specific day mentioned, assume next available day
  if (!dayFound) {
    targetDate = new Date(now);
    targetDate.setDate(targetDate.getDate() + 1);
    console.log(`🗓️ Defaulting to tomorrow`);
  }
  
  // Set the time in business timezone - simplified approach
  targetDate.setHours(hour24, 0, 0, 0);
  
  // For now, treat the date as local business time
  // TODO: Implement proper timezone handling based on business settings
  console.log(`🕐 Setting appointment for: ${targetDate.toString()}`);
  
  // Create description using business timezone
  const timeDisplay = targetDate.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    timeZone: businessTimezone
  });
  
  const dayDisplay = dayFound ? 
    (lower.includes('tomorrow') ? 'tomorrow' : 
     lower.includes('today') ? 'today' :
     targetDate.toLocaleDateString('en-US', { weekday: 'long' })) : 
    'tomorrow';
  
  const description = `${dayDisplay} at ${timeDisplay}`;
  
  console.log(`🎯 Final result: ${description}`);
  
  return {
    success: true,
    date: targetDate,
    description: description
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

module.exports = { processSimpleVoice };