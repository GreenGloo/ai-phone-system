// Enhanced backend with built-in calendar database
require('dotenv').config();
const express = require('express');
const twilio = require('twilio');
const OpenAI = require('openai');
const cors = require('cors');
const path = require('path');

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cors());
app.use(express.static(path.join(__dirname, 'public')));

// Initialize services
const twilioClient = twilio(process.env.TWILIO_SID, process.env.TWILIO_TOKEN);
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// In-memory database (replace with PostgreSQL in production)
const appointments = new Map();
const callLogs = new Map();
const notifications = [];

// Business configuration
const businessConfig = {
  businessName: "CallCatcher Demo",
  ownerName: "Business Owner",
  ownerPhone: process.env.OWNER_PHONE || "+15551234567",
  businessHours: { start: 8, end: 18 }, // 8 AM to 6 PM
  timezone: "America/New_York",
  services: {
    emergency: { rate: 150, duration: 60 },
    regular: { rate: 100, duration: 90 },
    consultation: { rate: 75, duration: 30 }
  }
};

// Calendar Manager Class
class CalendarManager {
  // Get available slots for a specific date
  getAvailableSlots(date, duration = 60) {
    const dayAppointments = this.getDayAppointments(date);
    const slots = [];
    
    for (let hour = businessConfig.businessHours.start; hour < businessConfig.businessHours.end; hour++) {
      for (let minute = 0; minute < 60; minute += 30) {
        const slotStart = new Date(date);
        slotStart.setHours(hour, minute, 0, 0);
        
        const slotEnd = new Date(slotStart);
        slotEnd.setMinutes(slotEnd.getMinutes() + duration);
        
        // Check if slot conflicts with existing appointments
        const hasConflict = dayAppointments.some(apt => {
          const aptStart = new Date(apt.startTime);
          const aptEnd = new Date(apt.endTime);
          return (slotStart < aptEnd && slotEnd > aptStart);
        });
        
        if (!hasConflict && slotEnd.getHours() <= businessConfig.businessHours.end) {
          slots.push({
            start: slotStart,
            end: slotEnd,
            display: slotStart.toLocaleTimeString('en-US', {
              hour: 'numeric',
              minute: '2-digit',
              hour12: true
            })
          });
        }
      }
    }
    
    return slots.slice(0, 8); // Return up to 8 slots
  }

  // Get appointments for a specific day
  getDayAppointments(date) {
    const dayStart = new Date(date);
    dayStart.setHours(0, 0, 0, 0);
    
    const dayEnd = new Date(date);
    dayEnd.setHours(23, 59, 59, 999);
    
    return Array.from(appointments.values()).filter(apt => {
      const aptDate = new Date(apt.startTime);
      return aptDate >= dayStart && aptDate <= dayEnd;
    });
  }

  // Book a new appointment
  bookAppointment(customerInfo, appointmentTime, serviceType, callId) {
    const appointmentId = 'apt_' + Date.now();
    const duration = businessConfig.services[serviceType]?.duration || 60;
    const rate = businessConfig.services[serviceType]?.rate || 100;
    
    const startTime = new Date(appointmentTime);
    const endTime = new Date(startTime.getTime() + duration * 60000);
    
    const appointment = {
      id: appointmentId,
      customerName: customerInfo.name,
      customerPhone: customerInfo.phone,
      customerEmail: customerInfo.email || null,
      service: serviceType,
      issue: customerInfo.issue || '',
      startTime: startTime.toISOString(),
      endTime: endTime.toISOString(),
      duration: duration,
      estimatedRevenue: rate,
      status: 'confirmed',
      bookedVia: 'AI Phone',
      callId: callId,
      createdAt: new Date().toISOString(),
      address: customerInfo.address || ''
    };
    
    appointments.set(appointmentId, appointment);
    
    // Add notification
    this.addNotification({
      type: 'new_booking',
      message: `New ${serviceType} appointment: ${customerInfo.name}`,
      appointmentId: appointmentId,
      timestamp: new Date().toISOString()
    });
    
    console.log('✅ Appointment booked:', appointment);
    return appointment;
  }

