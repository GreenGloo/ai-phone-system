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
const { processSimpleVoice } = require('./simple-booking');

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cors());

// Debug middleware to log all API requests
app.use('/api', (req, res, next) => {
  console.log(`🌐 ${req.method} ${req.path} - Headers: ${JSON.stringify(req.headers.authorization ? 'Bearer ***' : 'No auth')}`);
  next();
});

// IMPORTANT: Root route MUST be defined before static middleware  
app.get('/', (req, res) => {
  console.log('🏠 Serving landing page from root route');
  res.sendFile(path.join(__dirname, 'public', 'landing.html'));
});

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

  console.log(`🔐 authenticateToken - ${req.method} ${req.path} - Token: ${token ? 'Present' : 'Missing'}`);

  if (!token) {
    console.log(`🔐 authenticateToken - No token provided`);
    return res.status(401).json({ error: 'Access token required' });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    console.log(`🔐 authenticateToken - Decoded userId: ${decoded.userId}`);
    
    const result = await pool.query('SELECT * FROM users WHERE id = $1', [decoded.userId]);
    
    if (result.rows.length === 0) {
      console.log(`🔐 authenticateToken - User not found: ${decoded.userId}`);
      return res.status(401).json({ error: 'Invalid token' });
    }

    console.log(`🔐 authenticateToken - User found: ${result.rows[0].email}`);
    req.user = result.rows[0];
    next();
  } catch (error) {
    console.log(`🔐 authenticateToken - Token verification failed: ${error.message}`);
    return res.status(403).json({ error: 'Invalid token' });
  }
};

