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

// Default service types for new businesses
const defaultServiceTypes = [
  {
    name: 'Emergency Service',
    service_key: 'emergency',
    description: 'Burst pipes, no water, flooding, gas leaks',
    duration_minutes: 60,
    base_rate: 150.00,
    emergency_multiplier: 1.0,
    travel_buffer_minutes: 30,
    is_emergency: true
  },
  {
    name: 'Drain Cleaning',
    service_key: 'drain-cleaning',
    description: 'Clogged drains, slow drainage, backups',
    duration_minutes: 90,
    base_rate: 120.00,
    emergency_multiplier: 1.5,
    travel_buffer_minutes: 30,
    is_emergency: false
  },
  {
    name: 'Water Heater Service',
    service_key: 'water-heater',
    description: 'Installation, repair, maintenance',
    duration_minutes: 180,
    base_rate: 100.00,
    emergency_multiplier: 1.5,
    travel_buffer_minutes: 45,
    is_emergency: false
  },
  {
    name: 'Pipe Repair',
    service_key: 'pipe-repair',
    description: 'Leaks, pipe replacement, fittings',
    duration_minutes: 120,
    base_rate: 110.00,
    emergency_multiplier: 1.5,
    travel_buffer_minutes: 30,
    is_emergency: false
  },
  {
    name: 'Fixture Installation',
    service_key: 'fixture-install',
    description: 'Toilets, faucets, sinks, showers',
    duration_minutes: 90,
    base_rate: 95.00,
    emergency_multiplier: 1.5,
    travel_buffer_minutes: 30,
    is_emergency: false
  },
  {
    name: 'Consultation',
    service_key: 'consultation',
    description: 'Estimates, inspection, planning',
    duration_minutes: 45,
    base_rate: 75.00,
    emergency_multiplier: 1.0,
    travel_buffer_minutes: 15,
    is_emergency: false
  }
];

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

// Authentication endpoints
app.post('/api/signup', async (req, res) => {
  try {
    const { businessName, ownerName, email, phone, businessType, plan = 'professional' } = req.body;
    
    // Validate input
    if (!businessName || !ownerName || !email || !phone || !businessType) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    // Check if user already exists
    const existingUser = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
    if (existingUser.rows.length > 0) {
      return res.status(400).json({ error: 'Email already registered' });
    }

    // Hash password (temporary password for demo)
    const tempPassword = Math.random().toString(36).slice(-8);
    const passwordHash = await bcrypt.hash(tempPassword, 10);

    // Create user
    const [firstName, ...lastNameParts] = ownerName.split(' ');
    const lastName = lastNameParts.join(' ') || '';

    const userResult = await pool.query(
      `INSERT INTO users (email, password_hash, first_name, last_name, phone) 
       VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [email, passwordHash, firstName, lastName, phone]
    );

    const userId = userResult.rows[0].id;

    // Create Stripe customer
    const stripeCustomer = await stripe.customers.create({
      email: email,
      name: ownerName,
      phone: phone,
      metadata: {
        business_name: businessName,
        business_type: businessType
      }
    });

    // Get Twilio phone number (simplified - in production, let user choose)
    const availableNumbers = await twilioClient.availablePhoneNumbers('US')
      .local
      .list({ limit: 1 });

    let phoneNumber = null;
    if (availableNumbers.length > 0) {
      const purchasedNumber = await twilioClient.incomingPhoneNumbers.create({
        phoneNumber: availableNumbers[0].phoneNumber
      });
      phoneNumber = purchasedNumber.phoneNumber;
    }

    // Create business
    const businessResult = await pool.query(
      `INSERT INTO businesses (user_id, name, business_type, phone_number) 
       VALUES ($1, $2, $3, $4) RETURNING id`,
      [userId, businessName, businessType, phoneNumber]
    );

    const businessId = businessResult.rows[0].id;

    // Create default service types
    for (const serviceType of defaultServiceTypes) {
      await pool.query(
        `INSERT INTO service_types (business_id, name, service_key, description, duration_minutes, base_rate, emergency_multiplier, travel_buffer_minutes, is_emergency)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [
          businessId,
          serviceType.name,
          serviceType.service_key,
          serviceType.description,
          serviceType.duration_minutes,
          serviceType.base_rate,
          serviceType.emergency_multiplier,
          serviceType.travel_buffer_minutes,
          serviceType.is_emergency
        ]
      );
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
      },
      tempPassword // In production, send via email
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

// Voice endpoint with business context
app.post('/voice/incoming/:businessId', async (req, res) => {
  try {
    const { businessId } = req.params;
    const { CallSid, From, To } = req.body;

    console.log(`📞 Incoming call for business ${businessId}: ${From} → ${To}`);

    // Get business details
    const businessResult = await pool.query('SELECT * FROM businesses WHERE id = $1', [businessId]);
    if (businessResult.rows.length === 0) {
      console.error('Business not found:', businessId);
      return res.status(404).send('Business not found');
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

    // Create AI greeting
    const twiml = new twilio.twiml.VoiceResponse();
    const greeting = `Hello, ${business.name}, this is Sarah. I can schedule your appointment right away. How can I help you today?`;

    twiml.say({
      voice: business.ai_voice_id || 'Polly.Joanna-Neural',
      language: 'en-US'
    }, greeting);

    twiml.gather({
      input: 'speech',
      timeout: 5,
      speechTimeout: 'auto',
      action: `/voice/process/${businessId}`,
      method: 'POST'
    });

    twiml.say('I didn\'t catch that. Let me have someone call you back.');
    twiml.hangup();

    res.type('text/xml').send(twiml.toString());

  } catch (error) {
    console.error('Voice incoming error:', error);
    const twiml = new twilio.twiml.VoiceResponse();
    twiml.say('Sorry, there was a technical issue. Please try calling back.');
    res.type('text/xml').send(twiml.toString());
  }
});

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
      const dayName = date.toLocaleDateString('en-US', { weekday: 'monday' });
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

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    version: '2.0.0',
    features: ['multi-tenant', 'database', 'authentication', 'billing']
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
