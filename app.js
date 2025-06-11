require('dotenv').config();
const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { Pool } = require('pg');
const twilio = require('twilio');
const OpenAI = require('openai');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const cors = require('cors');
const path = require('path');

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cors());
app.use(express.static('public'));

// Database connection
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

// Initialize services
const twilioClient = twilio(process.env.TWILIO_SID, process.env.TWILIO_TOKEN);
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// JWT secret
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-this';

// Removed hardcoded plumbing services - AI generation handles all business types

// Middleware to verify JWT and extract user
const authenticateToken = async (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'Access token required' });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const result = await pool.query('SELECT * FROM users WHERE id = $1', [decoded.userId]);
    
    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Invalid token' });
    }

    req.user = result.rows[0];
    next();
  } catch (error) {
    return res.status(403).json({ error: 'Invalid token' });
  }
};

// Middleware to get business context
const getBusinessContext = async (req, res, next) => {
  try {
    const businessId = req.params.businessId || req.body.businessId || req.query.businessId;
    
    if (!businessId) {
      return res.status(400).json({ error: 'Business ID required' });
    }

    const result = await pool.query(
      'SELECT * FROM businesses WHERE id = $1 AND user_id = $2',
      [businessId, req.user.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Business not found' });
    }

    req.business = result.rows[0];
    next();
  } catch (error) {
    console.error('Error getting business context:', error);
    res.status(500).json({ error: 'Database error' });
  }
};

// Serve static pages
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'landing.html'));
});

app.get('/onboarding', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'onboarding.html'));
});

app.get('/dashboard', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'dashboard.html'));
});

// Multi-tenant booking page route
app.get('/book/:businessId', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'book.html'));
});

// Fallback booking route (uses first business for demo)
app.get('/book', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'book.html'));
});

// Authentication endpoints
app.post('/api/signup', async (req, res) => {
  try {
    const { businessName, ownerName, email, phone, password, businessType, plan = 'professional' } = req.body;
    
    // Validate input
    if (!businessName || !ownerName || !email || !phone || !password || !businessType) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    // Clean up business type for consistent processing
    const cleanBusinessType = businessType.toLowerCase().trim().replace(/[^a-z0-9]/g, '_');

    // Check if user already exists
    const existingUser = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
    if (existingUser.rows.length > 0) {
      return res.status(400).json({ error: 'Email already registered' });
    }

    // Hash the provided password
    const passwordHash = await bcrypt.hash(password, 10);

    // Create user
    const [firstName, ...lastNameParts] = ownerName.split(' ');
    const lastName = lastNameParts.join(' ') || '';

    const userResult = await pool.query(
      `INSERT INTO users (email, password_hash, first_name, last_name, phone) 
       VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [email, passwordHash, firstName, lastName, phone]
    );

    const userId = userResult.rows[0].id;

    // Create Stripe customer (skip if no valid key)
    let stripeCustomer = { id: 'demo_customer_' + Date.now() };
    if (process.env.STRIPE_SECRET_KEY && !process.env.STRIPE_SECRET_KEY.includes('sk_test_your_stripe_key_here')) {
      try {
        stripeCustomer = await stripe.customers.create({
          email: email,
          name: ownerName,
          phone: phone,
          metadata: {
            business_name: businessName,
            business_type: businessType
          }
        });
      } catch (stripeError) {
        console.log('Stripe error, using demo customer:', stripeError.message);
      }
    }

    // Get Twilio phone number (simplified - use existing demo number for now)
    let phoneNumber = process.env.TWILIO_PHONE_NUMBER || '+18445401735';
    
    // In production, you would provision a unique number for each business
    // For demo/development, we'll use the shared demo number

    // Create business
    const businessResult = await pool.query(
      `INSERT INTO businesses (user_id, name, business_type, phone_number) 
       VALUES ($1, $2, $3, $4) RETURNING id`,
      [userId, businessName, cleanBusinessType, phoneNumber]
    );

    const businessId = businessResult.rows[0].id;

    // Create AI-generated service types based on business type
    try {
      console.log(`🤖 Generating services for ${cleanBusinessType} business: ${businessName}`);
      const generatedServices = await generateServicesWithAI(cleanBusinessType, businessName);
      
      for (const serviceType of generatedServices) {
        await pool.query(
          `INSERT INTO service_types (business_id, name, service_key, description, duration_minutes, base_rate, emergency_multiplier, travel_buffer_minutes, is_emergency, is_active)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
          [
            businessId,
            serviceType.name,
            serviceType.service_key,
            serviceType.description,
            serviceType.duration_minutes,
            serviceType.base_rate,
            serviceType.emergency_multiplier,
            serviceType.travel_buffer_minutes,
            serviceType.is_emergency,
            serviceType.is_active
          ]
        );
      }
      
      console.log(`✅ Generated ${generatedServices.length} services for ${businessName}`);
    } catch (aiError) {
      console.error('AI service generation failed, using business-specific fallback:', aiError);
      
      // Fallback to business-appropriate template if AI generation fails during signup
      const fallbackServices = getBasicServiceTemplate(cleanBusinessType);
      for (const serviceType of fallbackServices) {
        await pool.query(
          `INSERT INTO service_types (business_id, name, service_key, description, duration_minutes, base_rate, emergency_multiplier, travel_buffer_minutes, is_emergency, is_active)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
          [
            businessId,
            serviceType.name,
            serviceType.service_key,
            serviceType.description,
            serviceType.duration_minutes,
            serviceType.base_rate,
            serviceType.emergency_multiplier,
            serviceType.travel_buffer_minutes,
            serviceType.is_emergency,
            serviceType.is_active
          ]
        );
      }
    }

    // Create subscription with trial
    const trialEnd = new Date();
    trialEnd.setDate(trialEnd.getDate() + 14); // 14-day trial

    await pool.query(
      `INSERT INTO subscriptions (business_id, stripe_customer_id, plan, status, trial_ends_at, monthly_call_limit)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [businessId, stripeCustomer.id, plan, 'trialing', trialEnd, plan === 'starter' ? 100 : plan === 'professional' ? 500 : 9999]
    );

    // Generate JWT token
    const token = jwt.sign({ userId }, JWT_SECRET, { expiresIn: '30d' });

    res.json({
      success: true,
      token,
      user: {
        id: userId,
        email,
        firstName,
        lastName
      },
      business: {
        id: businessId,
        name: businessName,
        phoneNumber,
        plan
      }
    });

  } catch (error) {
    console.error('Signup error:', error);
    res.status(500).json({ error: 'Failed to create account' });
  }
});

app.post('/api/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    // Get user
    const userResult = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
    if (userResult.rows.length === 0) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const user = userResult.rows[0];

    // Check password
    const validPassword = await bcrypt.compare(password, user.password_hash);
    if (!validPassword) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // Update last login
    await pool.query('UPDATE users SET last_login = CURRENT_TIMESTAMP WHERE id = $1', [user.id]);

    // Get user's businesses
    const businessesResult = await pool.query(
      'SELECT id, name, business_type, phone_number, status FROM businesses WHERE user_id = $1',
      [user.id]
    );

    // Generate token
    const token = jwt.sign({ userId: user.id }, JWT_SECRET, { expiresIn: '30d' });

    res.json({
      success: true,
      token,
      user: {
        id: user.id,
        email: user.email,
        firstName: user.first_name,
        lastName: user.last_name
      },
      businesses: businessesResult.rows
    });

  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Login failed' });
  }
});