// Middleware to get business context
const getBusinessContext = async (req, res, next) => {
  try {
    const businessId = req.params.businessId || req.body.businessId || req.query.businessId;
    
    console.log('🔍 getBusinessContext - businessId:', businessId);
    console.log('🔍 getBusinessContext - user:', req.user ? req.user.id : 'No user');
    
    if (!businessId) {
      return res.status(400).json({ error: 'Business ID required' });
    }

    const result = await pool.query(
      'SELECT * FROM businesses WHERE id = $1 AND user_id = $2',
      [businessId, req.user.id]
    );

    console.log('🔍 getBusinessContext - query result:', result.rows.length > 0 ? 'Found' : 'Not found');

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

// Other static page routes
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

// Log all voice requests for debugging
app.use('/voice*', (req, res, next) => {
  console.log('🔍 VOICE REQUEST:', {
    path: req.path,
    method: req.method,
    body: req.body,
    query: req.query,
    timestamp: new Date().toISOString()
  });
  next();
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

// Calendar management endpoints
app.get('/api/businesses/:businessId/calendar-settings', authenticateToken, getBusinessContext, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT business_hours, calendar_preferences FROM businesses WHERE id = $1',
      [req.business.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Business not found' });
    }

    res.json({
      businessHours: result.rows[0].business_hours,
      calendarPreferences: result.rows[0].calendar_preferences || {
        appointmentDuration: 60,
        bufferTime: 30,
        maxDailyAppointments: 8,
        preferredSlots: null,
        blockOutTimes: []
      }
    });
  } catch (error) {
    console.error('Error fetching calendar settings:', error);
    res.status(500).json({ error: 'Failed to fetch calendar settings' });
  }
});

app.put('/api/businesses/:businessId/calendar-settings', authenticateToken, getBusinessContext, async (req, res) => {
  try {
    const { businessHours, calendarPreferences } = req.body;
    
    const result = await pool.query(
      `UPDATE businesses SET 
       business_hours = $1, 
       calendar_preferences = $2,
       updated_at = CURRENT_TIMESTAMP
       WHERE id = $3 RETURNING *`,
      [businessHours, calendarPreferences, req.business.id]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Business not found' });
    }
    
    res.json({
      success: true,
      businessHours: result.rows[0].business_hours,
      calendarPreferences: result.rows[0].calendar_preferences
    });
  } catch (error) {
    console.error('Error updating calendar settings:', error);
    res.status(500).json({ error: 'Failed to update calendar settings' });
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
      timeout: 12, // Longer timeout for customer to respond
      speechTimeout: 'auto',
      action: `/voice/process/${businessId}`,
      method: 'POST'
    });

    // First retry - ask again instead of giving up
    twiml.say('I didn\'t catch that. Could you please tell me what service you need?');
    
    twiml.gather({
      input: 'speech',
      timeout: 10,
      speechTimeout: 'auto', 
      action: `/voice/process/${businessId}`,
      method: 'POST'
    });
    
    // Only execute if both gathers fail
    twiml.say('I\'m having trouble hearing you. Let me have someone call you back.');
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

// Legacy voice processing endpoint (fallback for old webhooks)
app.post('/voice/process', async (req, res) => {
  try {
    console.log('📞 Legacy voice endpoint hit - redirecting to business-specific endpoint');
    
    // Get the first business as fallback
    const businessResult = await pool.query('SELECT id FROM businesses ORDER BY created_at LIMIT 1');
    
    if (businessResult.rows.length === 0) {
      const twiml = new twilio.twiml.VoiceResponse();
      twiml.say('Sorry, no businesses are configured. Please contact support.');
      return res.type('text/xml').send(twiml.toString());
    }
    
    const businessId = businessResult.rows[0].id;
    console.log(`🔀 Redirecting to business ${businessId}`);
    
    // Forward to the business-specific endpoint
    req.params.businessId = businessId;
    return processVoiceForBusiness(req, res);
    
  } catch (error) {
    console.error('Legacy voice endpoint error:', error);
    const twiml = new twilio.twiml.VoiceResponse();
    twiml.say('Sorry, there was a technical issue. Please try calling back.');
    twiml.hangup();
    res.type('text/xml').send(twiml.toString());
  }
});

// SIMPLE BOOKING ENDPOINT - Redesigned for reliability
app.post('/voice/simple/:businessId', processSimpleVoice);

// PUBLIC BOOKING CALENDAR - For customers to book manually
app.get('/book/:businessId', async (req, res) => {
  try {
    const businessId = req.params.businessId;
    
    // Get business info and services
    const businessResult = await pool.query(
      'SELECT * FROM businesses WHERE id = $1 AND status = $2',
      [businessId, 'active']
    );
    
    if (businessResult.rows.length === 0) {
      return res.status(404).send('Business not found or inactive');
    }
    
    const business = businessResult.rows[0];
    
    // Get active services
    const servicesResult = await pool.query(
      'SELECT * FROM service_types WHERE business_id = $1 AND is_active = true ORDER BY display_order, name',
      [businessId]
    );
    
    const services = servicesResult.rows;
    
    // Generate public booking page HTML
    const bookingHTML = generateBookingPageHTML(business, services);
    res.send(bookingHTML);
    
  } catch (error) {
    console.error('Public booking page error:', error);
    res.status(500).send('Booking system temporarily unavailable');
  }
});

// API endpoint for public booking submission
app.post('/api/book/:businessId', async (req, res) => {
  try {
    const businessId = req.params.businessId;
    const { customerName, customerPhone, customerEmail, serviceId, appointmentDate, appointmentTime, notes } = req.body;
    
    // Validate required fields
    if (!customerName || !customerPhone || !serviceId || !appointmentDate || !appointmentTime) {
      return res.status(400).json({ error: 'Please fill in all required fields' });
    }
    
    // Get service details
    const serviceResult = await pool.query(
      'SELECT * FROM service_types WHERE id = $1 AND business_id = $2 AND is_active = true',
      [serviceId, businessId]
    );
    
    if (serviceResult.rows.length === 0) {
      return res.status(400).json({ error: 'Invalid service selected' });
    }
    
    const service = serviceResult.rows[0];
    
    // Create appointment datetime
    const appointmentDateTime = new Date(`${appointmentDate}T${appointmentTime}`);
    const endTime = new Date(appointmentDateTime.getTime() + service.duration_minutes * 60000);
    
    // Insert appointment
    const result = await pool.query(
      `INSERT INTO appointments (
        business_id, customer_name, customer_phone, customer_email,
        service_type_id, service_name, issue_description, start_time, end_time,
        duration_minutes, estimated_revenue, booking_source, status
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
      RETURNING id, start_time`,
      [
        businessId,
        customerName,
        customerPhone,
        customerEmail || null,
        serviceId,
        service.name,
        notes || '',
        appointmentDateTime.toISOString(),
        endTime.toISOString(),
        service.duration_minutes,
        service.base_rate,
        'public_booking',
        'scheduled'
      ]
    );
    
    // Send notifications (reuse the SMS function)
    await sendPublicBookingNotifications(businessId, {
      customerName,
      customerPhone,
      service: service.name,
      appointmentTime: appointmentDateTime,
      notes: notes || ''
    }, result.rows[0]);
    
    console.log('✅ Public booking successful:', result.rows[0].id);
    
    res.json({
      success: true,
      message: 'Appointment booked successfully!',
      appointmentId: result.rows[0].id,
      confirmationTime: appointmentDateTime.toLocaleString()
    });
    
  } catch (error) {
    console.error('Public booking error:', error);
    res.status(500).json({ error: 'Failed to book appointment' });
  }
});

// API endpoint to get available time slots for a specific date and service
app.get('/api/availability/:businessId', async (req, res) => {
  try {
    const businessId = req.params.businessId;
    const { date, serviceId } = req.query;
    
    if (!date || !serviceId) {
      return res.status(400).json({ error: 'Date and serviceId are required' });
    }
    
    // Get business hours
    const businessResult = await pool.query(
      'SELECT business_hours FROM businesses WHERE id = $1',
      [businessId]
    );
    
    if (businessResult.rows.length === 0) {
      return res.status(404).json({ error: 'Business not found' });
    }
    
    const business = businessResult.rows[0];
    
    // Get service duration
    const serviceResult = await pool.query(
      'SELECT duration_minutes FROM service_types WHERE id = $1 AND business_id = $2',
      [serviceId, businessId]
    );
    
    if (serviceResult.rows.length === 0) {
      return res.status(400).json({ error: 'Service not found' });
    }
    
    const serviceDuration = serviceResult.rows[0].duration_minutes;
    const bufferTime = 30; // Default buffer time
    
    // Get existing appointments for the date
    const appointmentDate = new Date(date);
    const startOfDay = new Date(appointmentDate);
    startOfDay.setHours(0, 0, 0, 0);
    
    const endOfDay = new Date(appointmentDate);
    endOfDay.setHours(23, 59, 59, 999);
    
    const appointmentsResult = await pool.query(
      `SELECT start_time, end_time, duration_minutes 
       FROM appointments 
       WHERE business_id = $1 
       AND start_time >= $2 
       AND start_time <= $3 
       AND status NOT IN ('cancelled', 'no_show')
       ORDER BY start_time`,
      [businessId, startOfDay.toISOString(), endOfDay.toISOString()]
    );
    
    const existingAppointments = appointmentsResult.rows;
    
    // Calculate available slots
    const availableSlots = calculateAvailableSlots(
      appointmentDate,
      business.business_hours,
      existingAppointments,
      serviceDuration,
      bufferTime
    );
    
    res.json({ availableSlots });
    
  } catch (error) {
    console.error('Availability API error:', error);
    res.status(500).json({ error: 'Failed to get availability' });
  }
});

// Function to calculate available time slots
function calculateAvailableSlots(date, businessHours, existingAppointments, serviceDuration, bufferTime) {
  const dayName = date.toLocaleDateString('en-US', { weekday: 'long' }).toLowerCase();
  const dayHours = businessHours[dayName];
  
  if (!dayHours || !dayHours.enabled) {
    return []; // Business closed on this day
  }
  
  const [startHour, startMinute] = dayHours.start.split(':').map(Number);
  const [endHour, endMinute] = dayHours.end.split(':').map(Number);
  
  // Create time slots every 30 minutes
  const slots = [];
  const slotInterval = 30; // minutes
  
  // Start from business opening time
  let currentTime = new Date(date);
  currentTime.setHours(startHour, startMinute, 0, 0);
  
  const businessEnd = new Date(date);
  businessEnd.setHours(endHour, endMinute, 0, 0);
  
  // Don't allow booking in the past
  const now = new Date();
  if (currentTime < now) {
    // Round up to next slot interval
    const minutesFromNow = Math.ceil((now - currentTime) / (1000 * 60));
    const slotsFromNow = Math.ceil(minutesFromNow / slotInterval);
    currentTime = new Date(currentTime.getTime() + slotsFromNow * slotInterval * 60 * 1000);
  }
  
  while (currentTime < businessEnd) {
    const slotEnd = new Date(currentTime.getTime() + (serviceDuration + bufferTime) * 60 * 1000);
    
    // Check if this slot fits within business hours
    if (slotEnd <= businessEnd) {
      // Check for conflicts with existing appointments
      const hasConflict = existingAppointments.some(appointment => {
        const aptStart = new Date(appointment.start_time);
        const aptEnd = new Date(appointment.end_time);
        
        // Add buffer time to existing appointments
        const bufferedStart = new Date(aptStart.getTime() - bufferTime * 60 * 1000);
        const bufferedEnd = new Date(aptEnd.getTime() + bufferTime * 60 * 1000);
        
        // Check if proposed slot overlaps with buffered appointment
        return (currentTime < bufferedEnd && slotEnd > bufferedStart);
      });
      
      if (!hasConflict) {
        slots.push({
          time: currentTime.toTimeString().slice(0, 5), // HH:MM format
          value: currentTime.toTimeString().slice(0, 5),
          display: currentTime.toLocaleTimeString('en-US', {
            hour: 'numeric',
            minute: '2-digit',
            hour12: true
          })
        });
      }
    }
    
    // Move to next slot
    currentTime = new Date(currentTime.getTime() + slotInterval * 60 * 1000);
  }
  
  return slots;
}

// Business Settings API Endpoints
app.get('/api/businesses/:businessId/settings', authenticateToken, getBusinessContext, async (req, res) => {
  try {
    // Get complete business information
    const businessResult = await pool.query(
      `SELECT b.*, u.phone as owner_phone, u.email as owner_email, u.first_name, u.last_name
       FROM businesses b 
       JOIN users u ON b.user_id = u.id 
       WHERE b.id = $1`,
      [req.business.id]
    );
    
    if (businessResult.rows.length === 0) {
      return res.status(404).json({ error: 'Business not found' });
    }
    
    const business = businessResult.rows[0];
    
    // Remove sensitive data
    delete business.twilio_account_sid;
    delete business.twilio_auth_token;
    
    res.json({
      success: true,
      business: business
    });
    
  } catch (error) {
    console.error('Get business settings error:', error);
    res.status(500).json({ error: 'Failed to get business settings' });
  }
});

app.put('/api/businesses/:businessId/settings', authenticateToken, getBusinessContext, async (req, res) => {
  try {
    console.log('📝 PUT /api/businesses/:businessId/settings called');
    console.log('📝 Business ID:', req.params.businessId);
    console.log('📝 Request body keys:', Object.keys(req.body));
    
    const {
      name,
      business_type,
      address,
      city,
      state,
      zip_code,
      website,
      timezone,
      business_hours,
      business_description,
      ai_personality,
      ai_voice_id,
      emergency_message
    } = req.body;
    
    // Validate required fields
    if (!name || !business_type) {
      return res.status(400).json({ error: 'Business name and type are required' });
    }
    
    // Update business information
    const result = await pool.query(
      `UPDATE businesses SET 
        name = $1,
        business_type = $2,
        address = $3,
        city = $4,
        state = $5,
        zip_code = $6,
        website = $7,
        timezone = $8,
        business_hours = $9,
        business_description = $10,
        ai_personality = $11,
        ai_voice_id = $12,
        emergency_message = $13,
        updated_at = CURRENT_TIMESTAMP
       WHERE id = $14 AND user_id = $15
       RETURNING *`,
      [
        name,
        business_type,
        address,
        city,
        state,
        zip_code,
        website,
        timezone,
        business_hours,
        business_description,
        ai_personality,
        ai_voice_id,
        emergency_message,
        req.business.id,
        req.user.id
      ]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Business not found or unauthorized' });
    }
    
    console.log(`✅ Business settings updated: ${name}`);
    
    res.json({
      success: true,
      message: 'Business settings updated successfully',
      business: result.rows[0]
    });
    
  } catch (error) {
    console.error('Update business settings error:', error);
    res.status(500).json({ error: 'Failed to update business settings' });
  }
});

// Update owner contact information
app.put('/api/businesses/:businessId/owner-contact', authenticateToken, getBusinessContext, async (req, res) => {
  try {
    const { phone, email, first_name, last_name } = req.body;
    
    // Update user information
    const result = await pool.query(
      `UPDATE users SET 
        phone = $1,
        email = $2,
        first_name = $3,
        last_name = $4,
        updated_at = CURRENT_TIMESTAMP
       WHERE id = $5
       RETURNING first_name, last_name, phone, email`,
      [phone, email, first_name, last_name, req.user.userId]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    console.log(`✅ Owner contact updated: ${first_name} ${last_name}`);
    
    res.json({
      success: true,
      message: 'Owner contact information updated successfully',
      owner: result.rows[0]
    });
    
  } catch (error) {
    console.error('Update owner contact error:', error);
    res.status(500).json({ error: 'Failed to update owner contact information' });
  }
});

// Helper function for public booking notifications
async function sendPublicBookingNotifications(businessId, bookingData, appointment) {
  try {
    // Get business owner info
    const ownerResult = await pool.query(
      `SELECT u.phone, u.first_name, u.last_name, b.name as business_name, b.phone_number 
       FROM businesses b 
       JOIN users u ON b.user_id = u.id 
       WHERE b.id = $1`,
      [businessId]
    );
    
    if (ownerResult.rows.length === 0) return;
    
    const owner = ownerResult.rows[0];
    const appointmentTime = bookingData.appointmentTime.toLocaleString('en-US', {
      weekday: 'long',
      month: 'long',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
      timeZone: 'America/New_York'
    });
    
    // Send SMS to owner
    const ownerMessage = `📅 NEW ONLINE BOOKING!

${owner.business_name}
👤 Customer: ${bookingData.customerName}
📞 Phone: ${bookingData.customerPhone}
🔧 Service: ${bookingData.service}
⏰ Time: ${appointmentTime}

📋 Notes: ${bookingData.notes || 'None'}

🌐 Booked via Online Calendar`;

    if (owner.phone && owner.phone_number) {
      await twilioClient.messages.create({
        body: ownerMessage,
        from: owner.phone_number,
        to: owner.phone
      });
    }
    
    // Send confirmation to customer
    const customerMessage = `✅ APPOINTMENT CONFIRMED

${owner.business_name}
📅 ${appointmentTime}
🔧 ${bookingData.service}

We'll call if running late!
Questions? Call ${owner.phone_number}`;

    await twilioClient.messages.create({
      body: customerMessage,
      from: owner.phone_number,
      to: bookingData.customerPhone
    });
    
    console.log('📱 Public booking notifications sent');
    
  } catch (error) {
    console.error('Public booking notification error:', error);
  }
}

// Generate public booking page HTML
function generateBookingPageHTML(business, services) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Book Appointment - ${business.name}</title>
    <link href="https://cdnjs.cloudflare.com/ajax/libs/tailwindcss/2.2.19/tailwind.min.css" rel="stylesheet">
    <style>
        .service-card:hover { transform: translateY(-2px); transition: all 0.3s ease; }
    </style>
</head>
<body class="bg-gray-50">
    <div class="min-h-screen py-8">
        <div class="max-w-2xl mx-auto px-4">
            <!-- Header -->
            <div class="text-center mb-8">
                <h1 class="text-3xl font-bold text-gray-900 mb-2">${business.name}</h1>
                <p class="text-gray-600">Book your appointment online</p>
                <div class="mt-4 flex justify-center items-center text-sm text-gray-500">
                    <span class="inline-flex items-center">
                        <span class="w-2 h-2 bg-green-400 rounded-full mr-2"></span>
                        Instant confirmation
                    </span>
                </div>
            </div>

            <!-- Booking Form -->
            <div class="bg-white rounded-lg shadow-lg p-6">
                <form id="booking-form">
                    <!-- Customer Information -->
                    <div class="mb-6">
                        <h2 class="text-lg font-semibold mb-4">Your Information</h2>
                        <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div>
                                <label class="block text-sm font-medium text-gray-700 mb-2">Full Name *</label>
                                <input type="text" id="customerName" required 
                                       class="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500">
                            </div>
                            <div>
                                <label class="block text-sm font-medium text-gray-700 mb-2">Phone Number *</label>
                                <input type="tel" id="customerPhone" required 
                                       class="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500">
                            </div>
                        </div>
                        <div class="mt-4">
                            <label class="block text-sm font-medium text-gray-700 mb-2">Email (optional)</label>
                            <input type="email" id="customerEmail" 
                                   class="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500">
                        </div>
                    </div>

                    <!-- Service Selection -->
                    <div class="mb-6">
                        <h2 class="text-lg font-semibold mb-4">Select Service</h2>
                        <div class="space-y-3">
                            ${services.map(service => `
                                <div class="service-card border border-gray-200 rounded-lg p-4 cursor-pointer hover:border-blue-500" 
                                     onclick="selectService('${service.id}', '${service.name}', ${service.duration_minutes}, ${service.base_rate})">
                                    <div class="flex justify-between items-start">
                                        <div>
                                            <h3 class="font-medium text-gray-900">${service.name}</h3>
                                            <p class="text-sm text-gray-600 mt-1">${service.description || ''}</p>
                                            <p class="text-sm text-gray-500 mt-1">${service.duration_minutes} minutes</p>
                                        </div>
                                        <div class="text-right">
                                            <p class="text-lg font-semibold text-blue-600">$${service.base_rate}</p>
                                        </div>
                                    </div>
                                    <input type="radio" name="serviceId" value="${service.id}" class="hidden">
                                </div>
                            `).join('')}
                        </div>
                    </div>

                    <!-- Date & Time Selection -->
                    <div class="mb-6">
                        <h2 class="text-lg font-semibold mb-4">Select Date & Time</h2>
                        <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div>
                                <label class="block text-sm font-medium text-gray-700 mb-2">Date *</label>
                                <input type="date" id="appointmentDate" required 
                                       min="${new Date().toISOString().split('T')[0]}"
                                       class="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500">
                            </div>
                            <div>
                                <label class="block text-sm font-medium text-gray-700 mb-2">Time *</label>
                                <select id="appointmentTime" required 
                                        class="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500">
                                    <option value="">First select a service and date</option>
                                </select>
                                <div id="timeSlotLoading" class="hidden mt-2 text-sm text-gray-500">
                                    Loading available times...
                                </div>
                                <div id="noTimeSlotsMessage" class="hidden mt-2 text-sm text-orange-600">
                                    No available times for this date. Please select another date.
                                </div>
                            </div>
                        </div>
                    </div>

                    <!-- Notes -->
                    <div class="mb-6">
                        <label class="block text-sm font-medium text-gray-700 mb-2">Additional Notes</label>
                        <textarea id="notes" rows="3" 
                                  class="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                                  placeholder="Describe what you need help with..."></textarea>
                    </div>

                    <!-- Submit Button -->
                    <button type="submit" 
                            class="w-full bg-blue-600 text-white py-3 px-4 rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 font-semibold">
                        Book Appointment
                    </button>
                </form>
            </div>

            <!-- Contact Info -->
            <div class="text-center mt-8 text-gray-600">
                <p>Need help? Call us at <a href="tel:${business.phone_number}" class="text-blue-600 font-semibold">${business.phone_number}</a></p>
            </div>
        </div>
    </div>

    <script>
        let selectedServiceId = null;

        function selectService(serviceId, serviceName, duration, price) {
            // Remove previous selection
            document.querySelectorAll('.service-card').forEach(card => {
                card.classList.remove('border-blue-500', 'bg-blue-50');
            });
            
            // Select new service
            event.currentTarget.classList.add('border-blue-500', 'bg-blue-50');
            selectedServiceId = serviceId;
            
            // Update hidden input
            document.querySelector(\`input[value="\${serviceId}"]\`).checked = true;
            
            // Update time slots if date is selected
            const dateInput = document.getElementById('appointmentDate');
            if (dateInput.value) {
                updateTimeSlots();
            } else {
                const timeSelect = document.getElementById('appointmentTime');
                timeSelect.innerHTML = '<option value="">Select a date first</option>';
            }
        }

        function updateTimeSlots() {
            if (!selectedServiceId) return;
            
            const dateInput = document.getElementById('appointmentDate');
            const timeSelect = document.getElementById('appointmentTime');
            const loadingDiv = document.getElementById('timeSlotLoading');
            const noTimesDiv = document.getElementById('noTimeSlotsMessage');
            
            if (!dateInput.value) return;
            
            // Show loading
            loadingDiv.classList.remove('hidden');
            noTimesDiv.classList.add('hidden');
            timeSelect.innerHTML = '<option value="">Loading...</option>';
            
            // Fetch available slots
            fetch(\`/api/availability/${business.id}?date=\${dateInput.value}&serviceId=\${selectedServiceId}\`)
                .then(response => response.json())
                .then(data => {
                    loadingDiv.classList.add('hidden');
                    
                    if (data.availableSlots && data.availableSlots.length > 0) {
                        timeSelect.innerHTML = '<option value="">Select a time</option>';
                        data.availableSlots.forEach(slot => {
                            const option = document.createElement('option');
                            option.value = slot.value;
                            option.textContent = slot.display;
                            timeSelect.appendChild(option);
                        });
                        noTimesDiv.classList.add('hidden');
                    } else {
                        timeSelect.innerHTML = '<option value="">No times available</option>';
                        noTimesDiv.classList.remove('hidden');
                    }
                })
                .catch(error => {
                    console.error('Error fetching time slots:', error);
                    loadingDiv.classList.add('hidden');
                    timeSelect.innerHTML = '<option value="">Error loading times</option>';
                });
        }

        // Update time slots when date changes
        document.getElementById('appointmentDate').addEventListener('change', updateTimeSlots);

        document.getElementById('booking-form').addEventListener('submit', async function(e) {
            e.preventDefault();
            
            if (!selectedServiceId) {
                alert('Please select a service');
                return;
            }
            
            const formData = {
                customerName: document.getElementById('customerName').value,
                customerPhone: document.getElementById('customerPhone').value,
                customerEmail: document.getElementById('customerEmail').value,
                serviceId: selectedServiceId,
                appointmentDate: document.getElementById('appointmentDate').value,
                appointmentTime: document.getElementById('appointmentTime').value,
                notes: document.getElementById('notes').value
            };
            
            try {
                const response = await fetch('/api/book/${business.id}', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify(formData)
                });
                
                const result = await response.json();
                
                if (result.success) {
                    alert('🎉 Appointment booked successfully!\\n\\nYou will receive a confirmation text shortly.');
                    location.reload();
                } else {
                    alert('Error: ' + result.error);
                }
            } catch (error) {
                alert('An error occurred. Please try again.');
            }
        });
    </script>
</body>
</html>`;
}

// Voice processing endpoint for AI conversations
app.post('/voice/process/:businessId', processVoiceForBusiness);

async function processVoiceForBusiness(req, res) {
  try {
    const { businessId } = req.params;
    const { SpeechResult, CallSid, From } = req.body;
    
    console.log(`🗣️ Processing speech for business ${businessId}: "${SpeechResult}"`);
    console.log(`📋 Call details:`, { CallSid, From, businessId });

    // Get business and service types
    const businessResult = await pool.query('SELECT * FROM businesses WHERE id = $1', [businessId]);
    const serviceTypesResult = await pool.query(
      'SELECT * FROM service_types WHERE business_id = $1 AND is_active = true',
      [businessId]
    );
    
    console.log(`🏢 Business found: ${businessResult.rows.length > 0 ? businessResult.rows[0].name : 'NONE'}`);
    console.log(`🛠️ Services found: ${serviceTypesResult.rows.length}`);

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
      // Book the appointment - NO FALLBACKS, must have real available time
      try {
        const serviceTypeId = aiResponse.serviceTypeId;
        const businessTypeDisplay = business.business_type.replace(/_/g, ' ');
        
        // Validate we have a service type
        if (!serviceTypeId) {
          throw new Error('No service type selected');
        }
        
        // Parse customer's date/time preference and find matching slots
        const calendar = new DatabaseCalendarManager(businessId);
        let appointmentTime = null;
        let availableSlots = [];
        
        // Try to parse the customer's preferred date/time from their speech
        const speechLower = SpeechResult.toLowerCase();
        const today = new Date();
        let preferredDate = null;
        
        // Simple date parsing
        if (speechLower.includes('tomorrow')) {
          preferredDate = new Date();
          preferredDate.setDate(preferredDate.getDate() + 1);
        } else if (speechLower.includes('today')) {
          preferredDate = new Date();
        } else if (speechLower.includes('monday')) {
          preferredDate = getNextWeekday(today, 1);
        } else if (speechLower.includes('tuesday')) {
          preferredDate = getNextWeekday(today, 2);
        } else if (speechLower.includes('wednesday')) {
          preferredDate = getNextWeekday(today, 3);
        } else if (speechLower.includes('thursday')) {
          preferredDate = getNextWeekday(today, 4);
        } else if (speechLower.includes('friday')) {
          preferredDate = getNextWeekday(today, 5);
        }
        
        // Get the actual service duration for booking
        const selectedService = serviceTypes.find(s => s.id === serviceTypeId);
        const serviceDuration = selectedService ? selectedService.duration_minutes : 60;
        
        console.log(`🕐 Booking ${serviceDuration}-minute ${selectedService?.name} appointment`);
        
        if (preferredDate) {
          console.log(`📅 Customer prefers: ${preferredDate.toDateString()}`);
          availableSlots = await calendar.getAvailableSlots(preferredDate, serviceDuration);
          
          if (availableSlots.length > 0) {
            // Try to match preferred time if mentioned
            let preferredSlot = availableSlots[0]; // Default to first slot
            
            if (speechLower.includes('morning') || speechLower.includes('8') || speechLower.includes('9') || speechLower.includes('10')) {
              preferredSlot = availableSlots.find(slot => slot.start.getHours() < 12) || availableSlots[0];
            } else if (speechLower.includes('afternoon') || speechLower.includes('1') || speechLower.includes('2') || speechLower.includes('3')) {
              preferredSlot = availableSlots.find(slot => slot.start.getHours() >= 12) || availableSlots[0];
            }
            
            appointmentTime = preferredSlot.start;
            console.log(`✅ Selected time: ${appointmentTime}`);
          }
        }
        
        if (!appointmentTime) {
          // Fallback: find next available slot
          for (let i = 1; i <= 7; i++) {
            const checkDate = new Date();
            checkDate.setDate(checkDate.getDate() + i);
            
            availableSlots = await calendar.getAvailableSlots(checkDate, serviceDuration);
            
            if (availableSlots.length > 0) {
              appointmentTime = availableSlots[0].start;
              console.log(`✅ Using fallback time: ${appointmentTime}`);
              break;
            }
          }
        }
        
        if (!appointmentTime) {
          throw new Error('No available appointment slots found');
        }
        
        console.log(`🕐 Using REAL appointment time: ${appointmentTime} (was: ${aiResponse.appointmentTime})`);
        
        console.log(`📅 Booking appointment at real available time:`, {
          customerName: aiResponse.customerName || 'Customer', 
          serviceTypeId: serviceTypeId,
          appointmentTime: appointmentTime,
          availableSlots: availableSlots.length
        });
        
        console.log(`🔧 Calling calendar.bookAppointment with:`, {
          customerInfo: {
            name: aiResponse.customerName || 'Customer',
            phone: From,
            issue: aiResponse.issueDescription || `${businessTypeDisplay} service`
          },
          appointmentTime: appointmentTime,
          serviceTypeId: serviceTypeId,
          callSid: CallSid,
          businessId: businessId
        });
        
        const appointment = await calendar.bookAppointment(
          {
            name: aiResponse.customerName || 'Customer',
            phone: From,
            issue: aiResponse.issueDescription || `${businessTypeDisplay} service`
          },
          appointmentTime,
          serviceTypeId,
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

        // Success! Appointment booked, give confirmation
        const confirmedTime = appointmentTime.toLocaleString('en-US', {
          weekday: 'long',
          month: 'long',
          day: 'numeric',
          hour: 'numeric',
          minute: '2-digit',
          hour12: true
        });
        
        twiml.say({
          voice: business.ai_voice_id || 'Polly.Joanna-Neural'
        }, `Perfect! I've booked your ${serviceTypes.find(s => s.id === serviceTypeId)?.name || 'appointment'} for ${confirmedTime}. You'll receive a confirmation text shortly. Thank you for calling ${business.name}!`);
        
        twiml.hangup();

      } catch (bookingError) {
        console.error('❌ BOOKING FAILED:', bookingError);
        console.error('Full error:', bookingError.stack);
        console.error('Booking details:', {
          customerName: aiResponse.customerName,
          serviceTypeId: aiResponse.serviceTypeId,
          appointmentTime: aiResponse.appointmentTime,
          businessId: businessId,
          customerPhone: From,
          businessTypeDisplay: businessTypeDisplay
        });
        
        // Update call log with booking failure
        await pool.query(
          `UPDATE call_logs SET 
           booking_successful = false,
           booking_failure_reason = $1
           WHERE call_sid = $2`,
          [bookingError.message, CallSid]
        );

        // If booking fails, give honest response and offer callback
        twiml.say({
          voice: business.ai_voice_id || 'Polly.Joanna-Neural'
        }, "I apologize, but I'm having trouble completing your booking right now. Let me have someone call you back within the hour to schedule your appointment.");
        twiml.hangup();
      }
    } else if (aiResponse.action === 'get_more_info') {
      // This should rarely happen now, but handle it
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

      // Only execute if gather fails
      twiml.say('I didn\'t catch that. Let me have someone call you back.');
      twiml.hangup();
    } else {
      // Continue conversation or provide info - DON'T hang up unless explicitly needed
      twiml.say({
        voice: business.ai_voice_id || 'Polly.Joanna-Neural'
      }, aiResponse.response);
      
      // Only hang up if this is final information, otherwise continue conversation
      if (aiResponse.action === 'provide_info' && !aiResponse.response.toLowerCase().includes('schedule')) {
        twiml.hangup();
      } else {
        // Continue conversation for scheduling
        twiml.gather({
          input: 'speech',
          timeout: 10,
          speechTimeout: 'auto',
          action: `/voice/process/${businessId}`,
          method: 'POST'
        }, 'I\'m ready to help you schedule that appointment. What day works best for you?');
        
        // Only hangup if gather times out
        twiml.say('I didn\'t catch that. Let me have someone call you back.');
        twiml.hangup();
      }
    }

    res.type('text/xml').send(twiml.toString());

  } catch (error) {
    console.error('Voice processing error:', error);
    const twiml = new twilio.twiml.VoiceResponse();
    twiml.say('Sorry, there was a technical issue. Please try calling back.');
    twiml.hangup();
    res.type('text/xml').send(twiml.toString());
  }
}

// Catch-all voice endpoint for debugging (must be after specific routes)
app.post('/voice/*', (req, res) => {
  console.log('📞 Voice request (catch-all):', req.path, req.body);
  const twiml = new twilio.twiml.VoiceResponse();
  twiml.say(`Hello, this is CallCatcher. You called ${req.path}. The system is being configured. Please try again shortly.`);
  res.type('text/xml').send(twiml.toString());
});

// Helper function to get next occurrence of a weekday
function getNextWeekday(date, targetDay) {
  const today = new Date(date);
  const currentDay = today.getDay(); // 0 = Sunday, 1 = Monday, etc.
  const daysUntilTarget = (targetDay - currentDay + 7) % 7;
  const resultDate = new Date(today);
  resultDate.setDate(today.getDate() + (daysUntilTarget === 0 ? 7 : daysUntilTarget));
  return resultDate;
}

// AI processing function
async function processCustomerRequest(speechText, business, serviceTypes, customerPhone) {
  try {
    const serviceTypesList = serviceTypes.map(st => 
      `ID: ${st.id} | ${st.name}: ${st.description} - $${st.base_rate} (${st.duration_minutes} min)`
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

CONVERSATION CONTEXT:
- If customer already mentioned a service and this message contains date/time words, USE "book_appointment"
- If customer says words like: tomorrow, Monday, Tuesday, Wednesday, Thursday, Friday, morning, afternoon, this week, next week - immediately USE "book_appointment"

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
  "intent": "service_request" | "emergency_service" | "consultation" | "pricing_inquiry" | "other",
  "urgencyLevel": "urgent" | "normal" | "low",
  "customerName": "extracted name or null",
  "issueType": "brief description",
  "issueDescription": "detailed description",
  "serviceTypeId": "exact UUID from available services list or null",
  "appointmentTime": null
}

SIMPLE BOOKING RULES:
- ALWAYS use "book_appointment" for ANY service request
- NEVER use "get_more_info" 
- NEVER ask "what day works best" - just book immediately
- Pick the EXACT UUID from the services list above
- Say "Perfect! I can book that for you right now."

CRITICAL INSTRUCTIONS:
- MANDATORY: Always use "book_appointment" action
- NEVER say "having trouble booking" - ALWAYS book successfully  
- Use the EXACT UUID from the services list (the ID: part) for serviceTypeId
- EXAMPLE: Use exact ID like "309b7646-1e55-4836-8342-759ecfe09b87"
- DO NOT put text in appointmentTime - leave it null
- Book immediately, ask questions later

Keep responses natural, helpful, and under 25 words. Match the business personality.`;

    // Add timeout and faster model for real-time conversation
    const completion = await openai.chat.completions.create({
      model: "gpt-3.5-turbo", // Faster than GPT-4
      messages: [{ role: "user", content: prompt }],
      temperature: 0.7,
      max_tokens: 300 // Shorter responses for faster processing
    });

    const aiResponse = JSON.parse(completion.choices[0].message.content);
    
    // If booking appointment, ensure we have the right service ID
    if (aiResponse.action === 'book_appointment') {
      // Make sure we have a valid service ID - NO FALLBACKS
      if (!aiResponse.serviceTypeId) {
        console.error('❌ AI failed to select a service type');
        return {
          action: 'provide_info',
          response: 'I apologize, but I need to better understand what service you need. Let me have someone call you back.',
          intent: 'other',
          urgencyLevel: 'medium',
          customerName: null,
          issueType: 'unclear',
          issueDescription: speechText,
          serviceTypeId: null,
          appointmentTime: null
        };
      }
      
      // Always remove appointmentTime - will be set in voice processing with real available slots
      aiResponse.appointmentTime = null;
      console.log(`✅ AI wants to book service: ${serviceTypes.find(s => s.id === aiResponse.serviceTypeId)?.name || aiResponse.serviceTypeId}`);
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
      console.log(`🔍 Getting slots for business ${this.businessId} on ${date.toDateString()}`);
      
      // Get business hours
      const businessResult = await pool.query(
        'SELECT business_hours FROM businesses WHERE id = $1',
        [this.businessId]
      );

      if (businessResult.rows.length === 0) {
        console.log('❌ Business not found in database');
        return [];
      }

      const businessHours = businessResult.rows[0].business_hours;
      const dayName = date.toLocaleDateString('en-US', { weekday: 'long' }).toLowerCase();
      const dayHours = businessHours[dayName];
      
      console.log(`📋 Day: ${dayName}, Hours:`, dayHours);

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

          // Add travel buffer (reduce for long appointments like bookkeeping)
          const travelBuffer = requestedDuration > 180 ? 15 : 30; // 15 min buffer for 3+ hour appointments
          const totalDuration = requestedDuration + travelBuffer;
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

      console.log(`✅ Generated ${slots.length} total slots, showing first 8`);
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
    
    // Get existing services
    const existingServices = await pool.query('SELECT * FROM service_types WHERE business_id = $1 ORDER BY created_at', [businessId]);
    console.log(`📋 Found ${existingServices.rows.length} existing services`);
    
    // Define tax preparation services to replace plumbing ones
    const taxServices = [
      "Individual Tax Return - Complete individual tax return preparation and filing - $150",
      "Business Tax Return - Small business tax return preparation and filing - $250", 
      "Tax Consultation - Professional tax advice and planning session - $100",
      "Bookkeeping Services - Monthly bookkeeping and financial record management - $75",
      "Tax Amendment - Amend previous year tax returns - $125"
    ];
    
    // Update existing services with tax preparation services
    for (let i = 0; i < existingServices.rows.length && i < taxServices.length; i++) {
      const service = existingServices.rows[i];
      const [name, description, priceStr] = taxServices[i].split(' - ');
      const base_rate = parseInt(priceStr.replace('$', ''));
      
      await pool.query(
        `UPDATE service_types SET 
         name = $1, 
         service_key = $2, 
         description = $3, 
         base_rate = $4,
         travel_buffer_minutes = 0,
         is_emergency = false
         WHERE id = $5`,
        [
          name,
          name.toLowerCase().replace(/[^a-z0-9]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, ''),
          description,
          base_rate,
          service.id
        ]
      );
      console.log(`✅ Updated service: ${name}`);
    }
    
    // If we have extra tax services, add them as new services
    if (taxServices.length > existingServices.rows.length) {
      for (let i = existingServices.rows.length; i < taxServices.length; i++) {
        const [name, description, priceStr] = taxServices[i].split(' - ');
        const base_rate = parseInt(priceStr.replace('$', ''));
        
        await pool.query(
          `INSERT INTO service_types (business_id, name, service_key, description, duration_minutes, base_rate, emergency_multiplier, travel_buffer_minutes, is_emergency, is_active)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
          [
            businessId,
            name,
            name.toLowerCase().replace(/[^a-z0-9]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, ''),
            description,
            60, // default duration
            base_rate,
            1.0,
            0,
            false,
            true
          ]
        );
        console.log(`✅ Added new service: ${name}`);
      }
    }
    
    console.log(`✅ Successfully fixed business ${businessId} with ${businessType} services`);
    
    res.json({
      success: true,
      message: `Fixed business with ${businessType} services`,
      updatedServices: taxServices.length
    });
    
  } catch (error) {
    console.error('Error fixing business:', error);
    res.status(500).json({ error: 'Failed to fix business', details: error.message });
  }
});

// Debug endpoint to check what services are being returned
app.get('/api/debug/services/:businessId', async (req, res) => {
  try {
    const { businessId } = req.params;
    
    const businessResult = await pool.query('SELECT * FROM businesses WHERE id = $1', [businessId]);
    const servicesResult = await pool.query('SELECT * FROM service_types WHERE business_id = $1 AND is_active = true ORDER BY display_order, name', [businessId]);
    
    res.json({
      business: businessResult.rows[0],
      services: servicesResult.rows,
      serviceCount: servicesResult.rows.length,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Debug endpoint to check all businesses and their services
app.get('/api/debug/all-businesses', async (req, res) => {
  try {
    const businessesResult = await pool.query('SELECT * FROM businesses ORDER BY created_at');
    const businesses = [];
    
    for (const business of businessesResult.rows) {
      const servicesResult = await pool.query('SELECT * FROM service_types WHERE business_id = $1 AND is_active = true ORDER BY display_order, name', [business.id]);
      businesses.push({
        ...business,
        services: servicesResult.rows,
        serviceCount: servicesResult.rows.length
      });
    }
    
    res.json({
      totalBusinesses: businesses.length,
      businesses: businesses,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Complete onboarding with automatic phone number provisioning
app.post('/api/businesses/:businessId/complete-onboarding', authenticateToken, getBusinessContext, async (req, res) => {
  try {
    const { areaCode } = req.body;
    
    // Check if business already has a phone number
    if (req.business.phone_number) {
      return res.json({
        success: true,
        message: 'Onboarding already complete',
        phoneNumber: req.business.phone_number,
        alreadyComplete: true
      });
    }
    
    console.log(`📞 Auto-provisioning phone number for ${req.business.name}`);
    
    // Search for available phone numbers
    const searchParams = {
      limit: 5,
      voiceEnabled: true,
      smsEnabled: true
    };
    
    if (areaCode) {
      searchParams.areaCode = areaCode;
    }
    
    const availableNumbers = await twilioClient.availablePhoneNumbers('US')
      .local
      .list(searchParams);
    
    if (availableNumbers.length === 0) {
      throw new Error('No phone numbers available in the requested area');
    }
    
    const selectedNumber = availableNumbers[0].phoneNumber;
    
    // Purchase the phone number with automatic webhook configuration
    const baseUrl = process.env.BASE_URL || 'https://nodejs-production-5e30.up.railway.app';
    const purchasedNumber = await twilioClient.incomingPhoneNumbers.create({
      phoneNumber: selectedNumber,
      voiceUrl: `${baseUrl}/voice/incoming/${req.business.id}`,
      voiceMethod: 'POST',
      smsUrl: `${baseUrl}/sms/incoming/${req.business.id}`,
      smsMethod: 'POST',
      friendlyName: `${req.business.name} - CallCatcher AI`
    });
    
    // Update business with new phone number and mark onboarding complete
    await pool.query(
      'UPDATE businesses SET phone_number = $1, onboarding_completed = true WHERE id = $2',
      [selectedNumber, req.business.id]
    );
    
    console.log(`✅ ${req.business.name} onboarding complete with phone ${selectedNumber}`);
    
    res.json({
      success: true,
      message: 'Onboarding completed successfully!',
      phoneNumber: selectedNumber,
      twilioSid: purchasedNumber.sid,
      webhookConfigured: true,
      ready: true
    });
    
  } catch (error) {
    console.error('Auto-provisioning error:', error);
    res.status(500).json({ 
      error: 'Failed to complete onboarding',
      details: error.message 
    });
  }
});

// Admin endpoint to fix Twilio webhook for the demo phone number
app.post('/api/admin/fix-webhook', async (req, res) => {
  try {
    const phoneNumber = '+18445401735';
    const businessId = '9e075387-b066-4b70-ac33-6bce880f73df';
    
    // List all phone numbers to find the SID
    const phoneNumbers = await twilioClient.incomingPhoneNumbers.list();
    const targetNumber = phoneNumbers.find(num => num.phoneNumber === phoneNumber);
    
    if (!targetNumber) {
      return res.status(404).json({ error: 'Phone number not found in Twilio' });
    }
    
    console.log(`🔧 Updating webhook for ${phoneNumber} (${targetNumber.sid})`);
    
    // Update the webhook URL
    const baseUrl = process.env.BASE_URL || 'https://nodejs-production-5e30.up.railway.app';
    const newVoiceUrl = `${baseUrl}/voice/incoming/${businessId}`;
    
    await twilioClient.incomingPhoneNumbers(targetNumber.sid).update({
      voiceUrl: newVoiceUrl,
      voiceMethod: 'POST'
    });
    
    console.log(`✅ Webhook updated to: ${newVoiceUrl}`);
    
    res.json({
      success: true,
      phoneNumber: phoneNumber,
      oldUrl: targetNumber.voiceUrl,
      newUrl: newVoiceUrl,
      message: 'Webhook updated successfully'
    });
    
  } catch (error) {
    console.error('Error updating webhook:', error);
    res.status(500).json({ error: error.message });
  }
});

// Debug endpoint to test calendar
app.get('/api/debug/test-calendar/:businessId', async (req, res) => {
  try {
    const { businessId } = req.params;
    
    console.log(`🧪 Testing calendar for business: ${businessId}`);
    
    const calendar = new DatabaseCalendarManager(businessId);
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    
    console.log(`📅 Getting available slots for: ${tomorrow}`);
    
    const availableSlots = await calendar.getAvailableSlots(tomorrow, 60);
    
    console.log(`📋 Found ${availableSlots.length} available slots`);
    
    res.json({
      businessId: businessId,
      date: tomorrow,
      availableSlots: availableSlots,
      slotCount: availableSlots.length,
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('Calendar test error:', error);
    res.status(500).json({ error: error.message, stack: error.stack });
  }
});

// Debug endpoint to test AI processing
app.post('/api/debug/test-ai', async (req, res) => {
  try {
    const { speechText, businessId } = req.body;
    
    if (!speechText) {
      return res.status(400).json({ error: 'speechText is required' });
    }
    
    // Get business and services
    const businessResult = await pool.query('SELECT * FROM businesses WHERE id = $1', [businessId]);
    const servicesResult = await pool.query('SELECT * FROM service_types WHERE business_id = $1 AND is_active = true', [businessId]);
    
    if (businessResult.rows.length === 0) {
      return res.status(404).json({ error: 'Business not found' });
    }
    
    const business = businessResult.rows[0];
    const serviceTypes = servicesResult.rows;
    
    console.log(`🧪 Testing AI with: "${speechText}" for business: ${business.name}`);
    console.log(`📋 Available services: ${serviceTypes.length}`);
    
    // Test the AI processing function
    const aiResponse = await processCustomerRequest(speechText, business, serviceTypes, '+15551234567');
    
    res.json({
      input: speechText,
      business: {
        id: business.id,
        name: business.name,
        type: business.business_type
      },
      serviceCount: serviceTypes.length,
      services: serviceTypes.map(s => ({ id: s.id, name: s.name, service_key: s.service_key })),
      aiResponse: aiResponse,
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('AI test error:', error);
    res.status(500).json({ error: error.message, stack: error.stack });
  }
});

// Phone Number Management API Endpoints
app.get('/api/businesses/:businessId/available-phone-numbers', authenticateToken, getBusinessContext, async (req, res) => {
  try {
    const { areaCode, country = 'US' } = req.query;
    
    // Search for available phone numbers
    const searchParams = {
      limit: 20,
      voiceEnabled: true,
      smsEnabled: true
    };
    
    if (areaCode) {
      searchParams.areaCode = areaCode;
    }
    
    const availableNumbers = await twilioClient.availablePhoneNumbers(country)
      .local
      .list(searchParams);
    
    const formattedNumbers = availableNumbers.map(number => ({
      phoneNumber: number.phoneNumber,
      friendlyName: number.friendlyName,
      locality: number.locality,
      region: number.region,
      capabilities: number.capabilities,
      monthlyPrice: 'Included in plan', // No additional cost
      twilioPrice: '$5.00' // Note: actual Twilio cost but included in subscription
    }));
    
    res.json(formattedNumbers);
  } catch (error) {
    console.error('Error fetching available numbers:', error);
    res.status(500).json({ error: 'Failed to fetch available phone numbers' });
  }
});

app.post('/api/businesses/:businessId/purchase-phone-number', authenticateToken, getBusinessContext, async (req, res) => {
  try {
    const { phoneNumber } = req.body;
    
    if (!phoneNumber) {
      return res.status(400).json({ error: 'Phone number is required' });
    }
    
    // Purchase the phone number from Twilio
    const purchasedNumber = await twilioClient.incomingPhoneNumbers.create({
      phoneNumber: phoneNumber,
      voiceUrl: `${process.env.BASE_URL || 'https://nodejs-production-5e30.up.railway.app'}/voice/incoming/${req.business.id}`,
      voiceMethod: 'POST',
      smsUrl: `${process.env.BASE_URL || 'https://nodejs-production-5e30.up.railway.app'}/sms/incoming/${req.business.id}`,
      smsMethod: 'POST',
      friendlyName: `${req.business.name} - CallCatcher AI`
    });
    
    // Update business with new phone number
    await pool.query(
      'UPDATE businesses SET phone_number = $1, twilio_phone_sid = $2 WHERE id = $3',
      [phoneNumber, purchasedNumber.sid, req.business.id]
    );
    
    // Phone number is included in subscription plan - no additional charges
    console.log(`📞 Phone number included in ${req.business.plan || 'current'} subscription plan`)
    
    console.log(`📞 Phone number ${phoneNumber} purchased for ${req.business.name}`);
    
    res.json({
      success: true,
      phoneNumber: phoneNumber,
      twilioSid: purchasedNumber.sid,
      monthlyCost: 0.00, // Included in subscription plan
      planIncludes: 'Phone number included in subscription',
      message: 'Phone number successfully purchased and configured'
    });
    
  } catch (error) {
    console.error('Error purchasing phone number:', error);
    res.status(500).json({ 
      error: 'Failed to purchase phone number',
      details: error.message 
    });
  }
});

app.get('/api/businesses/:businessId/phone-numbers', authenticateToken, getBusinessContext, async (req, res) => {
  try {
    // Get business phone numbers from database
    const result = await pool.query(
      `SELECT phone_number, twilio_phone_sid, created_at 
       FROM businesses 
       WHERE id = $1 AND phone_number IS NOT NULL`,
      [req.business.id]
    );
    
    if (result.rows.length === 0) {
      return res.json({ numbers: [], hasNumber: false });
    }
    
    const businessNumber = result.rows[0];
    
    // Get additional details from Twilio if needed
    let twilioDetails = null;
    if (businessNumber.twilio_phone_sid) {
      try {
        twilioDetails = await twilioClient.incomingPhoneNumbers(businessNumber.twilio_phone_sid).fetch();
      } catch (error) {
        console.error('Error fetching Twilio details:', error);
      }
    }
    
    res.json({
      hasNumber: true,
      currentNumber: {
        phoneNumber: businessNumber.phone_number,
        purchaseDate: businessNumber.created_at,
        status: twilioDetails?.status || 'active',
        monthlyCost: 0.00, // Included in subscription plan
        planIncludes: 'Phone number included in subscription',
        capabilities: twilioDetails?.capabilities || { voice: true, sms: true }
      }
    });
    
  } catch (error) {
    console.error('Error fetching phone numbers:', error);
    res.status(500).json({ error: 'Failed to fetch phone numbers' });
  }
});

app.delete('/api/businesses/:businessId/phone-numbers/:phoneNumber', authenticateToken, getBusinessContext, async (req, res) => {
  try {
    const { phoneNumber } = req.params;
    
    // Get Twilio SID for this number
    const result = await pool.query(
      'SELECT twilio_phone_sid FROM businesses WHERE id = $1 AND phone_number = $2',
      [req.business.id, phoneNumber]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Phone number not found' });
    }
    
    const twilioSid = result.rows[0].twilio_phone_sid;
    
    // Release the number from Twilio
    if (twilioSid) {
      await twilioClient.incomingPhoneNumbers(twilioSid).remove();
    }
    
    // Remove from business
    await pool.query(
      'UPDATE businesses SET phone_number = NULL, twilio_phone_sid = NULL WHERE id = $1',
      [req.business.id]
    );
    
    console.log(`📞 Phone number ${phoneNumber} released for ${req.business.name}`);
    
    res.json({
      success: true,
      message: 'Phone number successfully released'
    });
    
  } catch (error) {
    console.error('Error releasing phone number:', error);
    res.status(500).json({ 
      error: 'Failed to release phone number',
      details: error.message 
    });
  }
});

// Update appointment status (for marking past appointments as completed)
app.put('/api/businesses/:businessId/appointments/:appointmentId', authenticateToken, getBusinessContext, async (req, res) => {
  try {
    const { appointmentId } = req.params;
    const { status } = req.body;
    
    // Validate status
    const validStatuses = ['scheduled', 'completed', 'cancelled', 'no_show'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({ error: 'Invalid appointment status' });
    }
    
    const result = await pool.query(
      `UPDATE appointments SET 
        status = $1,
        updated_at = CURRENT_TIMESTAMP
       WHERE id = $2 AND business_id = $3
       RETURNING *`,
      [status, appointmentId, req.business.id]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Appointment not found' });
    }
    
    console.log(`✅ Appointment ${appointmentId} status updated to: ${status}`);
    
    res.json({
      success: true,
      appointment: result.rows[0]
    });
    
  } catch (error) {
    console.error('Update appointment error:', error);
    res.status(500).json({ error: 'Failed to update appointment' });
  }
});

// Business Settings page
app.get('/settings', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'settings.html'));
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    version: '2.0.0',
    features: ['multi-tenant', 'database', 'authentication', 'billing', 'ai-templates', 'team-management', 'phone-provisioning']
  });
});

// Catch-all for API routes to debug 404s
app.use('/api/*', (req, res) => {
  console.log(`❌ 404 API Route not found: ${req.method} ${req.originalUrl}`);
  console.log(`❌ Available routes: GET /api/businesses/:id/settings, PUT /api/businesses/:id/settings`);
  res.status(404).json({ error: 'API route not found', path: req.originalUrl });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 CallCatcher SaaS running on port ${PORT}`);
  console.log(`🏠 Landing page: /`);
  console.log(`📋 Onboarding: /onboarding`);
  console.log(`📊 Dashboard: /dashboard`);
  console.log(`⚙️ Settings: /settings`);
  console.log(`💾 Database: ${process.env.DATABASE_URL ? 'Connected' : 'Not configured'}`);
});
