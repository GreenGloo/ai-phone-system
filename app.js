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
app.use(express.static('public'));

// Initialize services
const twilioClient = twilio(process.env.TWILIO_SID, process.env.TWILIO_TOKEN);
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// In-memory database
const appointments = new Map();
const callLogs = new Map();
const notifications = [];

// Enhanced service configuration with durations and travel time
const serviceTypes = {
  'emergency': { name: 'Emergency Service', duration: 60, rate: 150, travelBuffer: 30 },
  'drain-cleaning': { name: 'Drain Cleaning', duration: 90, rate: 120, travelBuffer: 30 },
  'water-heater': { name: 'Water Heater', duration: 180, rate: 100, travelBuffer: 45 },
  'pipe-repair': { name: 'Pipe Repair', duration: 120, rate: 110, travelBuffer: 30 },
  'fixture-install': { name: 'Fixture Install', duration: 90, rate: 95, travelBuffer: 30 },
  'consultation': { name: 'Consultation', duration: 45, rate: 75, travelBuffer: 15 },
  'regular': { name: 'Regular Service', duration: 90, rate: 100, travelBuffer: 30 }
};

// Business configuration
const businessConfig = {
  businessName: "CallCatcher Demo",
  ownerName: "Business Owner",
  ownerPhone: process.env.OWNER_PHONE || "+15551234567",
  businessHours: { start: 8, end: 18 },
  services: {
    emergency: { rate: 150, duration: 60 },
    regular: { rate: 100, duration: 90 }
  }
};