// Business management endpoints
app.get('/api/businesses', authenticateToken, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT b.*, s.plan, s.status as subscription_status, s.trial_ends_at 
       FROM businesses b 
       LEFT JOIN subscriptions s ON b.id = s.business_id 
       WHERE b.user_id = $1`,
      [req.user.id]
    );

    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching businesses:', error);
    res.status(500).json({ error: 'Failed to fetch businesses' });
  }
});

app.get('/api/businesses/:businessId/service-types', authenticateToken, getBusinessContext, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM service_types WHERE business_id = $1 AND is_active = true ORDER BY display_order, name',
      [req.business.id]
    );

    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching service types:', error);
    res.status(500).json({ error: 'Failed to fetch service types' });
  }
});

// Service management endpoints
app.post('/api/businesses/:businessId/service-types', authenticateToken, getBusinessContext, async (req, res) => {
  try {
    const { name, description, base_rate, duration_minutes, emergency_multiplier, travel_buffer_minutes, is_emergency, is_active } = req.body;
    
    // Generate service key from name
    const service_key = name.toLowerCase().replace(/[^a-z0-9]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
    
    const result = await pool.query(
      `INSERT INTO service_types (business_id, name, service_key, description, duration_minutes, base_rate, emergency_multiplier, travel_buffer_minutes, is_emergency, is_active)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING *`,
      [req.business.id, name, service_key, description, duration_minutes, base_rate, emergency_multiplier, travel_buffer_minutes, is_emergency, is_active]
    );
    
    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error creating service type:', error);
    res.status(500).json({ error: 'Failed to create service type' });
  }
});

app.put('/api/businesses/:businessId/service-types/:serviceId', authenticateToken, getBusinessContext, async (req, res) => {
  try {
    const { serviceId } = req.params;
    const { name, description, base_rate, duration_minutes, emergency_multiplier, travel_buffer_minutes, is_emergency, is_active } = req.body;
    
    // Generate service key from name
    const service_key = name.toLowerCase().replace(/[^a-z0-9]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
    
    const result = await pool.query(
      `UPDATE service_types SET 
       name = $1, service_key = $2, description = $3, duration_minutes = $4, base_rate = $5, 
       emergency_multiplier = $6, travel_buffer_minutes = $7, is_emergency = $8, is_active = $9
       WHERE id = $10 AND business_id = $11 RETURNING *`,
      [name, service_key, description, duration_minutes, base_rate, emergency_multiplier, travel_buffer_minutes, is_emergency, is_active, serviceId, req.business.id]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Service type not found' });
    }
    
    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error updating service type:', error);
    res.status(500).json({ error: 'Failed to update service type' });
  }
});

app.delete('/api/businesses/:businessId/service-types/:serviceId', authenticateToken, getBusinessContext, async (req, res) => {
  try {
    const { serviceId } = req.params;
    
    const result = await pool.query(
      'DELETE FROM service_types WHERE id = $1 AND business_id = $2 RETURNING *',
      [serviceId, req.business.id]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Service type not found' });
    }
    
    res.json({ success: true, message: 'Service type deleted' });
  } catch (error) {
    console.error('Error deleting service type:', error);
    res.status(500).json({ error: 'Failed to delete service type' });
  }
});

// Voice endpoint with business context
app.post('/voice/incoming/:businessId', async (req, res) => {
  try {
    const { businessId } = req.params;
    const { CallSid, From, To } = req.body;

    console.log(`📞 Incoming call for business ${businessId}: ${From} → ${To}`);

    // Get business details with error handling
    let businessResult;
    try {
      businessResult = await pool.query('SELECT * FROM businesses WHERE id = $1', [businessId]);
    } catch (dbError) {
      console.error('Database connection error:', dbError);
      // Fallback response when database is down
      const twiml = new twilio.twiml.VoiceResponse();
      twiml.say('Hello, thank you for calling. Our system is temporarily unavailable. Please try calling back in a few minutes or leave a voicemail.');
      return res.type('text/xml').send(twiml.toString());
    }
    
    if (businessResult.rows.length === 0) {
      console.error('Business not found:', businessId);
      const twiml = new twilio.twiml.VoiceResponse();
      twiml.say('This phone number is not currently active. Please check the number and try again.');
      return res.type('text/xml').send(twiml.toString());
    }

    const business = businessResult.rows[0];

    // Check subscription status
    const subscriptionResult = await pool.query(
      'SELECT * FROM subscriptions WHERE business_id = $1 ORDER BY created_at DESC LIMIT 1',
      [businessId]
    );

    if (subscriptionResult.rows.length === 0 || subscriptionResult.rows[0].status === 'cancelled') {
      const twiml = new twilio.twiml.VoiceResponse();
      twiml.say('This service is currently unavailable. Please try again later.');
      return res.type('text/xml').send(twiml.toString());
    }

    // Get service types for this business
    const serviceTypesResult = await pool.query(
      'SELECT * FROM service_types WHERE business_id = $1 AND is_active = true',
      [businessId]
    );

    const serviceTypes = serviceTypesResult.rows;

    // Log the call
    await pool.query(
      `INSERT INTO call_logs (business_id, call_sid, from_number, to_number, call_status)
       VALUES ($1, $2, $3, $4, $5)`,
      [businessId, CallSid, From, To, 'in-progress']
    );

    // Create AI greeting with faster flow
    const twiml = new twilio.twiml.VoiceResponse();
    const businessTypeDisplay = business.business_type.replace(/_/g, ' ');
    const greeting = `Hello, you've reached ${business.name}. I'm Sarah, your AI assistant. I can quickly schedule your ${businessTypeDisplay} appointment. What service do you need?`;

    twiml.say({
      voice: business.ai_voice_id || 'Polly.Joanna-Neural',
      language: 'en-US',
      rate: '1.1' // Slightly faster speech
    }, greeting);

    twiml.gather({
      input: 'speech',
      timeout: 8, // Longer timeout for customer to respond
      speechTimeout: 'auto',
      action: `/voice/process/${businessId}`,
      method: 'POST'
    });

    twiml.say('I didn\'t catch that. Let me have someone call you back.');
    twiml.hangup();

    res.type('text/xml').send(twiml.toString());

  } catch (error) {
    console.error('Voice incoming error:', error);
    console.error('Error details:', {
      message: error.message,
      stack: error.stack,
      businessId,
      requestBody: req.body
    });
    const twiml = new twilio.twiml.VoiceResponse();
    twiml.say('Hello, thank you for calling. We are experiencing technical difficulties. Please try again in a few minutes.');
    res.type('text/xml').send(twiml.toString());
  }
});

// Voice processing endpoint for AI conversations
app.post('/voice/process/:businessId', async (req, res) => {
  try {
    const { businessId } = req.params;
    const { SpeechResult, CallSid, From } = req.body;
    
    console.log(`🗣️ Processing speech for business ${businessId}: "${SpeechResult}"`);

    // Get business and service types
    const businessResult = await pool.query('SELECT * FROM businesses WHERE id = $1', [businessId]);
    const serviceTypesResult = await pool.query(
      'SELECT * FROM service_types WHERE business_id = $1 AND is_active = true',
      [businessId]
    );

    if (businessResult.rows.length === 0) {
      const twiml = new twilio.twiml.VoiceResponse();
      twiml.say('Sorry, this service is not available right now.');
      twiml.hangup();
      return res.type('text/xml').send(twiml.toString());
    }

    const business = businessResult.rows[0];
    const serviceTypes = serviceTypesResult.rows;

    // Use OpenAI to process the customer's request
    const aiResponse = await processCustomerRequest(SpeechResult, business, serviceTypes, From);
    
    // Update call log with conversation
    await pool.query(
      `UPDATE call_logs SET 
       conversation_log = conversation_log || $1,
       customer_intent = $2,
       customer_name = $3,
       customer_phone = $4,
       issue_type = $5,
       urgency_level = $6
       WHERE call_sid = $7`,
      [
        JSON.stringify([{ role: 'customer', content: SpeechResult, timestamp: new Date() }]),
        aiResponse.intent,
        aiResponse.customerName,
        From,
        aiResponse.issueType,
        aiResponse.urgencyLevel,
        CallSid
      ]
    );

    const twiml = new twilio.twiml.VoiceResponse();

    console.log(`🤖 AI Response:`, {
      action: aiResponse.action,
      response: aiResponse.response,
      intent: aiResponse.intent
    });

    if (aiResponse.action === 'book_appointment') {
      // Try to book the appointment
      try {
        const calendar = new DatabaseCalendarManager(businessId);
        const appointment = await calendar.bookAppointment(
          {
            name: aiResponse.customerName || 'Customer',
            phone: From,
            issue: aiResponse.issueDescription
          },
          aiResponse.appointmentTime,
          aiResponse.serviceTypeId,
          CallSid
        );

        // Update call log with successful booking
        await pool.query(
          `UPDATE call_logs SET 
           appointment_id = $1,
           booking_successful = true
           WHERE call_sid = $2`,
          [appointment.id, CallSid]
        );

        twiml.say({
          voice: business.ai_voice_id || 'Polly.Joanna-Neural'
        }, aiResponse.response);

      } catch (bookingError) {
        console.error('Booking error:', bookingError);
        
        // Update call log with booking failure
        await pool.query(
          `UPDATE call_logs SET 
           booking_successful = false,
           booking_failure_reason = $1
           WHERE call_sid = $2`,
          [bookingError.message, CallSid]
        );

        twiml.say({
          voice: business.ai_voice_id || 'Polly.Joanna-Neural'
        }, "I'm sorry, I'm having trouble booking that appointment right now. Let me have someone call you back to schedule that for you.");
      }
    } else if (aiResponse.action === 'get_more_info') {
      // Ask for more information
      twiml.say({
        voice: business.ai_voice_id || 'Polly.Joanna-Neural'
      }, aiResponse.response);

      twiml.gather({
        input: 'speech',
        timeout: 10,
        speechTimeout: 'auto',
        action: `/voice/process/${businessId}`,
        method: 'POST'
      });

      twiml.say('I didn\'t catch that. Let me have someone call you back.');
      twiml.hangup();
    } else {
      // Provide information or transfer
      twiml.say({
        voice: business.ai_voice_id || 'Polly.Joanna-Neural'
      }, aiResponse.response);
      twiml.hangup();
    }

    res.type('text/xml').send(twiml.toString());

  } catch (error) {
    console.error('Voice processing error:', error);
    const twiml = new twilio.twiml.VoiceResponse();
    twiml.say('Sorry, there was a technical issue. Please try calling back.');
    twiml.hangup();
    res.type('text/xml').send(twiml.toString());
  }
});

// Catch-all voice endpoint for debugging (must be after specific routes)
app.post('/voice/*', (req, res) => {
  console.log('📞 Voice request (catch-all):', req.path, req.body);
  const twiml = new twilio.twiml.VoiceResponse();
  twiml.say('Hello, this is CallCatcher. The system is being configured. Please try again shortly.');
  res.type('text/xml').send(twiml.toString());
});

// AI processing function
async function processCustomerRequest(speechText, business, serviceTypes, customerPhone) {
  try {
    const serviceTypesList = serviceTypes.map(st => 
      `${st.name}: ${st.description} - $${st.base_rate} (${st.duration_minutes} min)`
    ).join('\n');

    // Convert business_type back to readable format
    const businessTypeDisplay = business.business_type.replace(/_/g, ' ');
    
    const prompt = `You are Sarah, an AI assistant for ${business.name}, a ${businessTypeDisplay} business.

BUSINESS CONTEXT:
- Business: ${business.name}
- Type: ${businessTypeDisplay}
- Description: ${business.business_description || `Professional ${businessTypeDisplay} service business`}
- Personality: ${business.ai_personality || 'friendly'}

AVAILABLE SERVICES:
${serviceTypesList}

CUSTOMER REQUEST: "${speechText}"

SAFETY GUIDELINES:
- If customer uses profanity, inappropriate language, or discusses illegal activities, politely redirect to business services
- If request is not related to ${businessTypeDisplay} services, politely explain what services you offer
- If customer seems confused or intoxicated, offer to have someone call them back
- Never provide medical, legal, or financial advice

Your goal is to:
1. Understand what service they need (must be related to ${businessTypeDisplay})
2. Determine urgency level (emergency, high, medium, low)
3. Extract customer info if provided
4. Either book an appointment or ask for more info
5. Keep conversation focused on legitimate business services

RESPONSE FORMAT (JSON):
{
  "action": "book_appointment" | "get_more_info" | "provide_info",
  "response": "What you say to the customer",
  "intent": "emergency_repair" | "regular_service" | "pricing_inquiry" | "other",
  "urgencyLevel": "emergency" | "high" | "medium" | "low",
  "customerName": "extracted name or null",
  "issueType": "brief description",
  "issueDescription": "detailed description",
  "serviceTypeId": "uuid of matching service or null",
  "appointmentTime": "suggested time slot or null"
}

ACTION GUIDELINES:
- Use "get_more_info" if you ask ANY question that needs an answer (like "Would you like to schedule?" or "What's your name?")
- Use "book_appointment" only if you have customer name, service type, and can schedule immediately
- Use "provide_info" only for statements that don't need any response (like "We're closed" or "Here are our hours")

IMPORTANT: If you ask "Would you like to schedule an appointment?" you MUST use "get_more_info" action!

Keep responses natural, helpful, and under 25 words. Match the business personality.`;

    // Add timeout and faster model for real-time conversation
    const completion = await openai.chat.completions.create({
      model: "gpt-3.5-turbo", // Faster than GPT-4
      messages: [{ role: "user", content: prompt }],
      temperature: 0.7,
      max_tokens: 300 // Shorter responses for faster processing
    });

    const aiResponse = JSON.parse(completion.choices[0].message.content);
    
    // If booking appointment, find next available slot
    if (aiResponse.action === 'book_appointment' && aiResponse.serviceTypeId) {
      const calendar = new DatabaseCalendarManager(business.id);
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      
      const availableSlots = await calendar.getAvailableSlots(tomorrow, 60);
      if (availableSlots.length > 0) {
        aiResponse.appointmentTime = availableSlots[0].start;
      }
    }

    return aiResponse;

  } catch (error) {
    console.error('AI processing error:', error);
    return {
      action: 'provide_info',
      response: 'I apologize, but I\'m having trouble understanding right now. Let me have someone call you back.',
      intent: 'other',
      urgencyLevel: 'medium',
      customerName: null,
      issueType: 'unclear',
      issueDescription: speechText,
      serviceTypeId: null,
      appointmentTime: null
    };
  }
}

// Enhanced calendar manager with database
class DatabaseCalendarManager {
  constructor(businessId) {
    this.businessId = businessId;
  }

  async getAvailableSlots(date, requestedDuration = 60) {
    try {
      // Get business hours
      const businessResult = await pool.query(
        'SELECT business_hours FROM businesses WHERE id = $1',
        [this.businessId]
      );

      if (businessResult.rows.length === 0) {
        return [];
      }

      const businessHours = businessResult.rows[0].business_hours;
      const dayName = date.toLocaleDateString('en-US', { weekday: 'long' }).toLowerCase();
      const dayHours = businessHours[dayName];

      if (!dayHours || !dayHours.enabled) {
        return [];
      }

      const [startHour, startMinute] = dayHours.start.split(':').map(Number);
      const [endHour, endMinute] = dayHours.end.split(':').map(Number);

      // Get existing appointments for the day
      const dayStart = new Date(date);
      dayStart.setHours(0, 0, 0, 0);
      const dayEnd = new Date(date);
      dayEnd.setHours(23, 59, 59, 999);

      const appointmentsResult = await pool.query(
        `SELECT start_time, end_time, duration_minutes 
         FROM appointments 
         WHERE business_id = $1 AND start_time >= $2 AND start_time <= $3 AND status != 'cancelled'`,
        [this.businessId, dayStart.toISOString(), dayEnd.toISOString()]
      );

      const existingAppointments = appointmentsResult.rows;
      const slots = [];

      // Generate potential slots
      for (let hour = startHour; hour < endHour; hour++) {
        for (let minute = 0; minute < 60; minute += 30) {
          const slotStart = new Date(date);
          slotStart.setHours(hour, minute, 0, 0);

          // Add travel buffer
          const totalDuration = requestedDuration + 30;
          const slotEnd = new Date(slotStart.getTime() + totalDuration * 60000);

          // Check if slot is within business hours
          if (slotEnd.getHours() > endHour || 
              (slotEnd.getHours() === endHour && slotEnd.getMinutes() > endMinute)) {
            continue;
          }

          // Check conflicts with existing appointments
          const hasConflict = existingAppointments.some(apt => {
            const aptStart = new Date(apt.start_time);
            const aptEnd = new Date(apt.end_time);
            
            // Add buffers
            aptStart.setMinutes(aptStart.getMinutes() - 30);
            aptEnd.setMinutes(aptEnd.getMinutes() + 30);
            
            return (slotStart < aptEnd && slotEnd > aptStart);
          });

          if (!hasConflict) {
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
    } catch (error) {
      console.error('Error getting available slots:', error);
      return [];
    }
  }

  async bookAppointment(customerInfo, appointmentTime, serviceTypeId, callSid) {
    try {
      // Get service type details
      const serviceResult = await pool.query(
        'SELECT * FROM service_types WHERE id = $1 AND business_id = $2',
        [serviceTypeId, this.businessId]
      );

      if (serviceResult.rows.length === 0) {
        throw new Error('Service type not found');
      }

      const serviceType = serviceResult.rows[0];
      const startTime = new Date(appointmentTime);
      const endTime = new Date(startTime.getTime() + serviceType.duration_minutes * 60000);

      // Insert appointment
      const result = await pool.query(
        `INSERT INTO appointments (
          business_id, customer_name, customer_phone, customer_email, customer_address,
          service_type_id, service_name, issue_description, start_time, end_time,
          duration_minutes, estimated_revenue, call_sid, booking_source
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
        RETURNING *`,
        [
          this.businessId,
          customerInfo.name,
          customerInfo.phone,
          customerInfo.email || null,
          customerInfo.address || null,
          serviceTypeId,
          serviceType.name,
          customerInfo.issue || '',
          startTime.toISOString(),
          endTime.toISOString(),
          serviceType.duration_minutes,
          serviceType.base_rate,
          callSid,
          'ai_phone'
        ]
      );

      // Create notification
      await pool.query(
        `INSERT INTO notifications (business_id, type, title, message, data)
         VALUES ($1, $2, $3, $4, $5)`,
        [
          this.businessId,
          'new_booking',
          'New Appointment Booked',
          `${customerInfo.name} booked ${serviceType.name} for ${startTime.toLocaleString()}`,
          JSON.stringify({ appointmentId: result.rows[0].id })
        ]
      );

      console.log('✅ Appointment booked in database:', result.rows[0]);
      return result.rows[0];

    } catch (error) {
      console.error('Error booking appointment:', error);
      throw error;
    }
  }
}

// API endpoints for appointments
app.get('/api/businesses/:businessId/appointments', authenticateToken, getBusinessContext, async (req, res) => {
  try {
    const { date } = req.query;
    let query = `
      SELECT a.*, st.name as service_type_name, st.base_rate
      FROM appointments a
      LEFT JOIN service_types st ON a.service_type_id = st.id
      WHERE a.business_id = $1
    `;
    const params = [req.business.id];

    if (date) {
      const targetDate = new Date(date);
      const dayStart = new Date(targetDate);
      dayStart.setHours(0, 0, 0, 0);
      const dayEnd = new Date(targetDate);
      dayEnd.setHours(23, 59, 59, 999);

      query += ` AND a.start_time >= $2 AND a.start_time <= $3`;
      params.push(dayStart.toISOString(), dayEnd.toISOString());
    }

    query += ` ORDER BY a.start_time DESC LIMIT 50`;

    const result = await pool.query(query, params);
    res.json(result.rows);

  } catch (error) {
    console.error('Error fetching appointments:', error);
    res.status(500).json({ error: 'Failed to fetch appointments' });
  }
});

app.get('/api/businesses/:businessId/available-slots', authenticateToken, getBusinessContext, async (req, res) => {
  try {
    const { date, duration } = req.query;
    const targetDate = date ? new Date(date) : new Date();
    const requestedDuration = duration ? parseInt(duration) : 60;

    const calendar = new DatabaseCalendarManager(req.business.id);
    const slots = await calendar.getAvailableSlots(targetDate, requestedDuration);

    res.json(slots);
  } catch (error) {
    console.error('Error getting available slots:', error);
    res.status(500).json({ error: 'Failed to get available slots' });
  }
});

// Multi-tenant booking API endpoint
app.post('/api/book-appointment/:businessId?', async (req, res) => {
  try {
    const { businessId } = req.params;
    const { customerInfo, service, appointmentTime, bookedVia } = req.body;
    
    let businessResult;
    
    if (businessId) {
      // Get specific business
      businessResult = await pool.query('SELECT * FROM businesses WHERE id = $1', [businessId]);
    } else {
      // Fallback: use first business (demo mode)
      businessResult = await pool.query('SELECT * FROM businesses ORDER BY created_at LIMIT 1');
    }
    
    if (businessResult.rows.length === 0) {
      return res.status(404).json({ error: 'Business not found' });
    }
    
    const business = businessResult.rows[0];
    
    // Get the matching service type from database
    const serviceTypeResult = await pool.query(
      'SELECT * FROM service_types WHERE business_id = $1 AND service_key = $2',
      [business.id, service.type]
    );
    
    let serviceTypeId = null;
    let serviceName = service.name;
    let estimatedRevenue = service.rate;
    
    if (serviceTypeResult.rows.length > 0) {
      const serviceType = serviceTypeResult.rows[0];
      serviceTypeId = serviceType.id;
      serviceName = serviceType.name;
      estimatedRevenue = serviceType.base_rate;
    }
    
    const startTime = new Date(appointmentTime);
    const endTime = new Date(startTime.getTime() + service.duration * 60000);
    
    // Create appointment
    const appointmentResult = await pool.query(
      `INSERT INTO appointments (
        business_id, customer_name, customer_phone, customer_email, customer_address,
        service_type_id, service_name, issue_description, start_time, end_time,
        duration_minutes, estimated_revenue, booking_source
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
      RETURNING *`,
      [
        business.id,
        customerInfo.name,
        customerInfo.phone,
        customerInfo.email || null,
        customerInfo.address,
        serviceTypeId,
        serviceName,
        customerInfo.issue,
        startTime.toISOString(),
        endTime.toISOString(),
        service.duration,
        estimatedRevenue,
        bookedVia || 'website'
      ]
    );
    
    const appointment = appointmentResult.rows[0];
    
    // Create notification for business owner
    await pool.query(
      `INSERT INTO notifications (business_id, type, title, message, data)
       VALUES ($1, $2, $3, $4, $5)`,
      [
        business.id,
        'new_booking',
        'New Online Booking',
        `${customerInfo.name} booked ${serviceName} online for ${startTime.toLocaleString()}`,
        JSON.stringify({ appointmentId: appointment.id, source: 'website' })
      ]
    );
    
    // Send SMS notifications to team members (Enterprise feature)
    try {
      await sendNewAppointmentNotification(business, appointment);
    } catch (notificationError) {
      console.error('Failed to send team notifications:', notificationError);
      // Don't fail the booking if notifications fail
    }
    
    console.log('✅ Online appointment booked:', appointment.id);
    
    res.json({
      success: true,
      appointment: {
        id: appointment.id,
        service: serviceName,
        startTime: appointment.start_time,
        customerName: appointment.customer_name
      }
    });
    
  } catch (error) {
    console.error('Error booking appointment:', error);
    res.status(500).json({ error: 'Failed to book appointment' });
  }
});

// Multi-tenant services endpoint for booking page
app.get('/api/public/services/:businessId?', async (req, res) => {
  try {
    const { businessId } = req.params;
    let businessResult;
    
    if (businessId) {
      // Get specific business
      businessResult = await pool.query('SELECT * FROM businesses WHERE id = $1', [businessId]);
    } else {
      // Fallback: use first business (demo mode)
      businessResult = await pool.query('SELECT * FROM businesses ORDER BY created_at LIMIT 1');
    }
    
    if (businessResult.rows.length === 0) {
      return res.status(404).json({ error: 'Business not found' });
    }
    
    const business = businessResult.rows[0];
    
    const servicesResult = await pool.query(
      'SELECT * FROM service_types WHERE business_id = $1 AND is_active = true ORDER BY display_order, name',
      [business.id]
    );
    
    res.json({
      business: {
        name: business.name,
        phone: business.phone_number,
        businessType: business.business_type
      },
      services: servicesResult.rows
    });
    
  } catch (error) {
    console.error('Error getting public services:', error);
    res.status(500).json({ error: 'Failed to get services' });
  }
});

// Multi-tenant available slots endpoint
app.get('/api/available-slots/:businessId?', async (req, res) => {
  try {
    const { businessId } = req.params;
    const { date, duration } = req.query;
    const requestedDate = date ? new Date(date) : new Date();
    const requestedDuration = duration ? parseInt(duration) : 60;
    
    let businessResult;
    
    if (businessId) {
      // Get specific business
      businessResult = await pool.query('SELECT * FROM businesses WHERE id = $1', [businessId]);
    } else {
      // Fallback: use first business (demo mode) 
      businessResult = await pool.query('SELECT * FROM businesses ORDER BY created_at LIMIT 1');
    }
    
    if (businessResult.rows.length === 0) {
      return res.json([]);
    }
    
    const business = businessResult.rows[0];
    const calendar = new DatabaseCalendarManager(business.id);
    const slots = await calendar.getAvailableSlots(requestedDate, requestedDuration);
    
    res.json(slots);
    
  } catch (error) {
    console.error('Error getting available slots:', error);
    res.status(500).json({ error: 'Failed to get available slots' });
  }
});

// Industry template endpoints for AI-powered service generation
app.get('/api/industry-templates', async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT industry_type, template_name, description FROM industry_templates WHERE is_active = true ORDER BY industry_type'
    );
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching industry templates:', error);
    res.status(500).json({ error: 'Failed to fetch industry templates' });
  }
});

app.get('/api/industry-templates/:industryType', async (req, res) => {
  try {
    const { industryType } = req.params;
    const result = await pool.query(
      'SELECT * FROM industry_templates WHERE industry_type = $1 AND is_active = true',
      [industryType]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Industry template not found' });
    }
    
    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error fetching industry template:', error);
    res.status(500).json({ error: 'Failed to fetch industry template' });
  }
});

// Regenerate services for an existing business (fix old plumbing services)
app.post('/api/businesses/:businessId/regenerate-services', authenticateToken, getBusinessContext, async (req, res) => {
  try {
    console.log(`🔄 Regenerating services for business: ${req.business.name} (${req.business.business_type})`);
    
    // Delete existing services
    await pool.query('DELETE FROM service_types WHERE business_id = $1', [req.business.id]);
    console.log('🗑️ Deleted old services');
    
    // Generate new AI services
    const generatedServices = await generateServicesWithAI(req.business.business_type, req.business.name);
    console.log(`🤖 Generated ${generatedServices.length} new services`);
    
    // Insert new services
    for (const serviceType of generatedServices) {
      await pool.query(
        `INSERT INTO service_types (business_id, name, service_key, description, duration_minutes, base_rate, emergency_multiplier, travel_buffer_minutes, is_emergency, is_active)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [
          req.business.id,
          serviceType.name,
          serviceType.service_key,
          serviceType.description,
          serviceType.duration_minutes,
          serviceType.base_rate,
          serviceType.emergency_multiplier,
          serviceType.travel_buffer_minutes,
          serviceType.is_emergency,
          serviceType.is_active
        ]
      );
    }
    
    console.log(`✅ Successfully regenerated services for ${req.business.name}`);
    
    res.json({
      success: true,
      message: `Regenerated ${generatedServices.length} services for ${req.business.name}`,
      services: generatedServices
    });
    
  } catch (error) {
    console.error('Error regenerating services:', error);
    res.status(500).json({ error: 'Failed to regenerate services' });
  }
});

