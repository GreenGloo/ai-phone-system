#!/usr/bin/env node

// Analysis of AI Phone System Conversation Patterns and Word Counts

const conversationExamples = {
  // Greeting Messages (Initial Call)
  greetings: [
    "Good morning! Thanks for calling Tom's Auto Repair. I'm here to help you with anything you need.",
    "Hi there! You've reached Tom's Auto Repair. I'd love to help you today - what can I do for you?",
    "Hello! Welcome to Tom's Auto Repair. I'm excited to help you out - what brings you to us today?"
  ],

  // Booking Confirmation Messages
  bookingConfirmations: [
    "Perfect! Let me get that booked for you",
    "Excellent! I'll take care of that right now",
    "Great choice! Let me secure that appointment",
    "Absolutely! I'll get this scheduled for you right away",
    "Fantastic! I'm excited to get this set up for you",
    "Perfect! Let me hook you up with that appointment"
  ],

  // Success Messages (After booking)
  successMessages: [
    "Fantastic! Your oil change appointment is all confirmed for tomorrow at 2:30 PM. We can't wait to help you out! See you then!",
    "Perfect! I've got you scheduled for tire rotation at Monday at 9:00 AM. We'll take great care of you. See you soon!",
    "Excellent! Your brake inspection appointment is confirmed for Friday at 11:00 AM. We look forward to helping you. See you then!"
  ],

  // Error Messages
  errorMessages: [
    "I really want to help you, but I'm having trouble accessing our services right now. Let me have someone call you back immediately to get this sorted out.",
    "Hmm, I'm having a technical hiccup with our services. Let me get someone to call you right back!",
    "I'm having trouble accessing our services at the moment. Let me have someone call you back to assist you properly.",
    "I'm really sorry - I want to get this booked for you but our system is having issues. Let me have someone call you back right away to confirm your appointment manually.",
    "I don't want to keep you waiting with technical issues. Let me have someone call you back immediately to help you."
  ],

  // Timeout Messages
  timeoutMessages: [
    "I'm having trouble hearing you. Could you please speak up, or I can have someone call you back to help?",
    "I want to make sure I help you properly - could you try speaking closer to your phone, or someone can call you back right away.",
    "I don't want to keep you waiting - please speak up or someone will call you back immediately.",
    "Sorry, I think there might be a connection issue. Could you try speaking louder, or we can call you right back?"
  ],

  // Conversation Turn Examples (Mid-conversation)
  conversationTurns: [
    "I'd be happy to help with that oil change. What day works best for you this week?",
    "Sure thing! I can get you scheduled for a tire rotation. How about tomorrow morning at 9 AM?",
    "Perfect! I have Friday at 2 PM available for your brake inspection. Does that work for you?",
    "Let me take care of that for you. I have Monday at 10:30 AM or Wednesday at 3 PM available. Which would you prefer?",
    "Absolutely, no problem! I can book your transmission service. Would next Tuesday at 1 PM work for you?",
    "I want to make sure I help you with exactly what you need. We offer: oil change, tire rotation, brake inspection, transmission service. Which of these sounds right for what you're looking for?"
  ],

  // AI Model Constraints
  tokenLimits: {
    claude: 150,
    openai: 200,
    note: "Balanced: fast but not truncated"
  }
};

function countWords(text) {
  return text.trim().split(/\s+/).length;
}

