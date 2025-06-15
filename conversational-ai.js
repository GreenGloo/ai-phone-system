// ULTRA-HUMAN CONVERSATIONAL AI BOOKING SYSTEM
// The most natural, empathetic, and intelligent AI assistant for service businesses
// Never misses a service call - converts every interaction into satisfied customers

require('dotenv').config();
const twilio = require('twilio');
const { Pool } = require('pg');
const { generateElevenLabsAudio, cleanupOldAudioFiles } = require('./elevenlabs-integration');
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

// Database-backed conversation storage for reliability and scale
// No more in-memory storage - survives server restarts and handles 1000s of businesses

// Get conversation from database - SECURE: Requires business_id for isolation
async function getConversation(callSid, businessId) {
  try {
    const result = await pool.query(
      'SELECT conversation_data FROM conversations WHERE call_sid = $1 AND business_id = $2',
      [callSid, businessId]
    );
    
    if (result.rows.length > 0) {
      console.log(`📖 Retrieved conversation for call ${callSid} (business: ${businessId})`);
      return result.rows[0].conversation_data;
    }
    
    console.log(`🆕 Creating new conversation for call ${callSid} (business: ${businessId})`);
    return null; // New conversation
  } catch (error) {
    console.error('❌ Error retrieving conversation:', error);
    return null; // Fallback to new conversation
  }
}

// Save conversation to database
async function saveConversation(callSid, businessId, conversation) {
  try {
    await pool.query(`
      INSERT INTO conversations (call_sid, business_id, conversation_data) 
      VALUES ($1, $2, $3)
      ON CONFLICT (call_sid) 
      DO UPDATE SET conversation_data = $3, updated_at = CURRENT_TIMESTAMP
    `, [callSid, businessId, conversation]);
    
    console.log(`💾 Saved conversation for call ${callSid}`);
  } catch (error) {
    console.error('❌ Error saving conversation:', error);
    // Don't fail the call if save fails - just log it
  }
}

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
  friendly: {
    name: "Friendly & Approachable", 
    tone: "warm and conversational",
    enthusiasm: 0.9,
    empathy: 0.9,
    speechPatterns: ["Sure thing", "Sounds great", "Perfect", "You got it"],
    confirmationStyle: "friendly and conversational"
  },
  helpful: {
    name: "Extremely Helpful",
    tone: "eager to assist",
    enthusiasm: 0.8,
    empathy: 0.9,
    speechPatterns: ["I'd love to help with that", "Let me take care of that for you", "Absolutely, no problem"],
    confirmationStyle: "thorough and reassuring"
  },
  urgent: {
    name: "Direct & Efficient",
    tone: "direct and efficient",
    enthusiasm: 0.6,
    empathy: 0.7,
    speechPatterns: ["Let's get this done", "I'll handle that right away", "Got it"],
    confirmationStyle: "quick and direct"
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
  let baseDelay = 0.2; // Reduced from 0.5 to 0.2 - prevent hangup perception
  
  // Much smaller adjustments for message complexity
  if (messageLength > 50) baseDelay += 0.1; // Reduced from 0.3
  if (messageLength > 100) baseDelay += 0.1; // Reduced from 0.5
  
  // Faster responses for all emotions
  if (emotion.includes('urgent')) baseDelay *= 0.3; // Even faster for urgent
  if (emotion.includes('frustrated')) baseDelay *= 0.4; // Much faster for frustrated
  if (emotion.includes('confused')) baseDelay += 0.1; // Only slightly longer
  
  // Minimal personality impact
  baseDelay *= (1 + personality.enthusiasm * 0.1); // Reduced from 0.3
  
  return Math.max(0.1, Math.min(0.5, baseDelay)); // Max 0.5 seconds to prevent hangup perception
}

