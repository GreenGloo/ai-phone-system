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

// Get available appointment slots
async function getAvailableSlots(businessId) {
  try {
    // Get existing appointments
    const existingAppointments = await pool.query(`
      SELECT start_time, end_time 
      FROM appointments 
      WHERE business_id = $1 
      AND status IN ('scheduled', 'confirmed')
      AND start_time >= NOW()
      AND start_time <= NOW() + INTERVAL '7 days'
      ORDER BY start_time
    `, [businessId]);
    
    const bookedSlots = existingAppointments.rows.map(apt => ({
      start: new Date(apt.start_time),
      end: new Date(apt.end_time)
    }));
    
    // Generate available slots for next 3 days
    const availableSlots = [];
    const now = new Date();
    
    for (let day = 0; day < 3; day++) {
      const currentDate = new Date(now);
      currentDate.setDate(now.getDate() + day);
      
      // Business hours: 9 AM to 5 PM
      for (let hour = 9; hour < 17; hour++) {
        for (let minute = 0; minute < 60; minute += 30) {
          const slotStart = new Date(currentDate);
          slotStart.setHours(hour, minute, 0, 0);
          
          // Skip past times for today
          if (day === 0 && slotStart <= now) continue;
          
          const slotEnd = new Date(slotStart.getTime() + 60 * 60000); // 1 hour slot
          
          // Check if slot conflicts with existing appointments
          const hasConflict = bookedSlots.some(booked => 
            (slotStart < booked.end && slotEnd > booked.start)
          );
          
          if (!hasConflict) {
            const dayName = day === 0 ? 'today' : day === 1 ? 'tomorrow' : currentDate.toLocaleDateString('en-US', { weekday: 'long' });
            const timeStr = slotStart.toLocaleTimeString('en-US', { 
              hour: 'numeric', 
              minute: '2-digit',
              hour12: true 
            });
            
            availableSlots.push({
              day: dayName,
              time: timeStr,
              datetime: slotStart.toISOString()
            });
          }
        }
      }
    }
    
    return availableSlots.slice(0, 20); // Return first 20 available slots
    
  } catch (error) {
    console.error('Error getting availability:', error);
    return []; // Return empty array on error
  }
}