  // Get next available emergency slot (within 4 hours)
  getNextEmergencySlot() {
    const now = new Date();
    const next4Hours = new Date(now.getTime() + 4 * 60 * 60 * 1000);
    
    // Round to next 30-minute interval
    let checkTime = new Date(Math.ceil(now.getTime() / (30 * 60 * 1000)) * (30 * 60 * 1000));
    
    while (checkTime < next4Hours) {
      const slotEnd = new Date(checkTime.getTime() + 60 * 60 * 1000);
      
      // Check conflicts
      const hasConflict = Array.from(appointments.values()).some(apt => {
        const aptStart = new Date(apt.startTime);
        const aptEnd = new Date(apt.endTime);
        return (checkTime < aptEnd && slotEnd > aptStart);
      });
      
      if (!hasConflict) {
        return {
          start: checkTime,
          end: slotEnd,
          display: checkTime.toLocaleTimeString('en-US', {
            hour: 'numeric',
            minute: '2-digit',
            hour12: true
          })
        };
      }
      
      checkTime = new Date(checkTime.getTime() + 30 * 60 * 1000);
    }
    
    // If no slot in 4 hours, return tomorrow 8 AM
    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(8, 0, 0, 0);
    
    return {
      start: tomorrow,
      end: new Date(tomorrow.getTime() + 60 * 60 * 1000),
      display: 'Tomorrow 8:00 AM'
    };
  }

  // Add notification
  addNotification(notification) {
    notifications.unshift({
      id: 'notif_' + Date.now(),
      ...notification,
      read: false,
      time: 'Just now'
    });
    
    // Keep only last 50 notifications
    if (notifications.length > 50) {
      notifications.splice(50);
    }
  }
}

const calendar = new CalendarManager();

// Enhanced AI prompt with real calendar data
const createCalendarAwarePrompt = (availableSlots, isEmergency = false) => `
You are Sarah, the AI receptionist for ${businessConfig.businessName}.

APPOINTMENT SCHEDULING:
${isEmergency ? 
  `EMERGENCY SERVICE: I can get you in ${availableSlots?.[0]?.display || 'within the hour'} for emergency rate ($${businessConfig.services.emergency.rate}/hour).` :
  `Available appointments today: ${availableSlots?.map(slot => slot.display).slice(0, 4).join(', ') || 'checking availability...'}`
}

SERVICES & RATES:
- Emergency Service: $${businessConfig.services.emergency.rate}/hour (water damage, no heat, safety issues)
- Regular Service: $${businessConfig.services.regular.rate}/hour (routine repairs, installations)
- Consultation: $${businessConfig.services.consultation.rate}/hour (estimates, assessments)

BOOKING PROCESS:
1. Determine service type (emergency vs regular)
2. Get customer name and phone number
3. Brief issue description
4. Offer 2-3 specific available time slots
5. When customer chooses, say "Perfect! Let me book that appointment for you right now."
6. Confirm all details

EMERGENCY CRITERIA:
- Water damage, flooding, burst pipes
- No heat in winter, no AC in extreme heat
- Gas leaks or electrical safety hazards
- Sewage backup or major blockages

SAMPLE BOOKING:
Customer: "I need a plumber"
You: "I can help! Is this an emergency situation or regular service?"
Customer: "My kitchen sink is leaking"
You: "I can schedule regular service today. I have openings at ${availableSlots?.[0]?.display}, ${availableSlots?.[1]?.display}, or ${availableSlots?.[2]?.display}. Which works for you?"
Customer: "2:00 PM"
You: "Perfect! Let me book that appointment for you right now. Can I get your name and phone number?"

Always sound confident about booking. You handle all scheduling directly.
`;

// Handle incoming calls
app.post('/voice/incoming', async (req, res) => {
  console.log('📞 Incoming call:', req.body);
  
  const { CallSid, From, To } = req.body;
  
  // Get available slots for today
  const today = new Date();
  const availableSlots = calendar.getAvailableSlots(today);
  
  // Log the call
  const callLog = {
    id: CallSid,
    from: From,
    to: To,
    startTime: new Date(),
    status: 'in-progress',
    conversation: [],
    customerInfo: {},
    availableSlots
  };
  callLogs.set(CallSid, callLog);

  const twiml = new twilio.twiml.VoiceResponse();
  
  const greeting = `Hello, ${businessConfig.businessName}, this is Sarah. I can schedule your appointment right away. How can I help you today?`;
  
  twiml.say({
    voice: 'Polly.Joanna-Neural',
    language: 'en-US'
  }, greeting);
  
  twiml.gather({
    input: 'speech',
    timeout: 5,
    speechTimeout: 'auto',
    action: '/voice/process',
    method: 'POST'
  });
  
  twiml.say('I didn\'t catch that. Let me have someone call you back.');
  twiml.hangup();

  res.type('text/xml').send(twiml.toString());
});