// Parse customer timeframe requests into dates
function parseTimeframeToDate(timeframe) {
  if (!timeframe || typeof timeframe !== 'string') return null;
  
  const lower = timeframe.toLowerCase();
  const currentYear = new Date().getFullYear();
  const nextYear = currentYear + 1;
  
  // Month patterns
  const monthPatterns = {
    'january': 0, 'jan': 0,
    'february': 1, 'feb': 1,
    'march': 2, 'mar': 2,
    'april': 3, 'apr': 3,
    'may': 4,
    'june': 5, 'jun': 5,
    'july': 6, 'jul': 6,
    'august': 7, 'aug': 7,
    'september': 8, 'sep': 8, 'sept': 8,
    'october': 9, 'oct': 9,
    'november': 10, 'nov': 10,
    'december': 11, 'dec': 11
  };
  
  // Check for month mentions
  for (const [monthName, monthIndex] of Object.entries(monthPatterns)) {
    if (lower.includes(monthName)) {
      // Determine year - if month already passed this year, use next year
      const testDate = new Date(currentYear, monthIndex, 1);
      const targetYear = testDate < new Date() ? nextYear : currentYear;
      return new Date(targetYear, monthIndex, 1);
    }
  }
  
  // Check for "next year" or year numbers
  if (lower.includes('next year') || lower.includes((nextYear).toString())) {
    return new Date(nextYear, 0, 1); // January of next year
  }
  
  return null;
}

