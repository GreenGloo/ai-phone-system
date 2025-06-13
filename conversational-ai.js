// ULTRA-HUMAN CONVERSATIONAL AI BOOKING SYSTEM
// The most natural, empathetic, and intelligent AI assistant for service businesses
// Never misses a service call - converts every interaction into satisfied customers

require('dotenv').config();
const twilio = require('twilio');
const { Pool } = require('pg');
const OpenAI = require('openai');

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// Add Claude support for superior conversation quality
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const USE_CLAUDE = process.env.USE_CLAUDE === 'true'; // Set to 'true' to use Claude instead of OpenAI

async function callClaude(prompt) {
  // Use node-fetch or axios for Node.js compatibility
  const axios = require('axios');
  
  const response = await axios.post('https://api.anthropic.com/v1/messages', {
    model: 'claude-3-5-sonnet-20241022',
    max_tokens: 200,
    temperature: 0.7,
    messages: [
      {
        role: 'user',
        content: prompt
      }
    ]
  }, {
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01'
    }
  });
  
  return response.data.content[0].text;
}
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const twilioClient = twilio(process.env.TWILIO_SID, process.env.TWILIO_TOKEN);

// Startup Configuration Logging
console.log('🔥 CUTTING-EDGE AI PHONE SYSTEM INITIALIZING...');
console.log(`🧠 AI Provider: ${USE_CLAUDE ? 'Claude 3.5 Sonnet (SUPERIOR)' : 'OpenAI GPT-4o-mini (Fallback)'}`);
console.log(`🔑 Claude API Key: ${ANTHROPIC_API_KEY ? 'CONFIGURED ✅' : 'MISSING ❌'}`);
console.log(`🔑 OpenAI API Key: ${process.env.OPENAI_API_KEY ? 'CONFIGURED ✅' : 'MISSING ❌'}`);
console.log(`🎭 ElevenLabs API Key: ${process.env.ELEVENLABS_API_KEY ? 'CONFIGURED ✅' : 'MISSING ❌'}`);
console.log('🚀 Ready to provide the most human-like AI assistant experience!');

// Advanced conversation memory with emotional intelligence
const conversations = new Map();

// AI Personality Engine - Makes conversations feel genuinely human
const PERSONALITY_PROFILES = {
  professional: {
    name: "Professional & Warm",
    tone: "friendly yet professional",
    enthusiasm: 0.7,
    empathy: 0.8,
    speechPatterns: ["I'd be happy to help", "Absolutely", "Of course", "That sounds perfect"],
    confirmationStyle: "polite and thorough"
  },
  casual: {
    name: "Casual & Friendly", 
    tone: "relaxed and approachable",
    enthusiasm: 0.9,
    empathy: 0.9,
    speechPatterns: ["Sure thing", "Sounds great", "Perfect", "You got it"],
    confirmationStyle: "casual and conversational"
  },
  helpful: {
    name: "Extremely Helpful",
    tone: "eager to assist",
    enthusiasm: 0.8,
    empathy: 0.9,
    speechPatterns: ["I'd love to help with that", "Let me take care of that for you", "Absolutely, no problem"],
    confirmationStyle: "thorough and reassuring"
  }
};

// Emotional Intelligence - Detects and responds to customer emotions
function analyzeCustomerEmotion(speech, conversationHistory) {
  const emotionalCues = {
    frustrated: ['annoying', 'frustrated', 'annoyed', 'terrible', 'awful', 'hate', 'problem', 'issue'],
    urgent: ['asap', 'urgent', 'emergency', 'immediately', 'right away', 'quickly', 'fast'],
    happy: ['great', 'awesome', 'perfect', 'excellent', 'wonderful', 'love', 'amazing'],
    confused: ['confused', 'understand', 'what', 'how', 'unclear', 'explain'],
    price_sensitive: ['cost', 'price', 'expensive', 'cheap', 'affordable', 'money', 'budget']
  };
  
  const lowerSpeech = speech.toLowerCase();
  const detectedEmotions = [];
  
  for (const [emotion, cues] of Object.entries(emotionalCues)) {
    if (cues.some(cue => lowerSpeech.includes(cue))) {
      detectedEmotions.push(emotion);
    }
  }
  
  // Analyze conversation context for additional emotional cues
  const recentMessages = conversationHistory.slice(-3);
  const hasRepeatedRequests = recentMessages.filter(msg => 
    msg.speaker === 'customer' && msg.message.toLowerCase().includes('book')
  ).length > 1;
  
  if (hasRepeatedRequests) detectedEmotions.push('frustrated');
  
  return detectedEmotions;
}