// Process customer speech
app.post('/voice/process', async (req, res) => {
  const { CallSid, SpeechResult } = req.body;
  const callLog = callLogs.get(CallSid);
  
  console.log(`🗣️ Customer: ${SpeechResult}`);
  
  if (!callLog) {
    return res.status(404).send('Call not found');
  }
  
  callLog.conversation.push({ role: 'user', content: SpeechResult });
  
  try {
    // Extract customer info
    await extractCustomerInfo(SpeechResult, callLog);
    
    // Check if emergency
    const isEmergency = await detectEmergency(callLog.conversation);
    
    // Get appropriate slots
    let availableSlots;
    if (isEmergency) {
      const emergencySlot = calendar.getNextEmergencySlot();
      availableSlots = [emergencySlot];
    } else {
      availableSlots = callLog.availableSlots;
    }
    
    // Generate AI response
    const aiResponse = await openai.chat.completions.create({
      model: "gpt-4",
      messages: [
        { role: 'system', content: createCalendarAwarePrompt(availableSlots, isEmergency) },
        ...callLog.conversation
      ],
      max_tokens: 200,
      temperature: 0.7
    });
    
    const responseText = aiResponse.choices[0].message.content;
    callLog.conversation.push({ role: 'assistant', content: responseText });
    
    console.log(`🤖 Sarah: ${responseText}`);
    
    // Check if ready to book
    const bookingIntent = await detectBookingIntent(callLog.conversation);
    
    if (bookingIntent.shouldBook && callLog.customerInfo.name && callLog.customerInfo.phone) {
      // Book the appointment!
      const serviceType = isEmergency ? 'emergency' : 'regular';
      const appointmentTime = findBookingTime(bookingIntent.timeSlot, availableSlots);
      
      if (appointmentTime) {
        const appointment = calendar.bookAppointment(
          callLog.customerInfo,
          appointmentTime,
          serviceType,
          CallSid
        );
        
        // Send confirmations
        await sendAppointmentConfirmations(callLog, appointment);
        
        const confirmationText = `Excellent! I've booked your ${serviceType} appointment for ${appointment.startTime}. You'll receive a text confirmation. We'll see you then!`;
        
        const twiml = new twilio.twiml.VoiceResponse();
        twiml.say({
          voice: 'Polly.Joanna-Neural',
          language: 'en-US'
        }, confirmationText);
        twiml.hangup();
        
        return res.type('text/xml').send(twiml.toString());
      }
    }
    
    // Continue conversation
    const twiml = new twilio.twiml.VoiceResponse();
    twiml.say({
      voice: 'Polly.Joanna-Neural',
      language: 'en-US'
    }, responseText);
    
    twiml.gather({
      input: 'speech',
      timeout: 5,
      speechTimeout: 'auto',
      action: '/voice/process',
      method: 'POST'
    });
    
    res.type('text/xml').send(twiml.toString());
    
  } catch (error) {
    console.error('Error:', error);
    const twiml = new twilio.twiml.VoiceResponse();
    twiml.say('I apologize, I\'m having technical difficulties. Someone will call you back shortly.');
    twiml.hangup();
    res.type('text/xml').send(twiml.toString());
  }
});

// Helper functions
async function extractCustomerInfo(input, callLog) {
  try {
    const prompt = `Extract info from: "${input}"\nReturn JSON: {"name": "", "phone": "", "issue": "", "urgency": ""}`;
    const response = await openai.chat.completions.create({
      model: "gpt-3.5-turbo",
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 100
    });
    
    const extracted = JSON.parse(response.choices[0].message.content);
    Object.assign(callLog.customerInfo, extracted);
  } catch (error) {
    console.error('Extraction error:', error);
  }
}