// COST-EFFICIENT: Get sample slots + ability to search specific dates
async function getAvailableSlots(businessId, requestedTimeframe = 'soon') {
  try {
    console.log(`📅 Getting calendar slots for business ${businessId} (${requestedTimeframe})`);
    
    // Check if calendar_slots table exists
    const tableCheck = await pool.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_name = 'calendar_slots'
      );
    `);
    
    if (!tableCheck.rows[0].exists) {
      console.error('📅 calendar_slots table does not exist');
      return [];
    }
    
    let slotsResult;
    
    if (requestedTimeframe === 'soon' || requestedTimeframe === 'near_future') {
      // Default: Load next 6 weeks only (cost-efficient)
      const sixWeeksOut = new Date();
      sixWeeksOut.setDate(sixWeeksOut.getDate() + 42);
      
      slotsResult = await pool.query(`
        SELECT slot_start, slot_end
        FROM calendar_slots
        WHERE business_id = $1
        AND is_available = true
        AND is_blocked = false
        AND slot_start >= NOW()
        AND slot_start <= $2
        ORDER BY slot_start
        LIMIT 200
      `, [businessId, sixWeeksOut.toISOString()]);
      
    } else {
      // Customer mentioned specific far-future date - targeted search
      const targetDate = parseTimeframeToDate(requestedTimeframe);
      if (targetDate) {
        const startOfMonth = new Date(targetDate.getFullYear(), targetDate.getMonth(), 1);
        const endOfMonth = new Date(targetDate.getFullYear(), targetDate.getMonth() + 1, 0);
        
        console.log(`🎯 Searching specific month: ${startOfMonth.toDateString()} to ${endOfMonth.toDateString()}`);
        
        slotsResult = await pool.query(`
          SELECT slot_start, slot_end
          FROM calendar_slots
          WHERE business_id = $1
          AND is_available = true
          AND is_blocked = false
          AND slot_start >= $2
          AND slot_start <= $3
          ORDER BY slot_start
          LIMIT 100
        `, [businessId, startOfMonth.toISOString(), endOfMonth.toISOString()]);
      } else {
        // Fallback to 6 weeks
        return getAvailableSlots(businessId, 'soon');
      }
    }
    
    if (slotsResult.rows.length === 0) {
      console.log('📅 No pre-generated slots found - business may need calendar setup');
      return [];
    }
    
    // Check against existing appointments
    const existingAppointments = await pool.query(`
      SELECT start_time, end_time 
      FROM appointments 
      WHERE business_id = $1 
      AND status IN ('scheduled', 'confirmed')
      AND start_time >= NOW()
    `, [businessId]);
    
    const bookedTimes = existingAppointments.rows.map(apt => ({
      start: new Date(apt.start_time),
      end: new Date(apt.end_time)
    }));
    
    // Filter out slots that conflict with appointments
    const availableSlots = slotsResult.rows
      .filter(slot => {
        const slotStart = new Date(slot.slot_start);
        const slotEnd = new Date(slot.slot_end);
        
        return !bookedTimes.some(booked => 
          (slotStart < booked.end && slotEnd > booked.start)
        );
      })
      .map(slot => {
        const slotStart = new Date(slot.slot_start);
        const now = new Date();
        const daysDiff = Math.floor((slotStart - now) / (1000 * 60 * 60 * 24));
        
        let dayLabel;
        if (daysDiff === 0) dayLabel = 'today';
        else if (daysDiff === 1) dayLabel = 'tomorrow';
        else dayLabel = slotStart.toLocaleDateString('en-US', { 
          weekday: 'long', 
          month: 'short', 
          day: 'numeric',
          timeZone: 'America/New_York'  // Tom's Garage timezone
        });
        
        const timeStr = slotStart.toLocaleTimeString('en-US', { 
          hour: 'numeric', 
          minute: '2-digit',
          hour12: true,
          timeZone: 'America/New_York'  // Tom's Garage timezone
        });
        
        return {
          day: dayLabel,
          time: timeStr,
          datetime: slotStart.toISOString()
        };
      });
    
    console.log(`📅 Found ${availableSlots.length} available slots from pre-generated calendar`);
    console.log(`📅 Sample slots for Claude:`, availableSlots.slice(0, 5).map(s => `${s.day} ${s.time}`));
    console.log(`📅 Date range: ${availableSlots[0]?.day} to ${availableSlots[availableSlots.length-1]?.day}`);
    return availableSlots;
    
  } catch (error) {
    console.error('❌ Error getting calendar slots:', error);
    console.error('❌ Error details:', error.message);
    console.error('❌ Error stack:', error.stack);
    
    // Fallback: try with smaller date range if full query fails
    try {
      console.log('🔄 Attempting fallback with 6-month range...');
      const sixMonthsOut = new Date();
      sixMonthsOut.setMonth(sixMonthsOut.getMonth() + 6);
      
      const fallbackResult = await pool.query(`
        SELECT slot_start, slot_end
        FROM calendar_slots
        WHERE business_id = $1
        AND is_available = true
        AND is_blocked = false
        AND slot_start >= NOW()
        AND slot_start <= $2
        ORDER BY slot_start
        LIMIT 1000
      `, [businessId, sixMonthsOut.toISOString()]);
      
      if (fallbackResult.rows.length > 0) {
        console.log(`✅ Fallback successful: ${fallbackResult.rows.length} slots found`);
        return fallbackResult.rows.map(slot => {
          const slotDate = new Date(slot.slot_start);
          return {
            day: slotDate.toLocaleDateString('en-US', { 
              weekday: 'long', 
              month: 'long', 
              day: 'numeric',
              year: slotDate.getFullYear() !== new Date().getFullYear() ? 'numeric' : undefined,
              timeZone: 'America/New_York'  // Tom's Garage timezone
            }),
            time: slotDate.toLocaleTimeString('en-US', { 
              hour: 'numeric', 
              minute: '2-digit', 
              hour12: true,
              timeZone: 'America/New_York'  // Tom's Garage timezone
            }),
            datetime: slot.slot_start
          };
        });
      }
    } catch (fallbackError) {
      console.error('❌ Fallback also failed:', fallbackError.message);
    }
    
    return [];
  }
}

// NO MORE FAKE SLOTS - REAL CALENDAR ONLY

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

async function handleInitialCall(res, business, callSid, from, businessId) {
  // DEBUG: Log business voice configuration
  console.log(`🏢 Business Voice Config - ID: ${business.ai_voice_id}, Personality: ${business.ai_personality}`);
  
  // Choose personality based on business configuration
  const personality = PERSONALITY_PROFILES[business.ai_personality] || PERSONALITY_PROFILES.helpful;
  
  // Start enhanced conversation memory in database
  const conversation = {
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
  };
  
  // Save to database
  await saveConversation(callSid, businessId, conversation);
  
  // Create warm, personalized greeting
  const timeOfDay = getTimeOfDay();
  const greetingVariations = [
    `Good ${timeOfDay}! Thanks for calling ${business.name}. I'm here to help you with anything you need.`,
    `Hi there! You've reached ${business.name}. I'd love to help you today - what can I do for you?`,
    `Hello! Welcome to ${business.name}. I'm excited to help you out - what brings you to us today?`
  ];
  
  const greeting = greetingVariations[Math.floor(Math.random() * greetingVariations.length)];
  
  const twiml = new twilio.twiml.VoiceResponse();
  await generateVoiceResponse(greeting, conversation.personality, conversation.emotionalState, business.ai_voice_id, twiml);
  
  twiml.gather({
    input: 'speech',
    timeout: 30,
    speechTimeout: 'auto',
    action: `/voice/incoming/${businessId}`,
    method: 'POST'
  });
  
  await generateVoiceResponse('I didn\'t catch that - let me have someone call you right back to make sure we take great care of you.', conversation.personality, conversation.emotionalState, business.ai_voice_id, twiml);
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