// Generate services for a business type using Claude/OpenAI
app.post('/api/generate-services', async (req, res) => {
  try {
    const { businessType, businessName } = req.body;
    
    if (!businessType) {
      return res.status(400).json({ error: 'Business type is required' });
    }

    // Check if we have a cached template first
    const templateResult = await pool.query(
      'SELECT service_templates FROM industry_templates WHERE industry_type = $1 AND is_active = true',
      [businessType]
    );

    if (templateResult.rows.length > 0) {
      // Return cached template
      return res.json({
        source: 'cached',
        services: templateResult.rows[0].service_templates
      });
    }

    // Generate new services using AI
    const generatedServices = await generateServicesWithAI(businessType, businessName);
    
    // Cache the template for future use
    await pool.query(
      `INSERT INTO industry_templates (industry_type, template_name, description, service_templates, created_by)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (industry_type) DO UPDATE SET
       service_templates = $4, last_updated = CURRENT_TIMESTAMP`,
      [
        businessType,
        `${businessType.charAt(0).toUpperCase() + businessType.slice(1)} Services Template`,
        `AI-generated service template for ${businessType} businesses`,
        JSON.stringify(generatedServices),
        'claude'
      ]
    );

    res.json({
      source: 'generated',
      services: generatedServices
    });

  } catch (error) {
    console.error('Error generating services:', error);
    res.status(500).json({ error: 'Failed to generate services' });
  }
});

