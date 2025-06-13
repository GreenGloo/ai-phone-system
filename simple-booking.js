// SIMPLE REDESIGNED BOOKING SYSTEM
// This replaces the complex AI logic with a straightforward approach

require('dotenv').config();
const express = require('express');
const twilio = require('twilio');
const { Pool } = require('pg');
const OpenAI = require('openai');

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const twilioClient = twilio(process.env.TWILIO_SID, process.env.TWILIO_TOKEN);

// Enhanced call state management with TTL and cleanup
class CallStateManager {
  constructor() {
    this.callStates = new Map();
    this.stateExpiry = new Map();
    this.maxCallDuration = 30 * 60 * 1000; // 30 minutes max
    
    // Cleanup expired states every 5 minutes
    setInterval(() => this.cleanupExpiredStates(), 5 * 60 * 1000);
    
    console.log('📞 CallStateManager initialized with automatic cleanup');
  }
  
  setState(callSid, state) {
    this.callStates.set(callSid, state);
    this.stateExpiry.set(callSid, Date.now() + this.maxCallDuration);
    console.log(`📞 Set state for call ${callSid}, expires in ${this.maxCallDuration/1000/60} minutes`);
  }
  
  getState(callSid) {
    if (this.isExpired(callSid)) {
      this.deleteState(callSid);
      console.log(`⏰ Call ${callSid} state expired and cleaned up`);
      return null;
    }
    return this.callStates.get(callSid);
  }
  
  deleteState(callSid) {
    this.callStates.delete(callSid);
    this.stateExpiry.delete(callSid);
    console.log(`🗑️ Deleted state for call ${callSid}`);
  }
  
  cleanupExpiredStates() {
    const now = Date.now();
    let cleanedCount = 0;
    
    for (const [callSid, expiry] of this.stateExpiry.entries()) {
      if (now > expiry) {
        this.deleteState(callSid);
        cleanedCount++;
      }
    }
    
    if (cleanedCount > 0) {
      console.log(`🧹 Cleaned up ${cleanedCount} expired call states`);
    }
    
    // Log memory usage
    const metrics = this.getMetrics();
    console.log(`📊 Call State Metrics - Active: ${metrics.activeStates}, Memory: ${metrics.memoryUsageMB}MB`);
  }
  
  isExpired(callSid) {
    const expiry = this.stateExpiry.get(callSid);
    return expiry && Date.now() > expiry;
  }
  
  getMetrics() {
    const memUsage = process.memoryUsage();
    return {
      activeStates: this.callStates.size,
      memoryUsageMB: Math.round(memUsage.heapUsed / 1024 / 1024),
      oldestStateAge: this.getOldestStateAge()
    };
  }
  
  getOldestStateAge() {
    if (this.stateExpiry.size === 0) return 0;
    const now = Date.now();
    const oldestExpiry = Math.min(...Array.from(this.stateExpiry.values()));
    return Math.round((this.maxCallDuration - (oldestExpiry - now)) / 1000); // Age in seconds
  }
}