// Enhanced voice generation with ElevenLabs support
async function generateVoiceResponse(text, personality, emotions, businessVoice = 'Polly.Joanna-Neural', twiml) {
  const useElevenLabs = process.env.ELEVENLABS_API_KEY && process.env.USE_ELEVENLABS !== 'false';
  
  console.log(`🎤 Voice Generation - Text: "${text.substring(0, 50)}..."`);
  console.log(`🎤 Voice ID: ${businessVoice}, ElevenLabs: ${useElevenLabs ? 'YES' : 'NO'}`);
  
  if (useElevenLabs) {
    try {
      const audioResult = await generateElevenLabsAudio(text, businessVoice);
      
      if (audioResult.success) {
        console.log(`🎵 Using ElevenLabs audio: ${audioResult.filename}`);
        twiml.play(audioResult.url);
        return true; // Indicates ElevenLabs was used
      } else {
        console.log(`⚠️ ElevenLabs failed, falling back to Twilio TTS: ${audioResult.error}`);
      }
    } catch (error) {
      console.log(`⚠️ ElevenLabs error, falling back to Twilio TTS: ${error.message}`);
    }
  }
  
  // Fallback to Twilio TTS
  const voiceSettings = getVoiceSettings(personality, emotions, businessVoice);
  console.log(`🔄 Using Twilio TTS fallback: ${JSON.stringify(voiceSettings)}`);
  twiml.say(text, voiceSettings);
  return false; // Indicates Twilio TTS was used
}