// AI Service Generation Function
async function generateServicesWithAI(businessType, businessName = '') {
  const industryPrompts = {
    plumbing: `Generate 10 essential plumbing services that a residential/commercial plumbing business typically offers. Include pricing, duration, and whether it's an emergency service.`,
    electrical: `Generate 10 essential electrical services that a residential/commercial electrical business typically offers. Include pricing, duration, and whether it's an emergency service.`,
    hvac: `Generate 10 essential HVAC services that a heating/cooling business typically offers. Include pricing, duration, and whether it's an emergency service.`,
    cleaning: `Generate 10 essential cleaning services that a residential/commercial cleaning business typically offers. Include pricing, duration, and whether it's an emergency service.`,
    handyman: `Generate 10 essential handyman services that a general repair business typically offers. Include pricing, duration, and whether it's an emergency service.`,
    appliance: `Generate 10 essential appliance repair services that an appliance repair business typically offers. Include pricing, duration, and whether it's an emergency service.`,
    locksmith: `Generate 10 essential locksmith services that a locksmith business typically offers. Include pricing, duration, and whether it's an emergency service.`,
    pest_control: `Generate 10 essential pest control services that a pest control business typically offers. Include pricing, duration, and whether it's an emergency service.`,
    landscaping: `Generate 10 essential landscaping services that a landscaping/lawn care business typically offers. Include pricing, duration, and whether it's an emergency service.`,
    roofing: `Generate 10 essential roofing services that a roofing contractor business typically offers. Include pricing, duration, and whether it's an emergency service.`,
    auto_repair: `Generate 10 essential auto repair services that an automotive repair shop typically offers. Include pricing, duration, and whether it's an emergency service.`,
    carpet_cleaning: `Generate 10 essential carpet and upholstery cleaning services that a carpet cleaning business typically offers. Include pricing, duration, and whether it's an emergency service.`,
    pool_service: `Generate 10 essential pool and spa services that a pool maintenance business typically offers. Include pricing, duration, and whether it's an emergency service.`,
    home_security: `Generate 10 essential home security services that a security system business typically offers. Include pricing, duration, and whether it's an emergency service.`,
    moving: `Generate 10 essential moving and relocation services that a moving company typically offers. Include pricing, duration, and whether it's an emergency service.`,
    painting: `Generate 10 essential painting services that a residential/commercial painting business typically offers. Include pricing, duration, and whether it's an emergency service.`,
    flooring: `Generate 10 essential flooring services that a flooring contractor business typically offers. Include pricing, duration, and whether it's an emergency service.`,
    tax_preparation: `Generate 10 essential tax preparation and accounting services that a tax preparation business typically offers. Include pricing, duration, and whether it's an emergency service.`
  };

  // Use predefined prompt if available, otherwise create dynamic prompt for custom business types
  let prompt;
  if (industryPrompts[businessType]) {
    prompt = industryPrompts[businessType];
  } else {
    // Dynamic prompt generation for custom business types
    prompt = `Generate 10 essential services that a ${businessType} business typically offers to customers. Research the ${businessType} industry and create realistic, professional services with appropriate pricing, duration, and emergency classification. Include both basic and premium service options.`;
  }

  const fullPrompt = `${prompt}

BUSINESS TYPE: ${businessType}
${businessName ? `BUSINESS NAME: ${businessName}` : ''}

Return a JSON array of exactly 10 service objects. Each service should have:
- name: Service name (e.g., "Emergency Drain Cleaning", "Dog Grooming - Full Service")
- service_key: URL-friendly key (e.g., "emergency-drain-cleaning", "dog-grooming-full") 
- description: Brief description of what's included (customer-friendly)
- duration_minutes: Typical duration in minutes (15-480 range, realistic for the service)
- base_rate: Average price in USD (research realistic market rates for this industry)
- emergency_multiplier: 1.0 for normal services, 1.5-2.0 for emergency/urgent services
- travel_buffer_minutes: Travel time to add (15-60 minutes, appropriate for industry)
- is_emergency: true for urgent/emergency services, false for scheduled services

IMPORTANT: Research the ${businessType} industry to provide realistic, competitive pricing and appropriate service offerings. Include a mix of:
- 1-2 emergency/urgent services (if applicable to this industry)
- 3-4 basic/standard services 
- 3-4 premium/comprehensive services
- 1-2 maintenance/routine services

Make descriptions professional but customer-friendly. Ensure pricing reflects real market rates.

Example format:
[
  {
    "name": "Emergency Service Call",
    "service_key": "emergency-service-call",
    "description": "Urgent same-day service for critical issues",
    "duration_minutes": 90,
    "base_rate": 150,
    "emergency_multiplier": 1.75,
    "travel_buffer_minutes": 30,
    "is_emergency": true
  }
]`;

  try {
    // Retry AI generation up to 3 times
    for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      console.log(`🤖 AI generation attempt ${attempt}/3 for ${businessType}`);
      
      // Use faster model for better reliability
      const completion = await openai.chat.completions.create({
        model: "gpt-3.5-turbo",
        messages: [{ 
          role: "system", 
          content: "You are a business services expert. Always respond with valid JSON only. No explanations or additional text."
        }, {
          role: "user", 
          content: fullPrompt
        }],
        temperature: 0.3, // Lower temperature for more consistent output
        max_tokens: 2000
      });

      const servicesText = completion.choices[0].message.content.trim();
      console.log(`📝 AI response preview: ${servicesText.substring(0, 100)}...`);
      
      // More robust JSON extraction
      let jsonText = servicesText;
      
      // Try to extract JSON array if embedded in text
      const jsonMatch = servicesText.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        jsonText = jsonMatch[0];
      }
      
      // Clean up common JSON issues
      jsonText = jsonText
        .replace(/```json|```/g, '') // Remove markdown code blocks
        .replace(/\n/g, ' ') // Remove newlines
        .trim();

      const services = JSON.parse(jsonText);
      
      // Validate the response
      if (!Array.isArray(services) || services.length === 0) {
        throw new Error(`Invalid services array: got ${typeof services} with length ${services?.length}`);
      }
      
      console.log(`✅ AI generated ${services.length} services successfully on attempt ${attempt}`);
      
      // Validate and clean the services before returning
      return services.map((service, index) => ({
        name: service.name || `Service ${index + 1}`,
        service_key: service.service_key || service.name?.toLowerCase().replace(/[^a-z0-9]/g, '-') || `service-${index + 1}`,
        description: service.description || 'Professional service',
        duration_minutes: Math.max(15, Math.min(480, service.duration_minutes || 60)),
        base_rate: Math.max(25, service.base_rate || 100),
        emergency_multiplier: service.emergency_multiplier || 1.0,
        travel_buffer_minutes: Math.max(0, Math.min(60, service.travel_buffer_minutes || 30)),
        is_emergency: service.is_emergency || false,
        is_active: true
      }));
      
    } catch (parseError) {
      console.error(`❌ AI generation attempt ${attempt} failed:`, parseError.message);
      
      if (attempt === 3) {
        // Final attempt failed, throw to trigger fallback
        throw new Error(`AI generation failed after 3 attempts. Last error: ${parseError.message}`);
      }
      
      // Wait before retry
      await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
      continue;
    }
    }
    
    // This should never be reached due to the throw above, but just in case
    throw new Error('Unexpected end of AI generation retry loop');
  
  } catch (error) {
    console.error('AI service generation error:', error);
    console.error('Error details:', error.message);
    
    // DO NOT FALLBACK TO WRONG BUSINESS TYPE
    // If AI fails, create basic services for the actual business type
    const businessName = businessType.replace(/[_-]/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
    console.log(`🔧 Creating basic ${businessName} services as AI fallback`);
    
    return [
      {
        name: `${businessName} Consultation`,
        service_key: `${businessType}-consultation`,
        description: `Professional ${businessName.toLowerCase()} consultation and assessment`,
        duration_minutes: 60,
        base_rate: 100,
        emergency_multiplier: 1.0,
        travel_buffer_minutes: 30,
        is_emergency: false,
        is_active: true
      },
      {
        name: `${businessName} Service`,
        service_key: `${businessType}-service`,
        description: `Professional ${businessName.toLowerCase()} service`,
        duration_minutes: 90,
        base_rate: 150,
        emergency_multiplier: 1.0,
        travel_buffer_minutes: 30,
        is_emergency: false,
        is_active: true
      },
      {
        name: `Emergency ${businessName}`,
        service_key: `emergency-${businessType}`,
        description: `Urgent ${businessName.toLowerCase()} service`,
        duration_minutes: 60,
        base_rate: 200,
        emergency_multiplier: 1.5,
        travel_buffer_minutes: 30,
        is_emergency: true,
        is_active: true
      }
    ];
  }
}