async function detectEmergency(conversation) {
  try {
    const prompt = `Is this an emergency? ${conversation.map(m => m.content).join(' ')}\nReturn only "true" or "false"`;
    const response = await openai.chat.completions.create({
      model: "gpt-3.5-turbo", 
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 5
    });
    return response.choices[0].message.content.includes('true');
  } catch (error) {
    return false;
  }
}

async function detectBookingIntent(conversation) {
  try {
    const prompt = `Analyze conversation for booking intent: ${conversation.map(m => m.content).join(' ')}\nReturn JSON: {"shouldBook": boolean, "timeSlot": "time mentioned"}`;
    const response = await openai.chat.completions.create({
      model: "gpt-3.5-turbo",
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 50
    });
    return JSON.parse(response.choices[0].message.content);
  } catch (error) {
    return { shouldBook: false, timeSlot: null };
  }
}

function findBookingTime(timeSlot, availableSlots) {
  if (!timeSlot || !availableSlots.length) return null;
  
  const slot = availableSlots.find(s => 
    s.display.toLowerCase().includes(timeSlot.toLowerCase()) ||
    timeSlot.toLowerCase().includes(s.display.toLowerCase())
  );
  
  return slot?.start || availableSlots[0]?.start;
}

async function sendAppointmentConfirmations(callLog, appointment) {
  try {
    const customerMessage = `📅 APPOINTMENT CONFIRMED\n\n${businessConfig.businessName}\nDate: ${new Date(appointment.startTime).toLocaleString()}\nService: ${appointment.service}\n\nWe'll call if running late!`;
    
    if (callLog.customerInfo.phone) {
      await twilioClient.messages.create({
        body: customerMessage,
        from: process.env.TWILIO_PHONE_NUMBER,
        to: callLog.customerInfo.phone
      });
    }
    
    const ownerMessage = `🔧 NEW APPOINTMENT\n\nCustomer: ${appointment.customerName}\nPhone: ${appointment.customerPhone}\nTime: ${new Date(appointment.startTime).toLocaleString()}\nService: ${appointment.service}\nIssue: ${appointment.issue}`;
    
    await twilioClient.messages.create({
      body: ownerMessage,
      from: process.env.TWILIO_PHONE_NUMBER,
      to: businessConfig.ownerPhone
    });
    
  } catch (error) {
    console.error('SMS error:', error);
  }
}

// API Endpoints
app.get('/api/appointments', (req, res) => {
  const { date } = req.query;
  if (date) {
    const targetDate = new Date(date);
    const dayAppointments = calendar.getDayAppointments(targetDate);
    res.json(dayAppointments);
  } else {
    res.json(Array.from(appointments.values()));
  }
});

app.get('/api/available-slots', (req, res) => {
  const { date } = req.query;
  const targetDate = date ? new Date(date) : new Date();
  const slots = calendar.getAvailableSlots(targetDate);
  res.json(slots);
});

app.get('/api/notifications', (req, res) => {
  res.json(notifications.slice(0, 20));
});

app.get('/api/stats', (req, res) => {
  const today = new Date();
  const todayAppointments = calendar.getDayAppointments(today);
  const totalRevenue = todayAppointments.reduce((sum, apt) => sum + apt.estimatedRevenue, 0);
  
  res.json({
    todayAppointments: todayAppointments.length,
    todayRevenue: totalRevenue,
    totalAppointments: appointments.size,
    aiBookings: Array.from(appointments.values()).filter(apt => apt.bookedVia === 'AI Phone').length
  });
});

// Serve calendar app
app.get('/calendar', (req, res) => {
  res.sendFile(path.join(__dirname, 'calendar.html'));
});

app.get('/', (req, res) => {
  res.json({
    message: 'AI Phone System with Built-in Calendar Running!',
    status: 'active',
    features: ['Real appointment booking', 'Built-in calendar', 'Live notifications'],
    calendar: '/calendar',
    endpoints: {
      incoming: '/voice/incoming',
      appointments: '/api/appointments',
      availableSlots: '/api/available-slots',
      notifications: '/api/notifications',
      stats: '/api/stats'
    }
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 AI Phone System with Calendar running on port ${PORT}`);
  console.log(`📅 Built-in calendar database ready`);
  console.log(`📞 Phone: (844) 540-1735`);
  console.log(`💻 Calendar App: /calendar`);
});