// Dynamic Response Timing - Makes conversations feel more natural
function calculateResponseTiming(messageLength, emotion, personality) {
  let baseDelay = 0.5; // Base 0.5 second thinking time
  
  // Adjust for message complexity
  if (messageLength > 50) baseDelay += 0.3;
  if (messageLength > 100) baseDelay += 0.5;
  
  // Adjust for emotions
  if (emotion.includes('urgent')) baseDelay *= 0.5; // Respond faster to urgent requests
  if (emotion.includes('frustrated')) baseDelay *= 0.7; // Don't keep frustrated customers waiting
  if (emotion.includes('confused')) baseDelay += 0.2; // Take time to think about explanations
  
  // Personality adjustments
  baseDelay *= (1 + personality.enthusiasm * 0.3); // More enthusiastic = slightly faster
  
  return Math.max(0.2, Math.min(2.0, baseDelay)); // Keep between 0.2-2 seconds
}

// Get available appointment slots using REAL business calendar system
async function getAvailableSlots(businessId) {
  try {
    console.log(`📅 Getting REAL calendar availability for business ${businessId}`);
    
    // Get business info with calendar preferences and business hours
    const businessResult = await pool.query(`
      SELECT business_hours, calendar_preferences 
      FROM businesses 
      WHERE id = $1
    `, [businessId]);
    
    if (businessResult.rows.length === 0) {
      console.error('❌ Business not found for calendar');
      return [];
    }
    
    const { business_hours, calendar_preferences } = businessResult.rows[0];
    console.log(`🏢 Business Hours:`, business_hours);
    console.log(`📋 Calendar Preferences:`, calendar_preferences);
    
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
    
    console.log(`📋 Found ${bookedSlots.length} existing appointments`);
    
    // Generate available slots using REAL business hours
    const availableSlots = [];
    const now = new Date();
    const appointmentDuration = calendar_preferences?.appointmentDuration || 60;
    const bufferTime = calendar_preferences?.bufferTime || 30;
    const maxDaily = calendar_preferences?.maxDailyAppointments || 8;
    
    for (let day = 0; day < 7; day++) {
      const currentDate = new Date(now);
      currentDate.setDate(now.getDate() + day);
      const dayName = currentDate.toLocaleDateString('en-US', { weekday: 'lowercase' });
      
      // Get business hours for this day
      const dayHours = business_hours[dayName];
      if (!dayHours || !dayHours.enabled) {
        console.log(`📅 ${dayName} is closed`);
        continue;
      }
      
      const [startHour, startMinute] = dayHours.start.split(':').map(Number);
      const [endHour, endMinute] = dayHours.end.split(':').map(Number);
      
      console.log(`📅 ${dayName}: ${dayHours.start} - ${dayHours.end}`);
      
      let dailySlotCount = 0;
      
      // Generate slots within business hours
      for (let hour = startHour; hour < endHour; hour++) {
        for (let minute = 0; minute < 60; minute += 30) {
          if (dailySlotCount >= maxDaily) break;
          
          const slotStart = new Date(currentDate);
          slotStart.setHours(hour, minute, 0, 0);
          
          // Skip if past end time
          if (hour === endHour && minute >= endMinute) break;
          
          // Skip past times for today
          if (day === 0 && slotStart <= now) continue;
          
          const slotEnd = new Date(slotStart.getTime() + appointmentDuration * 60000);
          
          // Check if slot conflicts with existing appointments (including buffer)
          const hasConflict = bookedSlots.some(booked => {
            const bufferStart = new Date(booked.start.getTime() - bufferTime * 60000);
            const bufferEnd = new Date(booked.end.getTime() + bufferTime * 60000);
            return (slotStart < bufferEnd && slotEnd > bufferStart);
          });
          
          if (!hasConflict) {
            const dayLabel = day === 0 ? 'today' : day === 1 ? 'tomorrow' : currentDate.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });
            const timeStr = slotStart.toLocaleTimeString('en-US', { 
              hour: 'numeric', 
              minute: '2-digit',
              hour12: true 
            });
            
            availableSlots.push({
              day: dayLabel,
              time: timeStr,
              datetime: slotStart.toISOString()
            });
            
            dailySlotCount++;
          }
        }
        if (dailySlotCount >= maxDaily) break;
      }
    }
    
    console.log(`📅 Generated ${availableSlots.length} available slots using REAL business calendar`);
    return availableSlots.slice(0, 20);
    
  } catch (error) {
    console.error('❌ Error getting REAL calendar availability:', error);
    return [];
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
    const conversation = conversations.get(CallSid);
    return handleConversationError(error, conversation, res);
  }
}