// Voice Settings - Matches voice characteristics to personality and emotions (Twilio TTS fallback)
function getVoiceSettings(personality, emotions, businessVoice = 'Polly.Joanna-Neural') {
  // Ensure we have a valid voice, fallback to default if not
  const voiceToUse = businessVoice || 'Polly.Joanna-Neural';
  
  // DEBUG: Log voice selection for troubleshooting  
  console.log(`🎤 Voice Settings - Input: ${businessVoice}, Using: ${voiceToUse}`);
  console.log(`🎤 Final TwiML voice setting: ${JSON.stringify({voice: voiceToUse, rate: '1.0'})}`);
  
  // TEST: Try basic male voice if Matthew isn't working
  if (voiceToUse === 'Polly.Matthew') {
    console.log(`🧪 TESTING: Trying basic 'man' voice instead of 'Polly.Matthew'`);
    const settings = {
      voice: 'man', // Try Twilio's basic male voice
      rate: '1.0'
    };
    return settings;
  }
  
  const settings = {
    voice: voiceToUse, // Use business-configured voice or Matthew fallback
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

// Dynamic Service Matching using AI-generated keywords
async function intelligentServiceMatching(services, requestedService, businessId) {
  if (!requestedService || services.length === 0) {
    return { service: services[0], shouldListServices: false }; // Default fallback
  }
  
  const requested = requestedService.toLowerCase().trim();
  console.log(`🔍 Matching "${requested}" against ${services.length} services for business ${businessId}`);
  
  // Exact match first
  let match = services.find(s => s.name.toLowerCase() === requested);
  if (match) {
    console.log(`✅ EXACT MATCH: ${match.name}`);
    return { service: match, shouldListServices: false };
  }
  
  // Partial match on service names
  match = services.find(s => 
    s.name.toLowerCase().includes(requested) || 
    requested.includes(s.name.toLowerCase())
  );
  if (match) {
    console.log(`✅ PARTIAL MATCH: ${match.name}`);
    return { service: match, shouldListServices: false };
  }
  
  // Dynamic keyword matching using AI-generated keywords from database
  try {
    console.log(`🔍 Checking AI-generated keywords for business ${businessId}`);
    
    // Get all keywords for this business's services
    const keywordResult = await pool.query(`
      SELECT sk.service_id, sk.keyword, sk.confidence_score, st.name as service_name
      FROM service_keywords sk
      JOIN service_types st ON sk.service_id = st.id
      WHERE sk.business_id = $1 
      AND st.is_active = true
      ORDER BY sk.confidence_score DESC
    `, [businessId]);
    
    console.log(`📚 Found ${keywordResult.rows.length} AI-generated keywords`);
    
    // Check if any keywords match the requested service
    const keywordMatches = keywordResult.rows.filter(row => 
      requested.includes(row.keyword.toLowerCase()) || 
      row.keyword.toLowerCase().includes(requested)
    );
    
    if (keywordMatches.length > 0) {
      // Sort by confidence score and get the best match
      keywordMatches.sort((a, b) => b.confidence_score - a.confidence_score);
      const bestMatch = keywordMatches[0];
      
      // Find the actual service object
      match = services.find(s => s.id === bestMatch.service_id);
      if (match) {
        console.log(`✅ AI KEYWORD MATCH: "${requested}" → "${bestMatch.keyword}" → ${match.name} (confidence: ${bestMatch.confidence_score})`);
        return { service: match, shouldListServices: false };
      }
    }
    
  } catch (error) {
    console.error('❌ Error in dynamic keyword matching:', error);
    // Continue to fallback logic
  }
  
  // If we get here, no match was found - suggest listing services
  console.log(`❓ NO MATCH FOUND for "${requestedService}" - will list available services`);
  
  // Smart fallback - prefer consultation/diagnostic over emergency services
  const consultationService = services.find(s => 
    s.name.toLowerCase().includes('consultation') || 
    s.name.toLowerCase().includes('diagnostic') ||
    s.name.toLowerCase().includes('inspection')
  );
  
  if (consultationService) {
    console.log(`🔄 SMART FALLBACK: Using consultation/diagnostic service: ${consultationService.name}`);
    return { service: consultationService, shouldListServices: true };
  }
  
  console.log(`⚠️ ULTIMATE FALLBACK: Using first service: ${services[0].name}`);
  return { service: services[0], shouldListServices: true }; // Ultimate fallback with service listing
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

function generateBookingSuccessMessage(data, personality, emotions, service, conversation) {
  // Use stored customer name from conversation if available
  const customerName = conversation?.customerInfo?.name || data.customerName;
  const namePhrase = customerName ? `, ${customerName}` : '';
  const timePhrase = data.suggestedTime || 'your selected time';
  
  if (emotions.includes('happy') || emotions.includes('excited')) {
    return `Fantastic${namePhrase}! Your ${service.name} appointment is all confirmed for ${timePhrase}. We can't wait to help you out! See you then!`;
  } else if (emotions.includes('urgent')) {
    return `Perfect${namePhrase}! I've got you scheduled for ${service.name} at ${timePhrase}. We'll take great care of you. See you soon!`;
  } else if (personality.tone === 'casual and conversational') {
    return `All set${namePhrase}! You're booked for ${service.name} on ${timePhrase}. We'll see you then!`;
  }
  
  return `Excellent${namePhrase}! Your ${service.name} appointment is confirmed for ${timePhrase}. We look forward to helping you. See you then!`;
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
  // DEBUG: Log business voice configuration for ongoing conversation
  console.log(`🏢 Conversation Voice Config - ID: ${business.ai_voice_id}, Personality: ${business.ai_personality}`);
  
  // Get conversation from database - SECURE: With business isolation
  let conversation = await getConversation(callSid, businessId);
  
  // If no conversation exists, create new one
  if (!conversation) {
    conversation = {
      business: business,
      customerPhone: from,
      conversationHistory: [],
      customerInfo: {},
      personality: PERSONALITY_PROFILES[business.ai_personality] || PERSONALITY_PROFILES.helpful,
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
  }
  
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
  
  // Smart availability loading based on customer request
  let availability;
  let needsExtendedSearch = false;
  
  // Check if customer mentioned far-future dates
  if (speech.toLowerCase().includes('february') || speech.toLowerCase().includes('feb') || 
      speech.toLowerCase().includes('next year') || speech.toLowerCase().includes('2026') ||
      speech.toLowerCase().includes('march') || speech.toLowerCase().includes('april') ||
      speech.toLowerCase().includes('annual') || speech.toLowerCase().includes('yearly')) {
    console.log('🎯 Customer mentioned far-future date - using targeted search');
    needsExtendedSearch = true;
    availability = await getAvailableSlots(businessId, speech); // Pass speech for date parsing
  } else {
    // Default: load next 6 weeks (fast and cost-efficient)
    availability = await getAvailableSlots(businessId, 'soon');
  }
  
  console.log(`📅 Found ${availability.length} available slots`);
  
  // Get AI response with appropriate context
  const aiResponse = await getHumanLikeResponse(speech, conversation, business, services, availability, needsExtendedSearch);
  console.log(`🤖 Human-like AI Response:`, JSON.stringify(aiResponse, null, 2));
  
  // Add AI response to history
  conversation.conversationHistory.push({
    speaker: 'assistant',
    message: aiResponse.response,
    timestamp: new Date(),
    action: aiResponse.action,
    data: aiResponse.data
  });
  
  // Save updated conversation to database
  await saveConversation(callSid, businessId, conversation);
  
  const twiml = new twilio.twiml.VoiceResponse();
  let shouldContinue = true;
  
  // Handle the AI's decision
  console.log(`🔍 Checking AI action: "${aiResponse.action}"`);
  console.log(`🔍 Has data: ${!!aiResponse.data}`);
  
  if (aiResponse.action === 'list_services' || aiResponse.data?.shouldListServices) {
    console.log(`📋 AI requested to list services for customer`);
    
    // Create a natural service listing
    const serviceList = services.map(s => s.name).join(', ');
    const serviceListingMessage = `I want to make sure I help you with exactly what you need. We offer: ${serviceList}. Which of these sounds right for what you're looking for?`;
    
    // Apply natural speech enhancement to service listing
    const enhancedServiceListing = enhanceNaturalSpeech(serviceListingMessage, conversation.personality, conversation.emotionalState);
    const serviceListingVoiceSettings = getVoiceSettings(conversation.personality, conversation.emotionalState, business.ai_voice_id);
    twiml.say(enhancedServiceListing, serviceListingVoiceSettings);
    
    // Continue conversation to get service selection
    shouldContinue = true;
  } else if (aiResponse.action === 'book_appointment' && aiResponse.data) {
    console.log(`📞 INTELLIGENT BOOKING INITIATED - Data:`, aiResponse.data);
    
    // Intelligent booking confirmation based on personality and emotional state
    const confirmationMessage = generateBookingConfirmation(aiResponse.data, conversation.personality, conversation.emotionalState);
    console.log(`🎯 Booking confirmation: "${confirmationMessage}"`);
    
    // Apply natural speech enhancement to confirmation
    const enhancedConfirmation = enhanceNaturalSpeech(confirmationMessage, conversation.personality, conversation.emotionalState);
    const confirmationVoiceSettings = getVoiceSettings(conversation.personality, conversation.emotionalState, business.ai_voice_id);
    twiml.say(enhancedConfirmation, confirmationVoiceSettings);
    
    // Process the booking with enhanced error handling
    try {
      if (services.length === 0) {
        console.error('❌ No services found for business');
        const errorMessage = generateServiceErrorMessage(conversation.personality, conversation.emotionalState);
        const errorVoiceSettings = getVoiceSettings(conversation.personality, conversation.emotionalState, business.ai_voice_id);
        twiml.say(errorMessage, errorVoiceSettings);
        shouldContinue = false;
      } else {
        // Dynamic service matching using AI-generated keywords
        console.log(`🔍 AI RESPONSE DATA:`, JSON.stringify(aiResponse.data, null, 2));
        console.log(`🔍 AI requested service: "${aiResponse.data.service}"`);
        console.log(`🔍 Available services:`, services.map(s => s.name));
        const matchResult = await intelligentServiceMatching(services, aiResponse.data.service, businessId);
        const selectedService = matchResult.service;
        console.log(`🎯 SERVICE MATCH RESULT: "${selectedService.name}" (ID: ${selectedService.id})`);
        
        if (matchResult.shouldListServices) {
          console.log(`📋 Service match uncertain - should list services to customer`);
        }
        
        const booking = await bookAppointmentWithConfirmation(conversation, businessId, selectedService, aiResponse.data);
        console.log(`📞 Enhanced booking result:`, booking);
        
        if (booking.success) {
          const successMessage = generateBookingSuccessMessage(aiResponse.data, conversation.personality, conversation.emotionalState, selectedService, conversation);
          const enhancedSuccess = enhanceNaturalSpeech(successMessage, conversation.personality, conversation.emotionalState);
          const successVoiceSettings = getVoiceSettings(conversation.personality, conversation.emotionalState, business.ai_voice_id);
          twiml.say(enhancedSuccess, successVoiceSettings);
          twiml.hangup();
          shouldContinue = false;
          // Conversation completed successfully - will be auto-cleaned up
        } else {
          console.error('❌ Booking failed:', booking.error);
          const failureMessage = generateBookingFailureMessage(conversation.personality, conversation.emotionalState);
          const failureVoiceSettings = getVoiceSettings(conversation.personality, conversation.emotionalState, business.ai_voice_id);
          twiml.say(failureMessage, failureVoiceSettings);
          shouldContinue = false;
        }
      }
    } catch (error) {
      console.error('❌ Booking error:', error);
      const errorMessage = generateSystemErrorMessage(conversation.personality, conversation.emotionalState);
      const systemErrorVoiceSettings = getVoiceSettings(conversation.personality, conversation.emotionalState, business.ai_voice_id);
      twiml.say(errorMessage, systemErrorVoiceSettings);
      shouldContinue = false;
    }
  } else {
    console.log(`💬 Continuing conversation with: "${aiResponse.response}"`);
    
    // Apply natural speech enhancements
    const enhancedResponse = enhanceNaturalSpeech(aiResponse.response, conversation.personality, conversation.emotionalState);
    console.log(`🎭 Enhanced speech: "${enhancedResponse}"`);
    
    // REDUCED PAUSE: Prevent customers thinking AI hung up
    const responseDelay = calculateResponseTiming(speech.length, conversation.emotionalState, conversation.personality);
    console.log(`⏱️ Natural response delay: ${responseDelay}s`);
    
    // Keep pause very short to prevent hangup perception
    if (responseDelay > 0.3) {
      twiml.pause({ length: Math.min(0.3, responseDelay - 0.2) }); // Max 0.3 second pause
    }
    
    // Say the enhanced response with personality-matched voice settings
    const voiceSettings = getVoiceSettings(conversation.personality, conversation.emotionalState, business.ai_voice_id);
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
    
    const timeoutMessageVoiceSettings = getVoiceSettings(conversation.personality, conversation.emotionalState, business.ai_voice_id);
    twiml.say(timeoutMessage, timeoutMessageVoiceSettings);
    twiml.hangup();
  }
  
  return res.type('text/xml').send(twiml.toString());
}

async function getHumanLikeResponse(speech, conversation, business, services, availability) {
  // Simplified approach based on working examples
  const recentHistory = conversation.conversationHistory.slice(-3).map(h => 
    `${h.speaker}: ${h.message}`
  ).join('\n');
  
  // Show ALL available slots - full calendar range
  const availableSlots = availability.map(slot => 
    `${slot.day} ${slot.time} (${slot.datetime})`
  ).join(', ');
  
  // Get customer name if available
  const customerName = conversation.customerInfo?.name || null;
  const hasCustomerName = !!customerName;
  
  // Create service list for when needed
  const servicesList = services.map(s => s.name).join(', ');
  
  // Claude-optimized prompt - superior instruction following and context understanding
  const currentDate = new Date();
  const todayStr = currentDate.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
  const currentTime = currentDate.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
  
  const claudePrompt = `You are an expert booking assistant for ${business.name}, a professional automotive garage.

CURRENT DATE/TIME: ${todayStr} at ${currentTime}

CUSTOMER INPUT: "${speech}"

CUSTOMER NAME: ${hasCustomerName ? customerName : 'NOT COLLECTED YET'}

RECENT CONVERSATION:
${recentHistory}

AVAILABLE SERVICES: ${servicesList}

AVAILABLE APPOINTMENT SLOTS (NEXT FEW DAYS + WEEKS + MONTHS): ${availableSlots}

BOOKING RANGE: We have appointments available from ${todayStr} through ${new Date(availability[availability.length-1]?.datetime || new Date()).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })} - CUSTOMERS CAN BOOK WEEKS OR MONTHS IN ADVANCE!

CRITICAL INSTRUCTIONS:
• ALWAYS collect customer name early in conversation if not already collected
• PRESERVE CONTEXT: If customer already selected a service, NEVER ask for service again - just find times for that service
• When customer asks for "different day" or "next Tuesday", keep their previously selected service
• Speech recognition errors: "CID" = "oil change", "old change" = "oil change"  
• If customer requests a service that doesn't clearly match our available services, politely ask what they need and offer to list our services
• When listing services, present them in a natural, conversational way
• ANY clear service mention = immediately offer specific times and push for booking
• Customer saying "yes"/"okay"/"sounds good"/"that works" = book the appointment NOW with action: "book_appointment"
• ONLY suggest times from the AVAILABLE APPOINTMENT SLOTS list above - never make up dates!
• When offering times, ALWAYS use the exact appointmentDatetime from the available slots
• Be conversational but ALWAYS drive toward booking an appointment

NAME COLLECTION EXAMPLES:
Customer: "I need service" → "I'd be happy to help! Could I get your name first?" 
Customer: "My name is John" → "Thanks John! What service can I help you with today?"

SERVICE CLARIFICATION EXAMPLES:
Customer: unclear service request → "I want to make sure I help you with exactly what you need. We offer: [list services]. Which of these sounds right for you?"
Customer: "I don't know" → "No problem! Let me tell you what we do: [list services]. What's going on with your vehicle?"

BOOKING EXAMPLES:
Customer: "oil change" → action: "continue", offer specific times like "I can get you in tomorrow at 4:00 PM or Sunday at 10:00 AM"
Customer: "yes" or "4 PM works" → action: "book_appointment" with exact appointmentDatetime like "2025-06-14T16:00:00.000Z"

RESPONSE FORMAT (JSON only):
{
  "response": "Natural, helpful response that collects name and/or offers services/times",
  "action": "continue" or "book_appointment" or "list_services",
  "data": {
    "customerName": "John" (if collected),
    "service": "oil change",
    "suggestedTime": "tomorrow 4:00 PM", 
    "appointmentDatetime": "2025-06-14T16:00:00.000Z",
    "shouldListServices": true (if service unclear)
  }
}`;

  const openaiPrompt = `You are a booking assistant for ${business.name}, an automotive garage.

Customer said: "${speech}"
Customer name: ${hasCustomerName ? customerName : 'NOT COLLECTED YET'}

Conversation history:
${recentHistory}

Available services: ${servicesList}
Available times: ${availableSlots}

BOOKING RULES:
1. Always collect customer name early if not already collected
2. If customer requests unclear service, list available services naturally
3. If customer mentions ANY clear service need -> offer specific times and book immediately
4. If customer says "yes", "sounds good", "okay" -> book the appointment  
5. Assume unclear speech like "CID" means "oil change" 
6. Be conversational but drive toward booking

Your response should:
- Collect name if needed
- List services if service unclear
- Offer specific booking times
- Book the appointment when confirmed

Respond in JSON:
{
  "response": "your reply",
  "action": "continue" or "book_appointment" or "list_services", 
  "data": {
    "customerName": "John" (if collected),
    "service": "oil change",
    "suggestedTime": "today 2:00 PM",
    "appointmentDatetime": "2025-06-13T14:00:00Z",
    "shouldListServices": true (if service unclear)
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
    
    // Store customer name if collected
    if (response.data?.customerName && !conversation.customerInfo?.name) {
      conversation.customerInfo.name = response.data.customerName;
      console.log(`👤 Customer name collected: ${response.data.customerName}`);
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
    
    // Use customer name from conversation if available
    const customerName = conversation.customerInfo?.name || data.customerName || 'Customer';
    
    const result = await pool.query(`
      INSERT INTO appointments (
        business_id, customer_name, customer_phone, service_type_id, service_name,
        issue_description, start_time, end_time, duration_minutes, estimated_revenue,
        booking_source, status
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
      RETURNING id
    `, [
      businessId,
      customerName,
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

// Database Conversation Cleanup - Business-isolated and optimized for Railway free tier
// Automatically removes old conversations to keep storage minimal
setInterval(async () => {
  try {
    const result = await pool.query(`
      DELETE FROM conversations 
      WHERE created_at < NOW() - INTERVAL '30 minutes'
      RETURNING call_sid, business_id
    `);
    
    if (result.rows.length > 0) {
      console.log(`🧹 Cleaned up ${result.rows.length} old conversations from database`);
      // Log by business for security audit
      const byBusiness = result.rows.reduce((acc, row) => {
        acc[row.business_id] = (acc[row.business_id] || 0) + 1;
        return acc;
      }, {});
      console.log(`🔒 Cleanup by business:`, byBusiness);
    }
  } catch (error) {
    console.error('❌ Error cleaning up conversations:', error);
  }
}, 5 * 60 * 1000); // Run every 5 minutes - more frequent for free tier

module.exports = { handleVoiceCall };