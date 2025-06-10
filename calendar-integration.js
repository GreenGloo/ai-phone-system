// Simple Calendar Integration using OAuth
const { google } = require('googleapis');

class SimpleCalendarManager {
  constructor() {
    this.calendar = google.calendar('v3');
    this.oauth2Client = null;
    this.calendarId = 'primary';
  }

  // Initialize with OAuth credentials
  async initializeAuth() {
    try {
      // For testing, we'll use OAuth with your personal Google account
      this.oauth2Client = new google.auth.OAuth2(
        process.env.GOOGLE_CLIENT_ID,
        process.env.GOOGLE_CLIENT_SECRET,
        process.env.GOOGLE_REDIRECT_URI || 'http://localhost:3000/auth/callback'
      );

      // Set refresh token (we'll get this from OAuth flow)
      if (process.env.GOOGLE_REFRESH_TOKEN) {
        this.oauth2Client.setCredentials({
          refresh_token: process.env.GOOGLE_REFRESH_TOKEN
        });
        
        google.options({ auth: this.oauth2Client });
        console.log('✅ Google Calendar authenticated with OAuth');
        return true;
      } else {
        console.log('⚠️ Need to complete OAuth flow first');
        return false;
      }
    } catch (error) {
      console.error('❌ Calendar auth failed:', error);
      return false;
    }
  }

  // Generate OAuth URL for initial setup
  getAuthUrl() {
    const scopes = ['https://www.googleapis.com/auth/calendar'];
    return this.oauth2Client.generateAuthUrl({
      access_type: 'offline',
      scope: scopes,
      prompt: 'consent'
    });
  }

  // Complete OAuth flow
  async completeAuth(code) {
    try {
      const { tokens } = await this.oauth2Client.getToken(code);
      this.oauth2Client.setCredentials(tokens);
      
      console.log('Refresh Token:', tokens.refresh_token);
      console.log('Add this to your environment variables as GOOGLE_REFRESH_TOKEN');
      
      return tokens;
    } catch (error) {
      console.error('Error completing auth:', error);
      throw error;
    }
  }

  // Mock calendar functions for now (until OAuth is set up)
  async getAvailableSlots(date, duration = 60) {
    // For testing, return mock available slots
    const mockSlots = [
      { display: '9:00 AM', start: new Date(date.setHours(9, 0, 0, 0)) },
      { display: '10:30 AM', start: new Date(date.setHours(10, 30, 0, 0)) },
      { display: '2:00 PM', start: new Date(date.setHours(14, 0, 0, 0)) },
      { display: '3:30 PM', start: new Date(date.setHours(15, 30, 0, 0)) },
      { display: '5:00 PM', start: new Date(date.setHours(17, 0, 0, 0)) }
    ];

    console.log('📅 Returning mock available slots:', mockSlots.map(s => s.display));
    return mockSlots;
  }

  async bookAppointment(customerInfo, appointmentTime, serviceType = 'Service Call') {
    // For testing, simulate successful booking
    console.log('🗓️ MOCK BOOKING:', {
      customer: customerInfo.name,
      phone: customerInfo.phone,
      time: appointmentTime,
      service: serviceType
    });

    return {
      success: true,
      eventId: 'mock_event_' + Date.now(),
      eventLink: 'https://calendar.google.com/calendar/mock_event',
      appointmentTime: appointmentTime.toLocaleString('en-US', {
        weekday: 'long',
        month: 'long',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
        hour12: true
      })
    };
  }

  async getNextEmergencySlot() {
    // Return slot in 1 hour for emergencies
    const emergencyTime = new Date();
    emergencyTime.setHours(emergencyTime.getHours() + 1);
    emergencyTime.setMinutes(0, 0, 0);

    return {
      start: emergencyTime,
      display: emergencyTime.toLocaleTimeString('en-US', {
        hour: 'numeric',
        minute: '2-digit',
        hour12: true
      })
    };
  }
}

// Simple prompt for calendar-aware conversations
const createCalendarAwarePrompt = (businessConfig, availableSlots, isEmergency = false) => `
You are Sarah, a professional receptionist for ${businessConfig.businessName}.

APPOINTMENT SCHEDULING:
${isEmergency ? 
  `EMERGENCY: I can get you in within the hour - next available is ${availableSlots?.[0]?.display || 'very soon'}.` :
  `Available appointments today: ${availableSlots?.map(slot => slot.display).join(', ') || '9:00 AM, 2:00 PM, 5:00 PM'}`
}

BOOKING PROCESS:
1. Ask if emergency or regular service
2. Get customer name and phone number
3. Brief description of the issue
4. Offer specific time slots from available times
5. When they pick a time, say "Perfect! Let me book that for you right now"
6. Confirm the appointment details

EMERGENCY INDICATORS:
- Water damage, flooding, burst pipes
- No heat in winter, no AC in extreme heat  
- Gas leaks or electrical safety issues
- Sewage backup or major blockages

SAMPLE CONVERSATION:
Customer: "I need a plumber"
You: "I can help! Is this an emergency, or would you like to schedule a regular service call?"
Customer: "My toilet is clogged"
You: "I can get you scheduled today. I have appointments at 2:00 PM, 3:30 PM, or 5:00 PM. What works best?"
Customer: "2:00 PM"
You: "Perfect! Let me book that for you right now. Can I get your name and phone number?"

Always be confident about booking. Never say "someone will call you back" - you handle the scheduling.

Be friendly, efficient, and always close the appointment booking.
`;

module.exports = { SimpleCalendarManager, createCalendarAwarePrompt };