function handleInitialCall(res, business, callSid, from, businessId) {
  // Choose personality based on business type (could be configurable per business)
  const personality = PERSONALITY_PROFILES.helpful; // Default to most helpful
  
  // Start enhanced conversation memory
  conversations.set(callSid, {
    business: business,
    customerPhone: from,
    conversationHistory: [],
    customerInfo: {},
    personality: personality,
    emotionalState: [],
    interactionCount: 0,
    startTime: new Date(),
    context: {
      hasGreeted: true,
      needsService: null,
      preferredTime: null,
      urgencyLevel: 'normal'
    }
  });
  
  // Create warm, personalized greeting
  const timeOfDay = getTimeOfDay();
  const greetingVariations = [
    `Good ${timeOfDay}! Thanks for calling ${business.name}. I'm here to help you with anything you need.`,
    `Hi there! You've reached ${business.name}. I'd love to help you today - what can I do for you?`,
    `Hello! Welcome to ${business.name}. I'm excited to help you out - what brings you to us today?`
  ];
  
  const greeting = greetingVariations[Math.floor(Math.random() * greetingVariations.length)];
  
  const twiml = new twilio.twiml.VoiceResponse();
  twiml.say(greeting);
  
  twiml.gather({
    input: 'speech',
    timeout: 30,
    speechTimeout: 'auto',
    action: `/voice/incoming/${businessId}`,
    method: 'POST'
  });
  
  twiml.say('I didn\'t catch that - let me have someone call you right back to make sure we take great care of you.');
  twiml.hangup();
  
  return res.type('text/xml').send(twiml.toString());
}

// Helper function for time-appropriate greetings
function getTimeOfDay() {
  const hour = new Date().getHours();
  if (hour < 12) return 'morning';
  if (hour < 17) return 'afternoon';
  return 'evening';
}

// Natural Speech Enhancement - Makes AI responses sound more human
function enhanceNaturalSpeech(response, personality, emotions) {
  let enhanced = response;
  
  // Add natural filler words and speech patterns
  const fillers = personality.speechPatterns || [];
  
  // Add enthusiasm markers based on emotions
  if (emotions.includes('happy') || emotions.includes('excited')) {
    enhanced = enhanced.replace(/!/g, '!!');
    enhanced = enhanced.replace(/That's great/gi, 'That\'s fantastic');
    enhanced = enhanced.replace(/Perfect/gi, 'Perfect!');
  }
  
  // Add empathy for frustrated customers
  if (emotions.includes('frustrated')) {
    if (!enhanced.toLowerCase().includes('understand') && !enhanced.toLowerCase().includes('sorry')) {
      enhanced = 'I totally understand. ' + enhanced;
    }
  }
  
  // Add urgency acknowledgment
  if (emotions.includes('urgent')) {
    enhanced = enhanced.replace(/I'll/gi, 'I\'ll absolutely');
    enhanced = enhanced.replace(/can /gi, 'can definitely ');
  }
  
  // Natural speech patterns - add contractions and casual language
  enhanced = enhanced.replace(/I will /gi, 'I\'ll ');
  enhanced = enhanced.replace(/You will /gi, 'You\'ll ');
  enhanced = enhanced.replace(/We will /gi, 'We\'ll ');
  enhanced = enhanced.replace(/I am /gi, 'I\'m ');
  enhanced = enhanced.replace(/You are /gi, 'You\'re ');
  enhanced = enhanced.replace(/That is /gi, 'That\'s ');
  enhanced = enhanced.replace(/It is /gi, 'It\'s ');
  
  // Add personality-specific enhancements
  if (personality.tone === 'casual and conversational') {
    enhanced = enhanced.replace(/Yes,/gi, 'Yeah,');
    enhanced = enhanced.replace(/Certainly/gi, 'Sure thing');
  }
  
  return enhanced;
}