function analyzeConversations() {
  console.log('=== AI PHONE SYSTEM CONVERSATION ANALYSIS ===\n');

  // 1. Analyze greeting messages
  console.log('1. GREETING MESSAGES (Initial Call):');
  let greetingWords = [];
  conversationExamples.greetings.forEach((greeting, i) => {
    const wordCount = countWords(greeting);
    greetingWords.push(wordCount);
    console.log(`   ${i+1}. "${greeting}"`);
    console.log(`      → ${wordCount} words\n`);
  });

  const avgGreetingWords = Math.round(greetingWords.reduce((a,b) => a+b) / greetingWords.length);
  console.log(`   AVERAGE GREETING: ${avgGreetingWords} words`);
  console.log(`   RANGE: ${Math.min(...greetingWords)} - ${Math.max(...greetingWords)} words\n`);

  // 2. Analyze booking confirmations
  console.log('2. BOOKING CONFIRMATION MESSAGES:');
  let confirmationWords = [];
  conversationExamples.bookingConfirmations.forEach((msg, i) => {
    const wordCount = countWords(msg);
    confirmationWords.push(wordCount);
    console.log(`   ${i+1}. "${msg}"`);
    console.log(`      → ${wordCount} words\n`);
  });

  const avgConfirmationWords = Math.round(confirmationWords.reduce((a,b) => a+b) / confirmationWords.length);
  console.log(`   AVERAGE CONFIRMATION: ${avgConfirmationWords} words`);
  console.log(`   RANGE: ${Math.min(...confirmationWords)} - ${Math.max(...confirmationWords)} words\n`);

  // 3. Analyze success messages  
  console.log('3. SUCCESS MESSAGES (After Booking):');
  let successWords = [];
  conversationExamples.successMessages.forEach((msg, i) => {
    const wordCount = countWords(msg);
    successWords.push(wordCount);
    console.log(`   ${i+1}. "${msg}"`);
    console.log(`      → ${wordCount} words\n`);
  });

  const avgSuccessWords = Math.round(successWords.reduce((a,b) => a+b) / successWords.length);
  console.log(`   AVERAGE SUCCESS MESSAGE: ${avgSuccessWords} words`);
  console.log(`   RANGE: ${Math.min(...successWords)} - ${Math.max(...successWords)} words\n`);

  // 4. Analyze conversation turns
  console.log('4. CONVERSATION TURNS (Mid-conversation):');
  let turnWords = [];
  conversationExamples.conversationTurns.forEach((msg, i) => {
    const wordCount = countWords(msg);
    turnWords.push(wordCount);
    console.log(`   ${i+1}. "${msg}"`);
    console.log(`      → ${wordCount} words\n`);
  });

  const avgTurnWords = Math.round(turnWords.reduce((a,b) => a+b) / turnWords.length);
  console.log(`   AVERAGE CONVERSATION TURN: ${avgTurnWords} words`);
  console.log(`   RANGE: ${Math.min(...turnWords)} - ${Math.max(...turnWords)} words\n`);

  // 5. Analyze error messages
  console.log('5. ERROR MESSAGES:');
  let errorWords = [];
  conversationExamples.errorMessages.forEach((msg, i) => {
    const wordCount = countWords(msg);
    errorWords.push(wordCount);
    console.log(`   ${i+1}. "${msg}"`);
    console.log(`      → ${wordCount} words\n`);
  });

  const avgErrorWords = Math.round(errorWords.reduce((a,b) => a+b) / errorWords.length);
  console.log(`   AVERAGE ERROR MESSAGE: ${avgErrorWords} words`);
  console.log(`   RANGE: ${Math.min(...errorWords)} - ${Math.max(...errorWords)} words\n`);

  // 6. Calculate overall statistics
  console.log('=== OVERALL CONVERSATION STATISTICS ===\n');
  
  const allResponseWords = [
    ...greetingWords,
    ...confirmationWords, 
    ...successWords,
    ...turnWords,
    ...errorWords
  ];

  const overallAvg = Math.round(allResponseWords.reduce((a,b) => a+b) / allResponseWords.length);
  const overallMin = Math.min(...allResponseWords);
  const overallMax = Math.max(...allResponseWords);

  console.log(`AVERAGE AI RESPONSE: ${overallAvg} words`);
  console.log(`RESPONSE RANGE: ${overallMin} - ${overallMax} words`);
  console.log(`TOTAL RESPONSES ANALYZED: ${allResponseWords.length}`);

  // 7. Estimate conversation patterns
  console.log('\n=== CONVERSATION PATTERN ESTIMATES ===\n');

  const typicalConversationTurns = [
    { turn: 1, type: 'Greeting', words: avgGreetingWords },
    { turn: 2, type: 'Service inquiry response', words: avgTurnWords },
    { turn: 3, type: 'Time availability response', words: avgTurnWords },
    { turn: 4, type: 'Booking confirmation', words: avgConfirmationWords },
    { turn: 5, type: 'Success message', words: avgSuccessWords }
  ];

  console.log('TYPICAL SUCCESSFUL CONVERSATION:');
  let totalConversationWords = 0;
  typicalConversationTurns.forEach(turn => {
    console.log(`   Turn ${turn.turn}: ${turn.type} (~${turn.words} words)`);
    totalConversationWords += turn.words;
  });

  console.log(`\nTOTAL CONVERSATION LENGTH: ~${totalConversationWords} words`);
  console.log(`AVERAGE WORDS PER TURN: ~${Math.round(totalConversationWords / typicalConversationTurns.length)} words`);
  console.log(`TYPICAL CONVERSATION TURNS: ${typicalConversationTurns.length}`);

  // 8. Voice Generation Analysis
  console.log('\n=== VOICE GENERATION ANALYSIS ===\n');
  
  console.log(`AI MODEL TOKEN LIMITS:`);
  console.log(`   Claude: ${conversationExamples.tokenLimits.claude} tokens`);
  console.log(`   OpenAI: ${conversationExamples.tokenLimits.openai} tokens`);
  console.log(`   Strategy: ${conversationExamples.tokenLimits.note}`);

  // Estimate tokens per word (rough approximation: 1 word ≈ 1.3 tokens)
  const tokensPerWord = 1.3;
  const maxWordsFromClaude = Math.floor(conversationExamples.tokenLimits.claude / tokensPerWord);
  const maxWordsFromOpenAI = Math.floor(conversationExamples.tokenLimits.openai / tokensPerWord);

  console.log(`\nESTIMATED MAX RESPONSE LENGTH:`);
  console.log(`   Claude: ~${maxWordsFromClaude} words`);
  console.log(`   OpenAI: ~${maxWordsFromOpenAI} words`);

  // 9. ElevenLabs Usage Analysis
  console.log('\n=== VOICE SYNTHESIS ANALYSIS ===\n');
  
  console.log('TEXT-TO-SPEECH USAGE:');
  console.log(`   Average text per AI response: ${overallAvg} words`);
  console.log(`   Estimated speech duration: ${Math.ceil(overallAvg / 2.5)} seconds`);
  console.log(`   ElevenLabs API calls per conversation: ${typicalConversationTurns.length}`);
  console.log(`   Total text synthesized per conversation: ~${totalConversationWords} words`);

  console.log('\nVOICE CONSISTENCY:');
  console.log('   - System establishes voice mode (ElevenLabs vs Twilio) per conversation');
  console.log('   - Maintains consistent voice throughout conversation');
  console.log('   - Fallback to Twilio TTS if ElevenLabs fails');

  console.log('\n=== SUMMARY ===\n');
  console.log(`✅ Average AI response: ${overallAvg} words`);
  console.log(`✅ Typical conversation: ${typicalConversationTurns.length} turns, ${totalConversationWords} total words`);
  console.log(`✅ Response range: ${overallMin}-${overallMax} words`);
  console.log(`✅ Model constraints: ${conversationExamples.tokenLimits.claude}-${conversationExamples.tokenLimits.openai} tokens`);
  console.log(`✅ Estimated speech time: ${Math.ceil(totalConversationWords / 2.5)} seconds per conversation`);
}

if (require.main === module) {
  analyzeConversations();
}

module.exports = { conversationExamples, countWords, analyzeConversations };