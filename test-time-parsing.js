// Test the enhanced time parsing function

// Copy the parseTimePreference function here for testing
function parseTimePreference(speech) {
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
  ];
  
  for (const pattern of timePatterns) {
    const match = lower.match(pattern);
    if (match) {
      hour = parseInt(match[1]);
      if (match[3]) {
        period = match[3].toLowerCase().includes('p') ? 'pm' : 'am';
      } else if (match[2]) {
        period = match[2].toLowerCase().includes('p') ? 'pm' : 'am';
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
  
  // Check for specific days
  const days = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
  let dayFound = false;
  
  for (let i = 0; i < days.length; i++) {
    if (lower.includes(days[i])) {
      targetDate = getNextWeekday(now, i + 1);
      dayFound = true;
      console.log(`🗓️ Found day: ${days[i]}`);
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
  
  // Set the time
  targetDate.setHours(hour24, 0, 0, 0);
  
  // Create description
  const timeDisplay = targetDate.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true
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

function getNextWeekday(date, targetDay) {
  const currentDay = date.getDay();
  const daysUntilTarget = (targetDay - currentDay + 7) % 7;
  const targetDate = new Date(date);
  targetDate.setDate(date.getDate() + (daysUntilTarget === 0 ? 7 : daysUntilTarget));
  return targetDate;
}

// Test cases based on the actual customer input
console.log('🧪 TESTING TIME PARSING');
console.log('======================');

const testCases = [
  "Tuesday, 7 a.m.",
  "Note to not 2 p.m. 7 a.m.", 
  "Tuesday 7 AM",
  "Tomorrow at 9 AM",
  "Monday 2 PM",
  "Friday morning",
  "Wednesday afternoon",
  "7 o'clock",
  "2:30 PM"
];

testCases.forEach((testCase, index) => {
  console.log(`\n--- Test ${index + 1}: "${testCase}" ---`);
  const result = parseTimePreference(testCase);
  console.log(`Result: ${result.description}`);
  console.log(`Date: ${result.date.toISOString()}`);
});

process.exit(0);