// Voice Settings - Matches voice characteristics to personality and emotions
function getVoiceSettings(personality, emotions) {
  const settings = {
    voice: 'alice', // Default pleasant female voice
    rate: '1.0'
  };
  
  // Adjust speaking rate based on emotions
  if (emotions.includes('urgent')) {
    settings.rate = '1.1'; // Speak slightly faster for urgent matters
  } else if (emotions.includes('confused') || emotions.includes('frustrated')) {
    settings.rate = '0.9'; // Speak slower for clarity
  }
  
  // Personality-based voice adjustments
  if (personality.enthusiasm > 0.8) {
    settings.rate = String(parseFloat(settings.rate) + 0.05); // Slightly faster for enthusiastic personalities
  }
  
  return settings;
}

// Intelligent Booking Confirmation Messages
function generateBookingConfirmation(data, personality, emotions) {
  const baseConfirmations = [
    'Perfect! Let me get that booked for you',
    'Excellent! I\'ll take care of that right now',
    'Great choice! Let me secure that appointment'
  ];
  
  if (emotions.includes('urgent')) {
    return 'Absolutely! I\'ll get this scheduled for you right away';
  } else if (emotions.includes('happy')) {
    return 'Fantastic! I\'m excited to get this set up for you';
  } else if (personality.tone === 'casual and conversational') {
    return 'Perfect! Let me hook you up with that appointment';
  }
  
  return baseConfirmations[Math.floor(Math.random() * baseConfirmations.length)];
}

// Intelligent Service Matching with Fuzzy Logic
function intelligentServiceMatching(services, requestedService) {
  if (!requestedService || services.length === 0) {
    return services[0]; // Default fallback
  }
  
  const requested = requestedService.toLowerCase();
  
  // Exact match first
  let match = services.find(s => s.name.toLowerCase() === requested);
  if (match) return match;
  
  // Partial match
  match = services.find(s => 
    s.name.toLowerCase().includes(requested) || 
    requested.includes(s.name.toLowerCase())
  );
  if (match) return match;
  
  // Keyword matching for common service terms
  const serviceKeywords = {
    'repair': ['repair', 'fix', 'broken', 'maintenance'],
    'installation': ['install', 'setup', 'new'],
    'cleaning': ['clean', 'wash', 'sanitize'],
    'inspection': ['check', 'inspect', 'look'],
    'consultation': ['consult', 'advice', 'estimate']
  };
  
  for (const [category, keywords] of Object.entries(serviceKeywords)) {
    if (keywords.some(keyword => requested.includes(keyword))) {
      match = services.find(s => s.name.toLowerCase().includes(category));
      if (match) return match;
    }
  }
  
  return services[0]; // Ultimate fallback
}

// Enhanced Error Messages Based on Personality
function generateServiceErrorMessage(personality, emotions) {
  if (emotions.includes('frustrated')) {
    return 'I really want to help you, but I\'m having trouble accessing our services right now. Let me have someone call you back immediately to get this sorted out.';
  } else if (personality.tone === 'casual and conversational') {
    return 'Hmm, I\'m having a technical hiccup with our services. Let me get someone to call you right back!';
  }
  return 'I\'m having trouble accessing our services at the moment. Let me have someone call you back to assist you properly.';
}