async function handleVoiceCall(req, res) {
  console.log(`🔥 CONVERSATIONAL AI CALLED: ${new Date().toISOString()}`);
  console.log(`📞 Request body:`, req.body);
  console.log(`📋 Params:`, req.params);
  
  const { CallSid, SpeechResult, From } = req.body;
  const businessId = req.params.businessId;
  
  try {
    console.log(`💬 CONVERSATION: Call ${CallSid}: "${SpeechResult || 'INITIAL'}" for business ${businessId}`);
    
    // Get business info
    const businessResult = await pool.query('SELECT * FROM businesses WHERE id = $1', [businessId]);
    if (businessResult.rows.length === 0) {
      console.log(`❌ Business not found: ${businessId}`);
      return sendTwiml(res, 'Sorry, this business is not available.');
    }
    
    const business = businessResult.rows[0];
    console.log(`✅ Business found: ${business.name}`);
    
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
    timeout: 30,
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
  console.log(`🔧 Found ${services.length} services for business ${businessId}`);
  
  // Get current availability for AI to make intelligent suggestions
  const availability = await getAvailableSlots(businessId);
  console.log(`📅 Found ${availability.length} available slots`);
  
  // Have AI respond naturally
  const aiResponse = await getConversationalResponse(speech, conversation, business, services, availability);
  console.log(`🤖 AI Response:`, JSON.stringify(aiResponse, null, 2));
  
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
  console.log(`🔍 Checking AI action: "${aiResponse.action}"`);
  console.log(`🔍 Has data: ${!!aiResponse.data}`);
  
  if (aiResponse.action === 'book_appointment' && aiResponse.data) {
    console.log(`📞 BOOKING APPOINTMENT - Data:`, aiResponse.data);
    
    // Give immediate feedback while processing
    twiml.say('Perfect! Let me get that booked for you...');
    
    // AI has all the info needed - book it!
    try {
      if (services.length === 0) {
        console.error('❌ No services found for business');
        twiml.say('I\'m having trouble accessing our services. Let me have someone call you back.');
        shouldContinue = false;
      } else {
        console.log(`📞 Attempting to book with service: ${services[0].name}`);
        const booking = await bookAppointment(conversation, businessId, services[0], aiResponse.data);
        console.log(`📞 Booking result:`, booking);
        
        if (booking.success) {
          twiml.say(`All set! Your appointment is confirmed for ${aiResponse.data.suggestedTime}. We'll see you then!`);
          twiml.hangup();
          shouldContinue = false;
          conversations.delete(callSid);
        } else {
          console.error('❌ Booking failed:', booking.error);
          twiml.say('I\'m having trouble with the booking system. Let me have someone call you back to confirm your appointment.');
          shouldContinue = false;
        }
      }
    } catch (error) {
      console.error('❌ Booking error:', error);
      twiml.say('I\'m having trouble with the booking system. Let me have someone call you back.');
      shouldContinue = false;
    }
  } else {
    console.log(`💬 Continuing conversation with: "${aiResponse.response}"`);
    // Continue conversation
    twiml.say(aiResponse.response);
  }
  
  if (shouldContinue) {
    twiml.gather({
      input: 'speech',
      timeout: 30,
      speechTimeout: 'auto',
      action: `/voice/incoming/${businessId}`,
      method: 'POST'
    });
    
    twiml.say('I didn\'t hear you. Let me have someone call you back.');
    twiml.hangup();
  }
  
  return res.type('text/xml').send(twiml.toString());
}

async function getConversationalResponse(speech, conversation, business, services, availability) {
  const serviceList = services.map(s => `- ${s.name} (${s.duration_minutes} min, $${s.base_rate})`).join('\n');
  const history = conversation.conversationHistory.slice(-6).map(h => 
    `${h.speaker}: ${h.message}`
  ).join('\n');
  
  const availabilityText = availability.length > 0 ? 
    availability.map(slot => `- ${slot.day} ${slot.time}`).join('\n') : 
    'No specific availability data - suggest reasonable times';
  
  const prompt = `You are a friendly, professional receptionist for ${business.name}, a ${business.business_type} business. You have a natural conversation with customers to book appointments.

BUSINESS INFO:
${serviceList}

AVAILABLE TIME SLOTS:
${availabilityText}

CONVERSATION SO FAR:
${history}
customer: ${speech}

PERSONALITY: Be natural, conversational, and helpful. Don't sound robotic. Talk like a real person would.

YOUR GOALS:
1. Understand what service they need
2. Find out when they want to come in  
3. Check ACTUAL availability and suggest REAL available times
4. Book the appointment when they confirm

CRITICAL RULE: When a customer mentions ANY time preference (like "tomorrow", "afternoon", "morning", "after lunch"), you MUST immediately suggest a specific available time from the AVAILABLE TIME SLOTS list above. 

FORBIDDEN PHRASES:
- "When were you thinking of coming in?"
- "What time works for you?"
- "When would you like to schedule?"

REQUIRED: Always suggest specific times like "How about 9:00 AM tomorrow?" or "I have 2:30 PM available"

Be smart about understanding:
- "tomorrow" = look at tomorrow slots and suggest specific time like "How about 9:00 AM tomorrow?"
- "tomorrow afternoon" = suggest specific afternoon time like "I have 2:30 PM available tomorrow"
- "earlier" = suggest today or early tomorrow like "10:00 AM today" 
- "broken windshield wipers" = car repair service
- "yes" or "that works" = book the appointment using the EXACT TIME you suggested

NEVER ask "when were you thinking" - ALWAYS suggest specific available times!

Respond with JSON:
{
  "response": "what you say to the customer (natural, conversational)",
  "action": "continue" | "book_appointment",
  "data": {
    "service": "service name if determined",
    "timePreference": "original customer time preference",  
    "suggestedTime": "EXACT time you suggested (e.g. '2:30 PM tomorrow', '10:00 AM today')",
    "appointmentDatetime": "ISO datetime string from available slots when booking (e.g. '2024-06-14T14:30:00.000Z')",
    "customerName": "name if given"
  }
}

EXAMPLES:
Customer: "I need an oil change tomorrow"
AI looks at available slots and sees "tomorrow 9:00 AM" is available
Response: {
  "response": "Great! We can definitely take care of that oil change. How about 9:00 AM tomorrow morning?",
  "action": "continue", 
  "data": {
    "service": "Oil Change & Filter Replacement",
    "timePreference": "tomorrow",
    "suggestedTime": "9:00 AM tomorrow"
  }
}

Customer: "my windshield wipers are broken, can I come in tomorrow afternoon?"
AI looks at available slots and sees "tomorrow 2:30 PM" is available
Response: {
  "response": "I can definitely help with windshield wipers! I have 2:30 PM available tomorrow afternoon. Would that work for you?",
  "action": "continue",
  "data": {
    "service": "windshield wiper repair", 
    "timePreference": "tomorrow afternoon",
    "suggestedTime": "2:30 PM tomorrow"
  }
}

Customer: "yes that works"  
Response: {
  "response": "Perfect! I'll book you for windshield wiper repair tomorrow at 2:30 PM. You're all set!",
  "action": "book_appointment",
  "data": {
    "service": "windshield wiper repair",
    "suggestedTime": "2:30 PM tomorrow",
    "appointmentDatetime": "2024-06-14T14:30:00.000Z"
  }
}

CRITICAL: 
1. When booking (action: "book_appointment"), you MUST include the appointmentDatetime field with the exact ISO datetime from the available slots that matches your suggested time.
2. When booking, your response should ONLY confirm the booking. DO NOT ask "Is there anything else?" or continue the conversation. The call will end after booking.`;

  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-3.5-turbo",
      messages: [{ role: "user", content: prompt }],
      temperature: 0.7,
      max_tokens: 200
    });
    
    const aiContent = completion.choices[0].message.content;
    console.log(`🤖 Raw AI response:`, aiContent);
    
    const response = JSON.parse(aiContent);
    console.log(`🤖 AI: "${response.response}" | Action: ${response.action}`);
    console.log(`🤖 AI Data:`, JSON.stringify(response.data, null, 2));
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
    console.log(`📅 Booking appointment with data:`, data);
    
    let appointmentTime = new Date();
    
    // If AI provided a specific datetime, use it
    if (data.appointmentDatetime) {
      appointmentTime = new Date(data.appointmentDatetime);
      console.log(`📅 Using AI provided datetime: ${appointmentTime.toLocaleString()}`);
    } else {
      // Fallback: tomorrow at 2:30 PM
      appointmentTime.setDate(appointmentTime.getDate() + 1);
      appointmentTime.setHours(14, 30, 0, 0);
      console.log(`📅 Using fallback time: ${appointmentTime.toLocaleString()}`);
    }
    
    const endTime = new Date(appointmentTime.getTime() + (service.duration_minutes || 60) * 60000);
    
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
      appointmentTime.toISOString(),
      endTime.toISOString(),
      service.duration_minutes || 60,
      service.base_rate,
      'conversational_ai',
      'scheduled'
    ]);
    
    const appointmentId = result.rows[0].id;
    console.log(`✅ Appointment booked: ${appointmentId}`);
    
    // Create notification for the business owner
    try {
      await pool.query(`
        INSERT INTO notifications (
          business_id, type, title, message, metadata, created_at
        ) VALUES ($1, $2, $3, $4, $5, NOW())
      `, [
        businessId,
        'new_appointment',
        'New Phone Booking',
        `New appointment scheduled via AI phone system: ${service.name} at ${appointmentTime.toLocaleString()}`,
        JSON.stringify({
          appointmentId: appointmentId,
          customerPhone: conversation.customerPhone,
          service: service.name,
          source: 'conversational_ai'
        })
      ]);
      console.log(`📧 Notification created for appointment ${appointmentId}`);
    } catch (notificationError) {
      console.error('Failed to create notification:', notificationError);
      // Don't fail the booking if notification fails
    }
    
    return { success: true, appointmentId: appointmentId };
    
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