// Enhanced Calendar Manager with travel time
class EnhancedCalendarManager {
  getAvailableSlots(date, requestedDuration = 60) {
    const dayAppointments = this.getDayAppointments(date);
    const slots = [];
    
    for (let hour = businessConfig.businessHours.start; hour < businessConfig.businessHours.end; hour++) {
      for (let minute = 0; minute < 60; minute += 30) {
        const slotStart = new Date(date);
        slotStart.setHours(hour, minute, 0, 0);
        
        // Add travel buffer to requested duration
        const totalDuration = requestedDuration + 30; // 30 min travel buffer
        const slotEnd = new Date(slotStart);
        slotEnd.setMinutes(slotEnd.getMinutes() + totalDuration);
        
        // Check if slot conflicts with existing appointments (including their travel buffers)
        const hasConflict = dayAppointments.some(apt => {
          const aptStart = new Date(apt.startTime);
          const aptEnd = new Date(apt.endTime);
          
          // Add travel buffer to existing appointments
          const serviceType = serviceTypes[apt.serviceType] || { travelBuffer: 30 };
          aptStart.setMinutes(aptStart.getMinutes() - serviceType.travelBuffer);
          aptEnd.setMinutes(aptEnd.getMinutes() + serviceType.travelBuffer);
          
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
    
    return slots.slice(0, 8);
  }

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

  bookAppointment(customerInfo, appointmentTime, serviceType, callId) {
    const appointmentId = 'apt_' + Date.now();
    const serviceConfig = serviceTypes[serviceType] || serviceTypes['regular'];
    const duration = serviceConfig.duration;
    const rate = serviceConfig.rate;
    
    const startTime = new Date(appointmentTime);
    const endTime = new Date(startTime.getTime() + duration * 60000);
    
    const appointment = {
      id: appointmentId,
      customerName: customerInfo.name,
      customerPhone: customerInfo.phone,
      customerEmail: customerInfo.email || null,
      address: customerInfo.address || '',
      service: serviceConfig.name,
      serviceType: serviceType,
      issue: customerInfo.issue || '',
      startTime: startTime.toISOString(),
      endTime: endTime.toISOString(),
      duration: duration,
      estimatedRevenue: rate,
      status: 'scheduled',
      bookedVia: 'AI Phone',
      callId: callId,
      createdAt: new Date().toISOString(),
      completed: false,
      communicationHistory: ''
    };
    
    appointments.set(appointmentId, appointment);
    
    this.addNotification({
      type: 'new_booking',
      message: `New ${serviceType} appointment: ${customerInfo.name}`,
      appointmentId: appointmentId
    });
    
    console.log('✅ Appointment booked:', appointment);
    return appointment;
  }

  getNextEmergencySlot() {
    const now = new Date();
    let checkTime = new Date(Math.ceil(now.getTime() / (30 * 60 * 1000)) * (30 * 60 * 1000));
    
    const slotEnd = new Date(checkTime.getTime() + 60 * 60 * 1000);
    
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

  addNotification(notification) {
    notifications.unshift({
      id: 'notif_' + Date.now(),
      ...notification,
      timestamp: new Date().toISOString(),
      read: false,
      time: 'Just now'
    });
    
    // Keep only last 50 notifications
    if (notifications.length > 50) {
      notifications.splice(50);
    }
  }
}

const calendar = new EnhancedCalendarManager();

// AI prompt
const createCalendarAwarePrompt = (availableSlots, isEmergency = false) => `
You are Sarah, the AI receptionist for ${businessConfig.businessName}.

CRITICAL: ALWAYS offer specific appointment times when customers need service.

AVAILABLE TIMES TODAY: ${availableSlots?.map(slot => slot.display).slice(0, 4).join(', ') || '9:00 AM, 2:00 PM, 5:00 PM'}

BOOKING PROCESS (FOLLOW EXACTLY):
1. Ask if emergency or regular service
2. For ANY service request, immediately offer 2-3 specific times from available slots
3. Get customer name and phone number
4. When they pick a time, say "Perfect! Let me book that for you right now."

SAMPLE CONVERSATIONS:

Regular Service:
Customer: "I need a plumber for my sink"
You: "I can help with that regular service call. I have appointments available today at ${availableSlots?.[0]?.display || '2:00 PM'}, ${availableSlots?.[1]?.display || '3:30 PM'}, or ${availableSlots?.[2]?.display || '5:00 PM'}. Which time works for you?"

Emergency Service:
Customer: "Emergency! My pipe burst!"
You: "That's an emergency - I can get you in ${availableSlots?.[0]?.display || 'within the hour'} for $${businessConfig.services.emergency.rate}/hour. Can I book that time for you?"

NEVER say "someone will call you back" - YOU handle all scheduling.
ALWAYS offer specific times immediately when they need service.
ALWAYS get name and phone before confirming the booking.
`;

// Serve frontend pages
app.get('/calendar', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/book', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'book.html'));
});

app.get('/schedule', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'schedule.html'));
});

// Handle incoming calls
app.post('/voice/incoming', async (req, res) => {
  console.log('📞 Incoming call:', req.body);
  
  const { CallSid, From, To } = req.body;
  
  const today = new Date();
  const availableSlots = calendar.getAvailableSlots(today);
  
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
    await extractCustomerInfo(SpeechResult, callLog);
    
    const isEmergency = await detectEmergency(callLog.conversation);
    
    let availableSlots;
    if (isEmergency) {
      const emergencySlot = calendar.getNextEmergencySlot();
      availableSlots = [emergencySlot];
    } else {
      availableSlots = callLog.availableSlots;
    }
    
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
    
    const bookingIntent = await detectBookingIntent(callLog.conversation);
    
    if (bookingIntent.shouldBook && callLog.customerInfo.name && callLog.customerInfo.phone) {
      const serviceType = isEmergency ? 'emergency' : 'regular';
      const appointmentTime = findBookingTime(bookingIntent.timeSlot, availableSlots);
      
      if (appointmentTime) {
        const appointment = calendar.bookAppointment(
          callLog.customerInfo,
          appointmentTime,
          serviceType,
          CallSid
        );
        
        await sendAppointmentConfirmations(callLog, appointment);
        
        const confirmationText = `Excellent! I've booked your ${serviceType} appointment for ${new Date(appointment.startTime).toLocaleString()}. You'll receive a text confirmation. We'll see you then!`;
        
        const twiml = new twilio.twiml.VoiceResponse();
        twiml.say({
          voice: 'Polly.Joanna-Neural',
          language: 'en-US'
        }, confirmationText);
        twiml.hangup();
        
        return res.type('text/xml').send(twiml.toString());
      }
    }
    
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

// Manual booking API endpoint
app.post('/api/book-appointment', async (req, res) => {
  try {
    const { customerInfo, service, appointmentTime, bookedVia = 'Website' } = req.body;
    
    // Validate service type
    const serviceConfig = serviceTypes[service.type];
    if (!serviceConfig) {
      return res.status(400).json({ success: false, error: 'Invalid service type' });
    }
    
    // Create appointment
    const appointment = calendar.bookAppointment(
      customerInfo,
      new Date(appointmentTime),
      service.type,
      'manual_' + Date.now()
    );
    
    // Update appointment with enhanced data
    appointment.bookedVia = bookedVia;
    
    // Update in storage
    appointments.set(appointment.id, appointment);
    
    // Send confirmations
    await sendManualBookingConfirmations(customerInfo, appointment);
    
    res.json({ success: true, appointment });
    
  } catch (error) {
    console.error('Manual booking error:', error);
    res.status(500).json({ success: false, error: 'Failed to book appointment' });
  }
});

// Send running late notification to all remaining customers
app.post('/api/send-running-late', async (req, res) => {
  try {
    const { delayMinutes, reason } = req.body;
    const today = new Date();
    const now = new Date();
    
    // Get remaining appointments for today
    const remainingAppointments = Array.from(appointments.values()).filter(apt => {
      const aptDate = new Date(apt.startTime);
      return aptDate.toDateString() === today.toDateString() && 
             aptDate > now && 
             !apt.completed;
    });
    
    let customerCount = 0;
    
    for (const apt of remainingAppointments) {
      const originalTime = new Date(apt.startTime);
      const newTime = new Date(originalTime.getTime() + delayMinutes * 60 * 1000);
      const windowStart = new Date(newTime.getTime() - 30 * 60 * 1000);
      const windowEnd = new Date(newTime.getTime() + 30 * 60 * 1000);
      
      const timeWindow = `${windowStart.toLocaleTimeString('en-US', {hour: 'numeric', minute: '2-digit', hour12: true})}-${windowEnd.toLocaleTimeString('en-US', {hour: 'numeric', minute: '2-digit', hour12: true})}`;
      
      let message = `Hi ${apt.customerName}! This is ${businessConfig.businessName}. I'm running about ${delayMinutes} minutes behind schedule today.`;
      
      if (reason) {
        message += ` ${reason}.`;
      }
      
      message += ` Your new appointment window is ${timeWindow}. Thanks for your patience!`;
      
      try {
        await twilioClient.messages.create({
          body: message,
          from: process.env.TWILIO_PHONE_NUMBER,
          to: apt.customerPhone
        });
        
        // Update appointment time
        apt.startTime = newTime.toISOString();
        apt.endTime = new Date(newTime.getTime() + apt.duration * 60 * 1000).toISOString();
        apt.communicationHistory = `Notified of ${delayMinutes}min delay`;
        
        customerCount++;
      } catch (error) {
        console.error(`Error sending to ${apt.customerPhone}:`, error);
      }
    }
    
    calendar.addNotification({
      type: 'delay_notification',
      message: `Sent delay notification to ${customerCount} customers (${delayMinutes} min delay)`
    });
    
    res.json({ success: true, customerCount });
    
  } catch (error) {
    console.error('Running late error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Send early arrival request to specific customer
app.post('/api/send-early-arrival', async (req, res) => {
  try {
    const { appointmentId, earlyMinutes } = req.body;
    const appointment = appointments.get(appointmentId);
    
    if (!appointment) {
      return res.status(404).json({ success: false, error: 'Appointment not found' });
    }
    
    const originalTime = new Date(appointment.startTime);
    const earlyTime = new Date(originalTime.getTime() - earlyMinutes * 60 * 1000);
    
    const message = `Hi ${appointment.customerName}! This is ${businessConfig.businessName}. I'm ahead of schedule and could arrive ${earlyMinutes} minutes early (around ${earlyTime.toLocaleTimeString('en-US', {hour: 'numeric', minute: '2-digit', hour12: true})}) if that works for you. Reply YES if that's okay, or I'll stick to the original time window. Thanks!`;
    
    await twilioClient.messages.create({
      body: message,
      from: process.env.TWILIO_PHONE_NUMBER,
      to: appointment.customerPhone
    });
    
    appointment.communicationHistory = `Asked about ${earlyMinutes}min early arrival`;
    
    calendar.addNotification({
      type: 'early_request',
      message: `Asked ${appointment.customerName} about early arrival`
    });
    
    res.json({ success: true });
    
  } catch (error) {
    console.error('Early arrival error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Send quick status messages (arrived, en route, etc.)
app.post('/api/send-quick-message', async (req, res) => {
  try {
    const { appointmentId, messageType } = req.body;
    const appointment = appointments.get(appointmentId);
    
    if (!appointment) {
      return res.status(404).json({ success: false, error: 'Appointment not found' });
    }
    
    let message;
    
    switch (messageType) {
      case 'arrived':
        message = `Hi ${appointment.customerName}! This is ${businessConfig.businessName}. I've arrived and will be with you shortly. Thanks!`;
        appointment.status = 'arrived';
        break;
      case 'enroute':
        message = `Hi ${appointment.customerName}! This is ${businessConfig.businessName}. I'm on my way and should be there in about 30 minutes. See you soon!`;
        appointment.status = 'enroute';
        break;
      default:
        return res.status(400).json({ success: false, error: 'Invalid message type' });
    }
    
    await twilioClient.messages.create({
      body: message,
      from: process.env.TWILIO_PHONE_NUMBER,
      to: appointment.customerPhone
    });
    
    appointment.communicationHistory = `Sent ${messageType} message`;
    
    res.json({ success: true });
    
  } catch (error) {
    console.error('Quick message error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Send custom message to selected customers
app.post('/api/send-custom-message', async (req, res) => {
  try {
    const { recipients, message } = req.body;
    const today = new Date();
    const now = new Date();
    
    let targetAppointments = [];
    
    switch (recipients) {
      case 'all':
        targetAppointments = Array.from(appointments.values()).filter(apt => {
          const aptDate = new Date(apt.startTime);
          return aptDate.toDateString() === today.toDateString();
        });
        break;
      case 'remaining':
        targetAppointments = Array.from(appointments.values()).filter(apt => {
          const aptDate = new Date(apt.startTime);
          return aptDate.toDateString() === today.toDateString() && 
                 aptDate > now && 
                 !apt.completed;
        });
        break;
      case 'next':
        const nextApt = Array.from(appointments.values())
          .filter(apt => {
            const aptDate = new Date(apt.startTime);
            return aptDate.toDateString() === today.toDateString() && 
                   aptDate > now && 
                   !apt.completed;
          })
          .sort((a, b) => new Date(a.startTime) - new Date(b.startTime))[0];
        if (nextApt) targetAppointments = [nextApt];
        break;
    }
    
    let customerCount = 0;
    
    for (const apt of targetAppointments) {
      try {
        const personalizedMessage = message.replace(/\{name\}/g, apt.customerName);
        
        await twilioClient.messages.create({
          body: `Hi ${apt.customerName}! This is ${businessConfig.businessName}. ${personalizedMessage}`,
          from: process.env.TWILIO_PHONE_NUMBER,
          to: apt.customerPhone
        });
        
        apt.communicationHistory = `Custom message sent`;
        customerCount++;
      } catch (error) {
        console.error(`Error sending to ${apt.customerPhone}:`, error);
      }
    }
    
    calendar.addNotification({
      type: 'custom_message',
      message: `Sent custom message to ${customerCount} customers`
    });
    
    res.json({ success: true, customerCount });
    
  } catch (error) {
    console.error('Custom message error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Send direct message to specific customer
app.post('/api/send-direct-message', async (req, res) => {
  try {
    const { appointmentId, message } = req.body;
    const appointment = appointments.get(appointmentId);
    
    if (!appointment) {
      return res.status(404).json({ success: false, error: 'Appointment not found' });
    }
    
    await twilioClient.messages.create({
      body: `Hi ${appointment.customerName}! This is ${businessConfig.businessName}. ${message}`,
      from: process.env.TWILIO_PHONE_NUMBER,
      to: appointment.customerPhone
    });
    
    appointment.communicationHistory = `Direct message sent`;
    
    res.json({ success: true });
    
  } catch (error) {
    console.error('Direct message error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Mark appointment as completed
app.post('/api/complete-appointment', async (req, res) => {
  try {
    const { appointmentId } = req.body;
    const appointment = appointments.get(appointmentId);
    
    if (!appointment) {
      return res.status(404).json({ success: false, error: 'Appointment not found' });
    }
    
    appointment.completed = true;
    appointment.completedAt = new Date().toISOString();
    appointment.status = 'completed';
    
    calendar.addNotification({
      type: 'appointment_completed',
      message: `Completed appointment with ${appointment.customerName}`
    });
    
    res.json({ success: true });
    
  } catch (error) {
    console.error('Complete appointment error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Helper functions
async function extractCustomerInfo(input, callLog) {
  try {
    const prompt = `Extract info from: "${input}"\nReturn JSON: {"name": "", "phone": "", "issue": ""}`;
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
    const prompt = `Analyze for booking intent: ${conversation.map(m => m.content).join(' ')}\nReturn JSON: {"shouldBook": boolean, "timeSlot": "time mentioned"}`;
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
    const appointmentTime = new Date(appointment.startTime);
    const windowStart = new Date(appointmentTime.getTime() - 30 * 60 * 1000);
    const windowEnd = new Date(appointmentTime.getTime() + 30 * 60 * 1000);
    const timeWindow = `${windowStart.toLocaleTimeString('en-US', {hour: 'numeric', minute: '2-digit', hour12: true})}-${windowEnd.toLocaleTimeString('en-US', {hour: 'numeric', minute: '2-digit', hour12: true})}`;
    
    const customerMessage = `📅 APPOINTMENT CONFIRMED\n\n${businessConfig.businessName}\nService: ${appointment.service}\nTime Window: ${timeWindow}\n${new Date(appointment.startTime).toDateString()}\n\nWe'll call 30 minutes before arrival!`;
    
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

async function sendManualBookingConfirmations(customerInfo, appointment) {
  try {
    const appointmentTime = new Date(appointment.startTime);
    const windowStart = new Date(appointmentTime.getTime() - 30 * 60 * 1000);
    const windowEnd = new Date(appointmentTime.getTime() + 30 * 60 * 1000);
    const timeWindow = `${windowStart.toLocaleTimeString('en-US', {hour: 'numeric', minute: '2-digit', hour12: true})}-${windowEnd.toLocaleTimeString('en-US', {hour: 'numeric', minute: '2-digit', hour12: true})}`;
    
    // Customer SMS
    if (customerInfo.phone) {
      const customerMessage = `📅 APPOINTMENT CONFIRMED

${businessConfig.businessName}
Service: ${appointment.service}
Time Window: ${timeWindow}
${appointmentTime.toDateString()}
Address: ${customerInfo.address}

We'll call 30 minutes before arrival. Thank you!`;

      await twilioClient.messages.create({
        body: customerMessage,
        from: process.env.TWILIO_PHONE_NUMBER,
        to: customerInfo.phone
      });
    }
    
    // Owner notification
    const ownerMessage = `🔧 NEW WEBSITE BOOKING

Customer: ${customerInfo.name}
Phone: ${customerInfo.phone}
Service: ${appointment.service}
Time: ${appointmentTime.toLocaleString()}
Address: ${customerInfo.address}
Issue: ${customerInfo.issue}

Estimated: $${appointment.estimatedRevenue}`;

    await twilioClient.messages.create({
      body: ownerMessage,
      from: process.env.TWILIO_PHONE_NUMBER,
      to: businessConfig.ownerPhone
    });
    
  } catch (error) {
    console.error('Manual booking SMS error:', error);
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
  const { date, duration } = req.query;
  const targetDate = date ? new Date(date) : new Date();
  const requestedDuration = duration ? parseInt(duration) : 60;
  const slots = calendar.getAvailableSlots(targetDate, requestedDuration);
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

app.get('/', (req, res) => {
  res.json({
    message: 'AI Phone System with Calendar & Communication Running!',
    status: 'active',
    features: ['Real appointment booking', 'Customer communication', 'Schedule management'],
    pages: {
      calendar: '/calendar',
      booking: '/book', 
      schedule: '/schedule'
    },
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
  console.log(`🚀 AI Phone System with Communication running on port ${PORT}`);
  console.log(`📅 Calendar: /calendar`);
  console.log(`📝 Booking: /book`);
  console.log(`📋 Schedule: /schedule`);
  console.log(`📞 Phone: (844) 540-1735`);
});