// Fallback service template if AI generation fails
function getBasicServiceTemplate(businessType) {
  const basicTemplates = {
    plumbing: [
      { name: "Emergency Repair", service_key: "emergency-repair", description: "Emergency plumbing repairs", duration_minutes: 90, base_rate: 150, emergency_multiplier: 1.5, travel_buffer_minutes: 30, is_emergency: true, is_active: true },
      { name: "Drain Cleaning", service_key: "drain-cleaning", description: "Professional drain cleaning", duration_minutes: 60, base_rate: 120, emergency_multiplier: 1.0, travel_buffer_minutes: 30, is_emergency: false, is_active: true },
      { name: "Water Heater Service", service_key: "water-heater", description: "Water heater repair and installation", duration_minutes: 120, base_rate: 200, emergency_multiplier: 1.0, travel_buffer_minutes: 45, is_emergency: false, is_active: true }
    ],
    electrical: [
      { name: "Emergency Electrical", service_key: "emergency-electrical", description: "Emergency electrical repairs", duration_minutes: 90, base_rate: 175, emergency_multiplier: 1.5, travel_buffer_minutes: 30, is_emergency: true, is_active: true },
      { name: "Outlet Installation", service_key: "outlet-installation", description: "New outlet installation", duration_minutes: 60, base_rate: 150, emergency_multiplier: 1.0, travel_buffer_minutes: 30, is_emergency: false, is_active: true }
    ],
    cleaning: [
      { name: "Deep House Cleaning", service_key: "deep-house-cleaning", description: "Comprehensive home cleaning service", duration_minutes: 180, base_rate: 200, emergency_multiplier: 1.0, travel_buffer_minutes: 30, is_emergency: false, is_active: true },
      { name: "Regular Cleaning", service_key: "regular-cleaning", description: "Weekly/biweekly maintenance cleaning", duration_minutes: 120, base_rate: 120, emergency_multiplier: 1.0, travel_buffer_minutes: 30, is_emergency: false, is_active: true }
    ],
    landscaping: [
      { name: "Lawn Maintenance", service_key: "lawn-maintenance", description: "Regular lawn mowing and trimming", duration_minutes: 60, base_rate: 80, emergency_multiplier: 1.0, travel_buffer_minutes: 15, is_emergency: false, is_active: true },
      { name: "Tree Removal", service_key: "tree-removal", description: "Professional tree removal service", duration_minutes: 240, base_rate: 500, emergency_multiplier: 1.5, travel_buffer_minutes: 45, is_emergency: false, is_active: true }
    ],
    auto_repair: [
      { name: "Oil Change", service_key: "oil-change", description: "Quick oil change and filter replacement", duration_minutes: 30, base_rate: 50, emergency_multiplier: 1.0, travel_buffer_minutes: 15, is_emergency: false, is_active: true },
      { name: "Emergency Roadside", service_key: "emergency-roadside", description: "Emergency roadside assistance", duration_minutes: 60, base_rate: 100, emergency_multiplier: 1.5, travel_buffer_minutes: 30, is_emergency: true, is_active: true }
    ],
    tax_preparation: [
      { name: "Individual Tax Return", service_key: "individual-tax-return", description: "Complete individual tax return preparation", duration_minutes: 90, base_rate: 150, emergency_multiplier: 1.0, travel_buffer_minutes: 0, is_emergency: false, is_active: true },
      { name: "Business Tax Return", service_key: "business-tax-return", description: "Small business tax return preparation", duration_minutes: 120, base_rate: 250, emergency_multiplier: 1.0, travel_buffer_minutes: 0, is_emergency: false, is_active: true },
      { name: "Tax Consultation", service_key: "tax-consultation", description: "Professional tax advice and planning", duration_minutes: 60, base_rate: 100, emergency_multiplier: 1.0, travel_buffer_minutes: 0, is_emergency: false, is_active: true }
    ]
  };

  // If no template exists, create a dynamic fallback based on business type
  if (!basicTemplates[businessType]) {
    const businessName = businessType.replace(/[_-]/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
    return [
      { name: `${businessName} Service Call`, service_key: `${businessType}-service-call`, description: `Professional ${businessName.toLowerCase()} service`, duration_minutes: 60, base_rate: 100, emergency_multiplier: 1.0, travel_buffer_minutes: 30, is_emergency: false, is_active: true },
      { name: `Emergency ${businessName}`, service_key: `emergency-${businessType}`, description: `Urgent ${businessName.toLowerCase()} service`, duration_minutes: 90, base_rate: 150, emergency_multiplier: 1.5, travel_buffer_minutes: 30, is_emergency: true, is_active: true },
      { name: `${businessName} Consultation`, service_key: `${businessType}-consultation`, description: `Professional consultation and estimate`, duration_minutes: 45, base_rate: 75, emergency_multiplier: 1.0, travel_buffer_minutes: 30, is_emergency: false, is_active: true }
    ];
  }

  return basicTemplates[businessType];
}

// Team Management API Endpoints (Enterprise Feature)
app.get('/api/businesses/:businessId/team-members', authenticateToken, getBusinessContext, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM team_members WHERE business_id = $1 ORDER BY created_at',
      [req.business.id]
    );
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching team members:', error);
    res.status(500).json({ error: 'Failed to fetch team members' });
  }
});

