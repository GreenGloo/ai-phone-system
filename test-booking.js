require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

class DatabaseCalendarManager {
  constructor(businessId) {
    this.businessId = businessId;
  }

  async getAvailableSlots(date, requestedDuration = 60) {
    try {
      console.log(`📅 Getting available slots for ${this.businessId} on ${date}`);
      
      // Get business hours
      const businessResult = await pool.query(
        'SELECT business_hours FROM businesses WHERE id = $1',
        [this.businessId]
      );

      if (businessResult.rows.length === 0) {
        console.log('❌ Business not found');
        return [];
      }

      const businessHours = businessResult.rows[0].business_hours;
      const dayName = date.toLocaleDateString('en-US', { weekday: 'long' }).toLowerCase();
      const dayHours = businessHours[dayName];

      console.log(`📋 Day: ${dayName}, Hours:`, dayHours);

      if (!dayHours || !dayHours.enabled) {
        console.log('❌ Business closed on this day');
        return [];
      }

      const [startHour, startMinute] = dayHours.start.split(':').map(Number);
      const [endHour, endMinute] = dayHours.end.split(':').map(Number);

      console.log(`⏰ Business hours: ${startHour}:${startMinute} - ${endHour}:${endMinute}`);

      const slots = [];

      // Generate potential slots
      for (let hour = startHour; hour < endHour; hour++) {
        for (let minute = 0; minute < 60; minute += 30) {
          const slotStart = new Date(date);
          slotStart.setHours(hour, minute, 0, 0);

          const slotEnd = new Date(slotStart.getTime() + requestedDuration * 60000);

          // Check if slot is within business hours
          if (slotEnd.getHours() > endHour || 
              (slotEnd.getHours() === endHour && slotEnd.getMinutes() > endMinute)) {
            continue;
          }

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

      console.log(`✅ Generated ${slots.length} available slots`);
      return slots.slice(0, 8);
    } catch (error) {
      console.error('Error getting available slots:', error);
      throw error;
    }
  }

  async bookAppointment(customerInfo, appointmentTime, serviceTypeId, callSid) {
    try {
      console.log(`📝 Booking appointment:`, {
        customerInfo,
        appointmentTime,
        serviceTypeId,
        callSid,
        businessId: this.businessId
      });

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

      console.log(`🔧 Service: ${serviceType.name}, Duration: ${serviceType.duration_minutes} min`);

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

      console.log('✅ Appointment booked successfully:', result.rows[0].id);
      return result.rows[0];

    } catch (error) {
      console.error('❌ Error booking appointment:', error);
      throw error;
    }
  }
}

async function testBooking() {
  try {
    const businessId = '9e075387-b066-4b70-ac33-6bce880f73df';
    const serviceTypeId = '309b7646-1e55-4836-8342-759ecfe09b87';
    
    const calendar = new DatabaseCalendarManager(businessId);
    
    // Test getting available slots
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    
    console.log('🧪 Testing getAvailableSlots...');
    const availableSlots = await calendar.getAvailableSlots(tomorrow, 60);
    
    if (availableSlots.length === 0) {
      console.error('❌ No available slots found');
      process.exit(1);
    }
    
    console.log(`✅ Found ${availableSlots.length} available slots`);
    
    // Test booking appointment
    console.log('🧪 Testing bookAppointment...');
    const appointment = await calendar.bookAppointment(
      {
        name: 'Test Customer',
        phone: '+15551234567',
        issue: 'Need help with bookkeeping'
      },
      availableSlots[0].start,
      serviceTypeId,
      'TEST123'
    );
    
    console.log('✅ Booking test successful!', appointment.id);
    
  } catch (error) {
    console.error('❌ Test failed:', error);
    console.error('Stack:', error.stack);
  } finally {
    process.exit(0);
  }
}

testBooking();