function generateBookingSuccessMessage(data, personality, emotions, service) {
  const customerName = data.customerName ? `, ${data.customerName}` : '';
  const timePhrase = data.suggestedTime || 'your selected time';
  
  if (emotions.includes('happy') || emotions.includes('excited')) {
    return `Fantastic${customerName}! Your ${service.name} appointment is all confirmed for ${timePhrase}. We can't wait to help you out! See you then!`;
  } else if (emotions.includes('urgent')) {
    return `Perfect${customerName}! I've got you scheduled for ${service.name} at ${timePhrase}. We'll take great care of you. See you soon!`;
  } else if (personality.tone === 'casual and conversational') {
    return `All set${customerName}! You're booked for ${service.name} on ${timePhrase}. We'll see you then!`;
  }
  
  return `Excellent${customerName}! Your ${service.name} appointment is confirmed for ${timePhrase}. We look forward to helping you. See you then!`;
}

function generateBookingFailureMessage(personality, emotions) {
  if (emotions.includes('frustrated')) {
    return 'I\'m really sorry - I want to get this booked for you but our system is having issues. Let me have someone call you back right away to confirm your appointment manually.';
  }
  return 'I\'m having trouble with our booking system right now. Let me have someone call you back to get this scheduled properly for you.';
}

function generateSystemErrorMessage(personality, emotions) {
  if (emotions.includes('urgent')) {
    return 'I don\'t want to keep you waiting with technical issues. Let me have someone call you back immediately to help you.';
  }
  return 'I\'m experiencing some technical difficulties. Let me have someone call you back to make sure we take excellent care of you.';
}

async function holdConversation(res, business, callSid, from, speech, businessId) {
  const conversation = conversations.get(callSid) || {
    business: business,
    customerPhone: from,
    conversationHistory: [],
    customerInfo: {},
    personality: PERSONALITY_PROFILES.helpful,
    emotionalState: [],
    interactionCount: 0,
    startTime: new Date(),
    context: {
      hasGreeted: false,
      needsService: null,
      preferredTime: null,
      urgencyLevel: 'normal'
    }
  };
  
  // Increment interaction count and analyze emotional state
  conversation.interactionCount++;
  const detectedEmotions = analyzeCustomerEmotion(speech, conversation.conversationHistory);
  conversation.emotionalState = detectedEmotions;
  
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
  
  // Have AI respond with full emotional intelligence and context awareness
  const aiResponse = await getHumanLikeResponse(speech, conversation, business, services, availability);
  console.log(`🤖 Human-like AI Response:`, JSON.stringify(aiResponse, null, 2));
  
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
    console.log(`📞 INTELLIGENT BOOKING INITIATED - Data:`, aiResponse.data);
    
    // Intelligent booking confirmation based on personality and emotional state
    const confirmationMessage = generateBookingConfirmation(aiResponse.data, conversation.personality, conversation.emotionalState);
    console.log(`🎯 Booking confirmation: "${confirmationMessage}"`);
    
    // Apply natural speech enhancement to confirmation
    const enhancedConfirmation = enhanceNaturalSpeech(confirmationMessage, conversation.personality, conversation.emotionalState);
    twiml.say(enhancedConfirmation);
    
    // Process the booking with enhanced error handling
    try {
      if (services.length === 0) {
        console.error('❌ No services found for business');
        const errorMessage = generateServiceErrorMessage(conversation.personality, conversation.emotionalState);
        twiml.say(errorMessage);
        shouldContinue = false;
      } else {
        // Intelligent service matching with fuzzy logic
        const selectedService = intelligentServiceMatching(services, aiResponse.data.service);
        console.log(`🎯 Intelligent service match: "${selectedService.name}"`);
        
        const booking = await bookAppointmentWithConfirmation(conversation, businessId, selectedService, aiResponse.data);
        console.log(`📞 Enhanced booking result:`, booking);
        
        if (booking.success) {
          const successMessage = generateBookingSuccessMessage(aiResponse.data, conversation.personality, conversation.emotionalState, selectedService);
          const enhancedSuccess = enhanceNaturalSpeech(successMessage, conversation.personality, conversation.emotionalState);
          twiml.say(enhancedSuccess);
          twiml.hangup();
          shouldContinue = false;
          conversations.delete(callSid);
        } else {
          console.error('❌ Booking failed:', booking.error);
          const failureMessage = generateBookingFailureMessage(conversation.personality, conversation.emotionalState);
          twiml.say(failureMessage);
          shouldContinue = false;
        }
      }
    } catch (error) {
      console.error('❌ Booking error:', error);
      const errorMessage = generateSystemErrorMessage(conversation.personality, conversation.emotionalState);
      twiml.say(errorMessage);
      shouldContinue = false;
    }
  } else {
    console.log(`💬 Continuing conversation with: "${aiResponse.response}"`);
    
    // Apply natural speech enhancements
    const enhancedResponse = enhanceNaturalSpeech(aiResponse.response, conversation.personality, conversation.emotionalState);
    console.log(`🎭 Enhanced speech: "${enhancedResponse}"`);
    
    // Calculate natural response timing
    const responseDelay = calculateResponseTiming(speech.length, conversation.emotionalState, conversation.personality);
    console.log(`⏱️ Natural response delay: ${responseDelay}s`);
    
    // Add slight pause for natural timing (Twilio supports pause)
    if (responseDelay > 0.5) {
      twiml.pause({ length: Math.min(1, responseDelay - 0.5) });
    }
    
    // Say the enhanced response with personality-matched voice settings
    const voiceSettings = getVoiceSettings(conversation.personality, conversation.emotionalState);
    twiml.say(enhancedResponse, voiceSettings);
  }
  
  if (shouldContinue) {
    // Intelligent gathering with enhanced parameters for natural conversation
    const gatherParams = {
      input: 'speech',
      timeout: 25, // Slightly shorter to feel more responsive
      speechTimeout: 'auto',
      action: `/voice/incoming/${businessId}`,
      method: 'POST'
    };
    
    // Adjust parameters based on emotional state and conversation stage
    if (conversation.emotionalState.includes('frustrated')) {
      gatherParams.timeout = 20; // Faster response for frustrated customers
    } else if (conversation.emotionalState.includes('confused')) {
      gatherParams.timeout = 35; // More time for confused customers to respond
    } else if (conversation.interactionCount > 5) {
      gatherParams.timeout = 20; // Shorter timeout for extended conversations
    }
    
    twiml.gather(gatherParams);
    
    // Natural timeout messages based on emotional state and personality
    let timeoutMessage = 'I didn\'t catch that. Let me have someone call you right back to make sure we take care of you.';
    
    if (conversation.emotionalState.includes('frustrated')) {
      timeoutMessage = 'I want to make sure I help you properly - let me have someone call you back right away.';
    } else if (conversation.emotionalState.includes('urgent')) {
      timeoutMessage = 'I don\'t want to keep you waiting - someone will call you back immediately.';
    } else if (conversation.personality.tone === 'casual and conversational') {
      timeoutMessage = 'Hmm, I think we might have lost connection. We\'ll call you right back!';
    }
    
    twiml.say(timeoutMessage);
    twiml.hangup();
  }
  
  return res.type('text/xml').send(twiml.toString());
}