const callStateManager = new CallStateManager();

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
    console.log(`📞 Call ${CallSid}: "${SpeechResult || 'INITIAL_CALL'}"`);
    
    // Get or create call state
    let state = callStateManager.getState(CallSid) || {
      stage: STATES.GREETING,
      business: null,
      service: null,
      customerName: null,
      customerPhone: From,
      appointmentTime: null,
      attempts: 0
    };
    
    // Handle initial call setup (when SpeechResult is undefined)
    if (!SpeechResult && state.stage === STATES.GREETING && state.attempts === 0) {
      console.log(`🎤 Initial call setup for ${CallSid}`);
      const twiml = new twilio.twiml.VoiceResponse();
      
      // Get business info first
      const businessResult = await pool.query(
        'SELECT * FROM businesses WHERE id = $1',
        [businessId]
      );
      
      if (businessResult.rows.length === 0) {
        twiml.say('Sorry, this business is not available.');
        return res.type('text/xml').send(twiml.toString());
      }
      
      state.business = businessResult.rows[0];
      const responses = getPersonalityResponses(state.business.ai_personality || 'professional');
      
      // Start the conversation
      twiml.say(responses.greeting.replace('{businessName}', state.business.name));
      
      // Set up gather for the first real input
      twiml.gather({
        input: 'speech',
        timeout: 15,
        speechTimeout: 'auto',
        action: `/voice/simple/${businessId}`,
        method: 'POST'
      });
      
      twiml.say('I didn\'t hear you. Let me have someone call you back.');
      twiml.hangup();
      
      // Update state - skip GREETING stage since we already greeted
      state.stage = STATES.GET_SERVICE;
      state.attempts = 1;
      callStateManager.setState(CallSid, state);
      
      return res.type('text/xml').send(twiml.toString());
    }
    
    // Skip processing if no speech input (but not initial call)
    if (!SpeechResult) {
      console.log(`⚠️ No speech result for call ${CallSid}, stage: ${state.stage}`);
      const twiml = new twilio.twiml.VoiceResponse();
      twiml.say('I didn\'t hear anything. Please try calling back.');
      twiml.hangup();
      callStateManager.deleteState(CallSid);
      return res.type('text/xml').send(twiml.toString());
    }
    
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
      case STATES.GET_SERVICE:
        // They described their service need
        state.service = SpeechResult || 'General service request';
        console.log(`🔧 Service requested: "${state.service}"`);
        
        // Validate we got a meaningful service description
        if (state.service.length < 3 || state.service.toLowerCase().includes('undefined')) {
          state.service = 'General service request';
        }
        
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
        // Parse time preference using AI with fallback
        console.log(`⏰ Customer said: "${SpeechResult}"`);
        
        try {
          const timeInfo = await parseTimePreference(SpeechResult, state.business.timezone || 'America/New_York', state.business);
          
          if (timeInfo && timeInfo.success) {
            state.appointmentTime = timeInfo;
            console.log(`⏰ Parsed time: ${timeInfo.description}`);
            console.log(`⏰ Actual date/time: ${timeInfo.date}`);
            
            twiml.say(responses.timeConfirm.replace('{timeDescription}', timeInfo.description));
            nextStage = STATES.CONFIRM;
          } else {
            console.log('⚠️ AI parsing failed, using simple fallback');
            twiml.say('Could you be more specific? For example, say "tomorrow at 2 PM" or "Monday morning"?');
            // Stay in GET_TIME stage
          }
        } catch (error) {
          console.error('❌ Time parsing error:', error.message);
          
          // Use simple fallback parser immediately
          console.log('🔄 Using simple fallback parser');
          const fallbackTime = parseTimePreferenceSimple(SpeechResult, state.business.timezone || 'America/New_York');
          
          if (fallbackTime && fallbackTime.success) {
            state.appointmentTime = fallbackTime;
            console.log(`⏰ Fallback parsed: ${fallbackTime.description}`);
            twiml.say(responses.timeConfirm.replace('{timeDescription}', fallbackTime.description));
            nextStage = STATES.CONFIRM;
          } else {
            twiml.say('Could you say the day and time? For example, "tomorrow at 2 PM"?');
            // Stay in GET_TIME stage
          }
        }
        break;
        
      case STATES.CONFIRM:
        // Check for confirmation
        const confirmation = SpeechResult.toLowerCase();
        console.log(`✅ Customer confirmation: "${SpeechResult}"`);
        
        // More strict confirmation checking
        if (confirmation.includes('yes') || confirmation.includes('yeah') || confirmation.includes('correct') || confirmation.includes('right') || confirmation.includes('that works') || confirmation.includes('sounds good')) {
          // Book the appointment
          try {
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
            callStateManager.deleteState(CallSid); // Clean up
          } catch (error) {
            // Handle calendar conflicts by asking for different time
            console.error(`❌ BOOKING ERROR for ${CallSid}:`, error.message);
            console.error(`❌ Full error stack:`, error.stack);
            console.error(`❌ State at error:`, JSON.stringify(state, null, 2));
            
            if (error.message.includes('already an appointment') || error.message.includes('closed on') || error.message.includes('only open from')) {
              console.log(`📅 Calendar conflict detected, asking for different time`);
              twiml.say(error.message);
              nextStage = STATES.GET_TIME; // Go back to time selection
            } else {
              console.error(`🚨 CRITICAL BOOKING ERROR - hanging up: ${error.message}`);
              twiml.say(responses.bookingError);
              twiml.hangup();
              callStateManager.deleteState(CallSid);
            }
          }
        } else if (confirmation.includes('no') || confirmation.includes('different') || confirmation.includes('change') || confirmation.includes('earlier') || confirmation.includes('later')) {
          twiml.say(responses.timeChange);
          nextStage = STATES.GET_TIME;
        } else {
          // Handle unclear responses
          console.log(`⚠️ Unclear confirmation: "${SpeechResult}"`);
          twiml.say('I didn\'t catch that clearly. Could you please say yes to confirm the appointment, or let me know if you\'d like a different time?');
          // Stay in CONFIRM stage
        }
        break;
        
      default:
        twiml.say('Thank you for calling. Goodbye!');
        twiml.hangup();
        callStateManager.deleteState(CallSid);
        break;
    }
    
    // Update state and continue conversation (unless hanging up)
    if (nextStage !== STATES.COMPLETE) {
      state.stage = nextStage;
      state.attempts++;
      callStateManager.setState(CallSid, state);
      
      // Add gather for next input
      twiml.gather({
        input: 'speech',
        timeout: 15,
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
    console.error(`🚨 CRITICAL VOICE PROCESSING ERROR for ${CallSid}:`, error.message);
    console.error(`🚨 Full error stack:`, error.stack);
    console.error(`🚨 Request body:`, JSON.stringify(req.body, null, 2));
    
    const twiml = new twilio.twiml.VoiceResponse();
    twiml.say('Sorry, there was a technical issue. Please try calling back.');
    twiml.hangup();
    callStateManager.deleteState(CallSid);
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

IMPORTANT BUSINESS HOUR RULES:
- NEVER schedule before 7:00 AM or after 8:00 PM
- Business hours are typically 8:00 AM to 6:00 PM
- If customer says unclear time, default to reasonable business hours
- "morning" = 9:00 AM, "afternoon" = 2:00 PM, "evening" = 5:00 PM, "lunchtime" = 12:00 PM
- For ambiguous times like "1" or "one", assume PM during business hours (1:00 PM not 1:00 AM)

Examples:
- "tomorrow at 3" → tomorrow's date with "15:00", "PM", "tomorrow at 3:00 PM"
- "next Monday morning" → next Monday's date with "09:00", "AM", "Monday at 9:00 AM"  
- "this afternoon" → today's date with "14:00", "PM", "this afternoon at 2:00 PM"
- "tomorrow at 1" → tomorrow's date with "13:00", "PM", "tomorrow at 1:00 PM"

Be intelligent about:
- "next week" means the following week, not this week
- If no time specified, default to 2:00 PM
- If no day specified, default to tomorrow
- Consider business type context (e.g., dental appointments might prefer morning slots)
- ALWAYS use reasonable business hours between 7 AM and 8 PM`;

    // Add timeout to prevent hanging
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 8000); // 8 second timeout
    
    const response = await openai.chat.completions.create({
      model: 'gpt-3.5-turbo',
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 200,
      temperature: 0.1
    }, {
      signal: controller.signal
    });
    
    clearTimeout(timeoutId);

    const aiResponse = response.choices[0].message.content.trim();
    console.log(`🤖 AI response: ${aiResponse}`);
    
    const parsed = JSON.parse(aiResponse);
    
    // Create the actual Date object
    const appointmentDate = new Date(`${parsed.date}T${parsed.time}:00`);
    
    // Validate the time is reasonable (7 AM to 8 PM)
    const hour = appointmentDate.getHours();
    if (hour < 7 || hour > 20) {
      console.warn(`⚠️ Unreasonable time detected: ${hour}:00. Adjusting to business hours.`);
      
      // Adjust to reasonable business hours
      if (hour < 7) {
        appointmentDate.setHours(9, 0, 0, 0); // 9 AM
        parsed.description = parsed.description.replace(/\d{1,2}:\d{2}\s*(AM|PM)/i, '9:00 AM');
      } else if (hour > 20) {
        appointmentDate.setHours(14, 0, 0, 0); // 2 PM next day or adjust
        parsed.description = parsed.description.replace(/\d{1,2}:\d{2}\s*(AM|PM)/i, '2:00 PM');
      }
    }
    
    console.log(`🎯 AI parsed result: ${parsed.description}`);
    console.log(`📅 Appointment date: ${appointmentDate.toString()}`);
    console.log(`⏰ Final hour: ${appointmentDate.getHours()}:${appointmentDate.getMinutes().toString().padStart(2, '0')}`);
    
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
  
  console.log(`🔄 Simple parser processing: "${lower}"`);
  
  // Default to tomorrow
  let targetDate = new Date(now);
  targetDate.setDate(targetDate.getDate() + 1);
  
  // Handle day references
  if (lower.includes('today')) {
    targetDate = new Date(now);
  } else if (lower.includes('tomorrow')) {
    targetDate.setDate(targetDate.getDate()); // already set above
  } else if (lower.includes('monday')) {
    targetDate = getNextWeekday(now, 1);
  } else if (lower.includes('tuesday')) {
    targetDate = getNextWeekday(now, 2);
  } else if (lower.includes('wednesday')) {
    targetDate = getNextWeekday(now, 3);
  } else if (lower.includes('thursday')) {
    targetDate = getNextWeekday(now, 4);
  } else if (lower.includes('friday')) {
    targetDate = getNextWeekday(now, 5);
  }
  
  // Default time based on context
  let hour = 14; // Default 2 PM
  
  if (lower.includes('morning')) {
    hour = 9; // 9 AM
  } else if (lower.includes('afternoon')) {
    hour = 14; // 2 PM
  } else if (lower.includes('evening')) {
    hour = 17; // 5 PM
  } else if (lower.includes('lunch')) {
    hour = 12; // 12 PM
  }
  
  // Look for specific numbers
  const numberMatch = lower.match(/(\d{1,2})/);
  if (numberMatch) {
    const num = parseInt(numberMatch[1]);
    if (num >= 1 && num <= 12) {
      if (lower.includes('pm') || lower.includes('afternoon') || lower.includes('evening')) {
        hour = (num === 12 ? 12 : num + 12);
      } else if (lower.includes('am') || lower.includes('morning')) {
        hour = (num === 12 ? 0 : num);
      } else {
        // Assume PM for business hours if no AM/PM specified
        hour = (num === 12 ? 12 : num + 12);
      }
    }
  }
  
  // Ensure reasonable business hours
  if (hour < 7) hour = 9;  // No earlier than 9 AM
  if (hour > 20) hour = 17; // No later than 5 PM
  
  targetDate.setHours(hour, 0, 0, 0);
  
  const description = `${targetDate.getDate() === now.getDate() + 1 ? 'tomorrow' : targetDate.toLocaleDateString('en-US', { weekday: 'long' })} at ${targetDate.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })}`;
  
  console.log(`✅ Simple parser result: ${description}`);
  
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

// Check calendar availability for appointment conflicts
async function checkCalendarAvailability(businessId, startTime, endTime) {
  try {
    console.log(`🔍 Checking availability from ${startTime.toISOString()} to ${endTime.toISOString()}`);
    
    // Check for overlapping appointments
    const conflictQuery = await pool.query(`
      SELECT id, customer_name, start_time, end_time, service_name, status
      FROM appointments 
      WHERE business_id = $1 
        AND status IN ('scheduled', 'confirmed', 'in_progress')
        AND (
          (start_time <= $2 AND end_time > $2) OR  -- Overlap at start
          (start_time < $3 AND end_time >= $3) OR  -- Overlap at end  
          (start_time >= $2 AND end_time <= $3)    -- Completely within
        )
      ORDER BY start_time
    `, [businessId, startTime.toISOString(), endTime.toISOString()]);
    
    if (conflictQuery.rows.length > 0) {
      const conflict = conflictQuery.rows[0];
      const conflictStart = new Date(conflict.start_time);
      const conflictEnd = new Date(conflict.end_time);
      
      console.log(`❌ Found appointment conflict:`, {
        id: conflict.id,
        customer: conflict.customer_name,
        service: conflict.service_name,
        time: `${conflictStart.toLocaleString()} - ${conflictEnd.toLocaleString()}`
      });
      
      return {
        available: false,
        reason: `There's already an appointment scheduled from ${conflictStart.toLocaleTimeString('en-US', { 
          hour: 'numeric', 
          minute: '2-digit', 
          hour12: true 
        })} to ${conflictEnd.toLocaleTimeString('en-US', { 
          hour: 'numeric', 
          minute: '2-digit', 
          hour12: true 
        })}. Could you choose a different time?`,
        conflictingAppointment: conflict
      };
    }
    
    // Check business hours (if configured)
    const dayOfWeek = startTime.toLocaleDateString('en-US', { weekday: 'long' }).toLowerCase();
    const businessHours = await getBusinessHours(businessId, dayOfWeek);
    
    if (businessHours && !businessHours.isOpen) {
      return {
        available: false,
        reason: `We're closed on ${dayOfWeek}s. Please choose a different day.`,
        businessHours: businessHours
      };
    }
    
    if (businessHours && businessHours.isOpen) {
      const appointmentTime = startTime.toLocaleTimeString('en-US', { 
        hour12: false, 
        hour: '2-digit', 
        minute: '2-digit' 
      });
      
      if (appointmentTime < businessHours.start || appointmentTime >= businessHours.end) {
        return {
          available: false,
          reason: `We're only open from ${businessHours.start} to ${businessHours.end} on ${dayOfWeek}s. Please choose a time during business hours.`,
          businessHours: businessHours
        };
      }
    }
    
    console.log(`✅ Time slot is available - no conflicts found`);
    return {
      available: true,
      reason: 'Time slot is available'
    };
    
  } catch (error) {
    console.error('❌ Error checking calendar availability:', error);
    return {
      available: false,
      reason: 'Unable to check calendar availability. Please try a different time.',
      error: error.message
    };
  }
}