app.post('/api/businesses/:businessId/team-members', authenticateToken, getBusinessContext, async (req, res) => {
  try {
    const { name, email, mobile_phone, role, specialties, can_receive_notifications } = req.body;
    
    if (!name || !mobile_phone) {
      return res.status(400).json({ error: 'Name and mobile phone are required' });
    }

    const result = await pool.query(
      `INSERT INTO team_members (business_id, name, email, mobile_phone, role, specialties, can_receive_notifications)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [req.business.id, name, email, mobile_phone, role || 'technician', specialties || [], can_receive_notifications !== false]
    );
    
    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error creating team member:', error);
    res.status(500).json({ error: 'Failed to create team member' });
  }
});

app.put('/api/businesses/:businessId/team-members/:memberId', authenticateToken, getBusinessContext, async (req, res) => {
  try {
    const { memberId } = req.params;
    const { name, email, mobile_phone, role, specialties, can_receive_notifications, is_active } = req.body;
    
    const result = await pool.query(
      `UPDATE team_members SET 
       name = $1, email = $2, mobile_phone = $3, role = $4, specialties = $5, 
       can_receive_notifications = $6, is_active = $7, updated_at = CURRENT_TIMESTAMP
       WHERE id = $8 AND business_id = $9 RETURNING *`,
      [name, email, mobile_phone, role, specialties, can_receive_notifications, is_active, memberId, req.business.id]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Team member not found' });
    }
    
    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error updating team member:', error);
    res.status(500).json({ error: 'Failed to update team member' });
  }
});

app.delete('/api/businesses/:businessId/team-members/:memberId', authenticateToken, getBusinessContext, async (req, res) => {
  try {
    const { memberId } = req.params;
    
    const result = await pool.query(
      'DELETE FROM team_members WHERE id = $1 AND business_id = $2 RETURNING *',
      [memberId, req.business.id]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Team member not found' });
    }
    
    res.json({ success: true, message: 'Team member deleted' });
  } catch (error) {
    console.error('Error deleting team member:', error);
    res.status(500).json({ error: 'Failed to delete team member' });
  }
});

// Appointment Assignment API
app.post('/api/businesses/:businessId/appointments/:appointmentId/assign', authenticateToken, getBusinessContext, async (req, res) => {
  try {
    const { appointmentId } = req.params;
    const { team_member_id, assignment_notes } = req.body;
    
    // Verify team member belongs to this business
    const teamMemberResult = await pool.query(
      'SELECT * FROM team_members WHERE id = $1 AND business_id = $2 AND is_active = true',
      [team_member_id, req.business.id]
    );
    
    if (teamMemberResult.rows.length === 0) {
      return res.status(404).json({ error: 'Team member not found' });
    }
    
    const teamMember = teamMemberResult.rows[0];
    
    // Update appointment assignment
    const appointmentResult = await pool.query(
      `UPDATE appointments SET 
       assigned_to = $1, assigned_at = CURRENT_TIMESTAMP, assignment_notes = $2, notification_sent = false
       WHERE id = $3 AND business_id = $4 RETURNING *`,
      [team_member_id, assignment_notes, appointmentId, req.business.id]
    );
    
    if (appointmentResult.rows.length === 0) {
      return res.status(404).json({ error: 'Appointment not found' });
    }
    
    const appointment = appointmentResult.rows[0];
    
    // Send SMS notification if team member has notifications enabled
    if (teamMember.can_receive_notifications && teamMember.notification_preferences.assignment_changes) {
      try {
        await sendAppointmentAssignmentNotification(teamMember, appointment, req.business);
        
        // Mark notification as sent
        await pool.query(
          'UPDATE appointments SET notification_sent = true WHERE id = $1',
          [appointmentId]
        );
      } catch (notificationError) {
        console.error('Failed to send assignment notification:', notificationError);
        // Don't fail the assignment if notification fails
      }
    }
    
    res.json({
      success: true,
      appointment: appointmentResult.rows[0],
      assigned_to: teamMember
    });
    
  } catch (error) {
    console.error('Error assigning appointment:', error);
    res.status(500).json({ error: 'Failed to assign appointment' });
  }
});

// SMS Notification Functions
async function sendAppointmentAssignmentNotification(teamMember, appointment, business) {
  try {
    const appointmentTime = new Date(appointment.start_time).toLocaleString('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true
    });
    
    const message = `🔧 ${business.name}: New appointment assigned to you!\n\n` +
                   `📅 ${appointmentTime}\n` +
                   `👤 ${appointment.customer_name}\n` +
                   `📞 ${appointment.customer_phone}\n` +
                   `🔧 ${appointment.service_name}\n` +
                   `📍 ${appointment.customer_address}\n\n` +
                   `💡 ${appointment.issue_description || 'No description provided'}\n\n` +
                   `Reply CONFIRM to acknowledge assignment.`;
    
    const twilioMessage = await twilioClient.messages.create({
      body: message,
      from: business.phone_number || process.env.TWILIO_PHONE_NUMBER,
      to: teamMember.mobile_phone
    });
    
    console.log(`📱 Assignment notification sent to ${teamMember.name}: ${twilioMessage.sid}`);
    return twilioMessage;
    
  } catch (error) {
    console.error('SMS notification error:', error);
    throw error;
  }
}

async function sendNewAppointmentNotification(business, appointment) {
  try {
    // Get all team members who should receive notifications
    const teamMembersResult = await pool.query(
      `SELECT * FROM team_members 
       WHERE business_id = $1 AND is_active = true AND can_receive_notifications = true`,
      [business.id]
    );
    
    const appointmentTime = new Date(appointment.start_time).toLocaleString('en-US', {
      weekday: 'short',
      month: 'short', 
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true
    });
    
    const message = `📞 ${business.name}: New appointment booked!\n\n` +
                   `📅 ${appointmentTime}\n` +
                   `👤 ${appointment.customer_name}\n` +
                   `📞 ${appointment.customer_phone}\n` +
                   `🔧 ${appointment.service_name}\n` +
                   `📍 ${appointment.customer_address}\n\n` +
                   `${appointment.is_emergency ? '🚨 EMERGENCY SERVICE' : ''}`;
    
    // Send notifications to all eligible team members
    const notifications = [];
    for (const member of teamMembersResult.rows) {
      if (member.notification_preferences.new_appointments) {
        try {
          const twilioMessage = await twilioClient.messages.create({
            body: message,
            from: business.phone_number || process.env.TWILIO_PHONE_NUMBER,
            to: member.mobile_phone
          });
          notifications.push({ member: member.name, sid: twilioMessage.sid });
        } catch (memberError) {
          console.error(`Failed to notify ${member.name}:`, memberError);
        }
      }
    }
    
    console.log(`📱 New appointment notifications sent to ${notifications.length} team members`);
    return notifications;
    
  } catch (error) {
    console.error('Team notification error:', error);
    throw error;
  }
}

// Admin endpoint to fix business data (temporary for debugging)
app.post('/api/admin/fix-business/:businessId', async (req, res) => {
  try {
    const { businessId } = req.params;
    const { businessType } = req.body;
    
    if (!businessType) {
      return res.status(400).json({ error: 'Business type is required' });
    }
    
    console.log(`🔧 Admin: Fixing business ${businessId} with type ${businessType}`);
    
    // Update business type
    await pool.query(
      'UPDATE businesses SET business_type = $1 WHERE id = $2',
      [businessType, businessId]
    );
    
    // Delete old services
    await pool.query('DELETE FROM service_types WHERE business_id = $1', [businessId]);
    console.log('🗑️ Deleted old services');
    
    // Create tax preparation services manually since AI might be failing
    const taxServices = [
      {
        name: "Individual Tax Return",
        service_key: "individual-tax-return",
        description: "Complete individual tax return preparation and filing",
        duration_minutes: 90,
        base_rate: 150,
        emergency_multiplier: 1.0,
        travel_buffer_minutes: 0,
        is_emergency: false,
        is_active: true
      },
      {
        name: "Business Tax Return",
        service_key: "business-tax-return", 
        description: "Small business tax return preparation and filing",
        duration_minutes: 120,
        base_rate: 250,
        emergency_multiplier: 1.0,
        travel_buffer_minutes: 0,
        is_emergency: false,
        is_active: true
      },
      {
        name: "Tax Consultation",
        service_key: "tax-consultation",
        description: "Professional tax advice and planning session",
        duration_minutes: 60,
        base_rate: 100,
        emergency_multiplier: 1.0,
        travel_buffer_minutes: 0,
        is_emergency: false,
        is_active: true
      },
      {
        name: "Bookkeeping Services",
        service_key: "bookkeeping",
        description: "Monthly bookkeeping and financial record management",
        duration_minutes: 120,
        base_rate: 75,
        emergency_multiplier: 1.0,
        travel_buffer_minutes: 0,
        is_emergency: false,
        is_active: true
      },
      {
        name: "Tax Amendment",
        service_key: "tax-amendment",
        description: "Amend previous year tax returns",
        duration_minutes: 60,
        base_rate: 125,
        emergency_multiplier: 1.0,
        travel_buffer_minutes: 0,
        is_emergency: false,
        is_active: true
      }
    ];
    
    // Insert tax services
    for (const serviceType of taxServices) {
      await pool.query(
        `INSERT INTO service_types (business_id, name, service_key, description, duration_minutes, base_rate, emergency_multiplier, travel_buffer_minutes, is_emergency, is_active)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [
          businessId,
          serviceType.name,
          serviceType.service_key,
          serviceType.description,
          serviceType.duration_minutes,
          serviceType.base_rate,
          serviceType.emergency_multiplier,
          serviceType.travel_buffer_minutes,
          serviceType.is_emergency,
          serviceType.is_active
        ]
      );
    }
    
    console.log(`✅ Successfully fixed business ${businessId} with ${taxServices.length} ${businessType} services`);
    
    res.json({
      success: true,
      message: `Fixed business with ${taxServices.length} ${businessType} services`,
      services: taxServices
    });
    
  } catch (error) {
    console.error('Error fixing business:', error);
    res.status(500).json({ error: 'Failed to fix business', details: error.message });
  }
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    version: '2.0.0',
    features: ['multi-tenant', 'database', 'authentication', 'billing', 'ai-templates', 'team-management']
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 CallCatcher SaaS running on port ${PORT}`);
  console.log(`🏠 Landing page: /`);
  console.log(`📋 Onboarding: /onboarding`);
  console.log(`📊 Dashboard: /dashboard`);
  console.log(`💾 Database: ${process.env.DATABASE_URL ? 'Connected' : 'Not configured'}`);
});