async function getHumanLikeResponse(speech, conversation, business, services, availability) {
  // Simplified approach based on working examples
  const recentHistory = conversation.conversationHistory.slice(-3).map(h => 
    `${h.speaker}: ${h.message}`
  ).join('\n');
  
  const availableSlots = availability.slice(0, 10).map(slot => 
    `${slot.day} ${slot.time} (${slot.datetime})`
  ).join(', ');
  
  // Claude-optimized prompt - superior instruction following and context understanding
  const currentDate = new Date();
  const todayStr = currentDate.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
  const currentTime = currentDate.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
  
  const claudePrompt = `You are an expert booking assistant for ${business.name}, a professional automotive garage.

CURRENT DATE/TIME: ${todayStr} at ${currentTime}

CUSTOMER INPUT: "${speech}"

RECENT CONVERSATION:
${recentHistory}

AVAILABLE APPOINTMENT SLOTS: ${availableSlots}

CRITICAL BOOKING INSTRUCTIONS:
• Speech recognition errors: "CID" = "oil change", "old change" = "oil change"
• ANY service mention = immediately offer specific times and push for booking
• Customer saying "yes"/"okay"/"sounds good"/"that works" = book the appointment NOW with action: "book_appointment"
• ONLY suggest times from the AVAILABLE APPOINTMENT SLOTS list above - never make up dates!
• When offering times, ALWAYS use the exact appointmentDatetime from the available slots
• Be conversational but ALWAYS drive toward booking an appointment
• Oil changes are most common - assume unclear requests are oil changes

BOOKING EXAMPLES:
Customer: "oil change" → action: "continue", offer specific times like "I can get you in tomorrow at 4:00 PM or Sunday at 10:00 AM"
Customer: "yes" or "4 PM works" or "tomorrow sounds good" → action: "book_appointment" with exact appointmentDatetime like "2025-06-14T16:00:00.000Z"
Customer: "that works" → action: "book_appointment" using the previously suggested time

RESPONSE FORMAT (JSON only):
{
  "response": "Natural, helpful response that offers specific appointment times",
  "action": "continue" or "book_appointment",
  "data": {
    "service": "oil change",
    "suggestedTime": "tomorrow 4:00 PM", 
    "appointmentDatetime": "2025-06-14T16:00:00.000Z"
  }
}`;

  const openaiPrompt = `You are a booking assistant for ${business.name}, an automotive garage.

Customer said: "${speech}"

Conversation history:
${recentHistory}

Available times: ${availableSlots}

BOOKING RULES:
1. If customer mentions ANY service need (oil change, repair, checkup, etc.) -> offer specific times and book immediately
2. If customer says "yes", "sounds good", "okay" -> book the appointment  
3. If customer gives a time -> book it if available
4. Assume unclear speech like "CID" means "oil change" 
5. Be direct - offer times, don't just ask questions

Your response should either:
- Continue conversation AND offer specific booking times
- Book the appointment immediately

Respond in JSON:
{
  "response": "your reply",
  "action": "continue" or "book_appointment", 
  "data": {
    "service": "oil change",
    "suggestedTime": "today 2:00 PM",
    "appointmentDatetime": "2025-06-13T14:00:00Z"
  }
}`;

  const prompt = USE_CLAUDE ? claudePrompt : openaiPrompt;

  try {
    let aiContent;
    
    console.log(`🔍 DEBUG: USE_CLAUDE=${USE_CLAUDE}, ANTHROPIC_API_KEY=${!!ANTHROPIC_API_KEY}`);
    
    if (USE_CLAUDE && ANTHROPIC_API_KEY) {
      console.log(`🧠 Using Claude 3.5 Sonnet for superior conversation quality`);
      try {
        aiContent = await callClaude(prompt);
        console.log(`🔥 Claude response:`, aiContent);
      } catch (claudeError) {
        console.error(`❌ Claude API Error:`, claudeError);
        console.log(`🔄 Falling back to OpenAI...`);
        const completion = await openai.chat.completions.create({
          model: "gpt-4o-mini",
          messages: [{ role: "user", content: prompt }],
          temperature: 0.7,
          max_tokens: 200,
          presence_penalty: 0.1,
          frequency_penalty: 0.1
        });
        aiContent = completion.choices[0].message.content;
        console.log(`🤖 OpenAI fallback response:`, aiContent);
      }
    } else {
      console.log(`🤖 Using OpenAI GPT-4o-mini (Claude not configured)`);
      const completion = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [{ role: "user", content: prompt }],
        temperature: 0.7,
        max_tokens: 200,
        presence_penalty: 0.1,
        frequency_penalty: 0.1
      });
      
      aiContent = completion.choices[0].message.content;
      console.log(`🤖 OpenAI response:`, aiContent);
    }
    
    let response;
    try {
      response = JSON.parse(aiContent);
    } catch (parseError) {
      // Fallback if JSON parsing fails
      console.warn('JSON parse failed, using fallback response');
      response = {
        response: aiContent.replace(/```json|```/g, '').trim(),
        action: 'continue',
        data: {}
      };
    }
    
    // Update conversation context based on AI insights
    if (response.data?.contextUpdates) {
      Object.assign(conversation.context, response.data.contextUpdates);
    }
    
    console.log(`🤖 Human-like AI: "${response.response}" | Action: ${response.action}`);
    console.log(`🤖 Emotional awareness: ${conversation?.emotionalState?.join(', ') || 'neutral'}`);
    return response;
    
  } catch (error) {
    console.error('Human-like AI Error:', error);
    
    // If Claude succeeded but we hit an error in post-processing, use Claude's response
    if (aiContent && typeof aiContent === 'string') {
      try {
        const claudeResponse = JSON.parse(aiContent);
        console.log('🔄 Using Claude response despite post-processing error');
        return claudeResponse;
      } catch (parseError) {
        console.error('Claude response parse error:', parseError);
      }
    }
    
    // Enhanced fallback with Claude vs OpenAI context
    console.error(`${USE_CLAUDE ? 'Claude' : 'OpenAI'} API Error:`, error);
    
    let fallbackResponse = "I'd love to help you get an appointment scheduled. What service do you need?";
    
    const emotions = conversation?.emotionalState || [];
    if (emotions.includes('frustrated')) {
      fallbackResponse = "I understand this can be frustrating. Let me get you scheduled right away - what service do you need?";
    } else if (emotions.includes('urgent')) {
      fallbackResponse = "I can definitely help you with that urgent request. What service do you need today?";
    }
    
    return {
      response: fallbackResponse,
      action: 'continue',
      data: {}
    };
  }
}