// Get business hours for a specific day
async function getBusinessHours(businessId, dayOfWeek) {
  try {
    const result = await pool.query(
      'SELECT business_hours FROM businesses WHERE id = $1',
      [businessId]
    );
    
    if (result.rows.length === 0 || !result.rows[0].business_hours) {
      console.log(`📅 No business hours configured for ${businessId}`);
      return null;
    }
    
    const hours = result.rows[0].business_hours[dayOfWeek];
    if (!hours) {
      console.log(`📅 No hours configured for ${dayOfWeek}`);
      return null;
    }
    
    return {
      isOpen: hours.enabled,
      start: hours.start,
      end: hours.end,
      day: dayOfWeek
    };
    
  } catch (error) {
    console.error('❌ Error getting business hours:', error);
    return null;
  }
}

// Suggest alternative available times when there's a conflict
async function suggestAlternativeTimes(businessId, requestedTime, durationMinutes) {
  try {
    console.log(`🔍 Looking for alternative times around ${requestedTime.toISOString()}`);
    
    const alternatives = [];
    const sameDay = new Date(requestedTime);
    
    // Try times before and after on the same day
    const timeSlots = [];
    
    // Generate hourly slots from 8 AM to 6 PM
    for (let hour = 8; hour <= 18; hour++) {
      const slotTime = new Date(sameDay);
      slotTime.setHours(hour, 0, 0, 0);
      timeSlots.push(slotTime);
    }
    
    // Check each slot for availability
    for (const slotTime of timeSlots) {
      const slotEnd = new Date(slotTime.getTime() + durationMinutes * 60000);
      
      // Skip the originally requested time
      if (Math.abs(slotTime.getTime() - requestedTime.getTime()) < 30 * 60000) {
        continue;
      }
      
      const availability = await checkCalendarAvailability(businessId, slotTime, slotEnd);
      
      if (availability.available) {
        alternatives.push({
          startTime: slotTime,
          endTime: slotEnd,
          description: slotTime.toLocaleTimeString('en-US', { 
            hour: 'numeric', 
            minute: '2-digit', 
            hour12: true 
          })
        });
        
        // Limit to 2 suggestions to avoid overwhelming the customer
        if (alternatives.length >= 2) break;
      }
    }
    
    console.log(`📅 Found ${alternatives.length} alternative time slots`);
    return alternatives;
    
  } catch (error) {
    console.error('❌ Error suggesting alternative times:', error);
    return [];
  }
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
    
    // CHECK FOR CALENDAR CONFLICTS BEFORE BOOKING
    console.log(`🔍 Checking for calendar conflicts...`);
    const conflictCheck = await checkCalendarAvailability(businessId, appointmentTime, endTime);
    
    if (!conflictCheck.available) {
      console.log(`❌ TIME SLOT CONFLICT: ${conflictCheck.reason}`);
      
      // Try to suggest alternative times
      const alternatives = await suggestAlternativeTimes(businessId, appointmentTime, service.duration_minutes);
      let errorMessage = conflictCheck.reason;
      
      if (alternatives.length > 0) {
        const altDescriptions = alternatives.map(alt => alt.description).join(' or ');
        errorMessage += ` How about ${altDescriptions} instead?`;
      }
      
      throw new Error(errorMessage);
    }
    
    console.log(`✅ Time slot is available, proceeding with booking`);
    
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

// Send notification to business owner (website-based, no SMS)
async function sendOwnerNotification(state, businessId, service, appointment) {
  try {
    console.log('📧 Creating website notification instead of SMS');
    
    // Get business owner info
    const ownerResult = await pool.query(
      `SELECT u.phone, u.first_name, u.last_name, b.name as business_name, b.phone_number 
       FROM businesses b 
       JOIN users u ON b.user_id = u.id 
       WHERE b.id = $1`,
      [businessId]
    );
    
    if (ownerResult.rows.length === 0) {
      console.log('❌ No owner found for notification');
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

    // Create in-app notification instead of SMS
    const notificationData = {
      business_id: businessId,
      type: 'new_appointment',
      title: 'New Appointment Booked!',
      message: `${state.customerName} booked ${service.name} for ${appointmentTime}`,
      data: {
        appointment_id: appointment.id,
        customer_name: state.customerName,
        customer_phone: state.customerPhone,
        service_name: service.name,
        appointment_time: appointmentTime,
        service_cost: service.base_rate,
        service_description: state.service
      },
      created_at: new Date().toISOString(),
      read: false
    };
    
    // Store notification in database
    try {
      await pool.query(`
        INSERT INTO notifications (business_id, type, title, message, data, created_at, read)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
      `, [
        notificationData.business_id,
        notificationData.type,
        notificationData.title,
        notificationData.message,
        JSON.stringify(notificationData.data),
        notificationData.created_at,
        notificationData.read
      ]);
      
      console.log(`📧 ✅ Website notification created for ${owner.first_name} ${owner.last_name}`);
      console.log(`📧 Notification: ${notificationData.title}`);
      
    } catch (dbError) {
      console.error(`📧 ❌ Failed to create notification:`, dbError.message);
      
      // Fallback: try to create notifications table if it doesn't exist
      try {
        await pool.query(`
          CREATE TABLE IF NOT EXISTS notifications (
            id SERIAL PRIMARY KEY,
            business_id UUID NOT NULL REFERENCES businesses(id),
            type VARCHAR(50) NOT NULL,
            title VARCHAR(200) NOT NULL,
            message TEXT NOT NULL,
            data JSONB,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            read BOOLEAN DEFAULT false,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
          )
        `);
        
        console.log(`📧 Created notifications table, retrying...`);
        
        // Retry notification creation
        await pool.query(`
          INSERT INTO notifications (business_id, type, title, message, data, created_at, read)
          VALUES ($1, $2, $3, $4, $5, $6, $7)
        `, [
          notificationData.business_id,
          notificationData.type,
          notificationData.title,
          notificationData.message,
          JSON.stringify(notificationData.data),
          notificationData.created_at,
          notificationData.read
        ]);
        
        console.log(`📧 ✅ Website notification created successfully (after table creation)`);
        
      } catch (tableError) {
        console.error(`📧 ❌ Failed to create notifications table:`, tableError.message);
      }
    }
    
    // Log booking summary (no SMS)
    console.log(`📧 BOOKING SUMMARY:`);
    console.log(`📧 Customer: ${state.customerName} (${state.customerPhone})`);
    console.log(`📧 Service: ${service.name} - $${service.base_rate}`);
    console.log(`📧 Time: ${appointmentTime}`);
    console.log(`📧 Owner will see notification on dashboard`);
    console.log(`📧 SMS disabled - using website notifications only`);
    
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