async function bookAppointmentWithConfirmation(conversation, businessId, service, data) {
  console.log(`📅 Enhanced booking with confirmation - Data:`, data);
  return await bookAppointment(conversation, businessId, service, data);
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
        INSERT INTO notifications (business_id, type, title, message, data)
        VALUES ($1, $2, $3, $4, $5)
      `, [
        businessId,
        'new_booking',
        'New Appointment Booked',
        `Customer booked ${service.name} for ${appointmentTime.toLocaleDateString('en-US')} at ${appointmentTime.toLocaleTimeString('en-US')}`,
        JSON.stringify({
          appointmentId: appointmentId
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

// Enhanced Error Recovery - Graceful failure handling with personality
function handleConversationError(error, conversation, res) {
  console.error('🚨 Conversation error with recovery:', error);
  
  const personality = conversation?.personality || PERSONALITY_PROFILES.helpful;
  const emotions = conversation?.emotionalState || [];
  
  let errorMessage = 'I\'m having some technical difficulties, but I don\'t want to leave you hanging. Let me have someone call you back right away to make sure we take excellent care of you.';
  
  // Personality-based error messages
  if (personality.tone === 'casual and conversational') {
    errorMessage = 'Oops! I\'m having a technical moment here. Let me get someone to call you back so we can help you out properly!';
  } else if (emotions.includes('frustrated')) {
    errorMessage = 'I\'m really sorry - I know this is frustrating. Let me have someone call you back immediately to resolve this for you.';
  } else if (emotions.includes('urgent')) {
    errorMessage = 'I don\'t want to delay your urgent request with technical issues. Someone will call you back right away to help you.';
  }
  
  return sendTwiml(res, errorMessage);
}

// Connection Recovery - Handles dropped connections gracefully
function handleConnectionRecovery(callSid) {
  const conversation = conversations.get(callSid);
  if (conversation) {
    console.log(`🔄 Connection recovery for call ${callSid}`);
    // Mark conversation for callback
    conversation.needsCallback = true;
    conversation.disconnectTime = new Date();
    
    // Keep conversation in memory for 5 minutes in case they call back
    setTimeout(() => {
      if (conversations.has(callSid) && conversations.get(callSid).needsCallback) {
        console.log(`🗑️ Cleaning up abandoned conversation ${callSid}`);
        conversations.delete(callSid);
      }
    }, 5 * 60 * 1000);
  }
}

// Intelligent Conversation Cleanup - Prevents memory leaks
setInterval(() => {
  const now = new Date();
  let cleanedCount = 0;
  
  for (const [callSid, conversation] of conversations.entries()) {
    const conversationAge = now - conversation.startTime;
    const maxAge = 30 * 60 * 1000; // 30 minutes
    
    if (conversationAge > maxAge) {
      console.log(`🧹 Cleaning up old conversation ${callSid} (${Math.round(conversationAge / 60000)} minutes old)`);
      conversations.delete(callSid);
      cleanedCount++;
    }
  }
  
  if (cleanedCount > 0) {
    console.log(`🧹 Cleaned up ${cleanedCount} old conversations. Active conversations: ${conversations.size}`);
  }
}, 10 * 60 * 1000); // Run every 10 minutes

module.exports = { handleVoiceCall };