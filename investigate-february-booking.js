require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
});

async function investigateFebruaryBooking() {
  try {
    const businessId = '8fea02b5-850a-4167-913b-a12043c65d17';
    
    console.log('=== INVESTIGATING FEBRUARY 11TH BOOKING FAILURE ===\n');
    
    // 1. Query recent conversations for Tom's Garage
    console.log('1. Querying recent conversations for Tom\'s Garage...');
    const conversationsQuery = `
      SELECT 
        call_sid,
        business_id,
        created_at,
        conversation_data,
        updated_at
      FROM conversations 
      WHERE business_id = $1 
      ORDER BY created_at DESC 
      LIMIT 20
    `;
    
    const conversationsResult = await pool.query(conversationsQuery, [businessId]);
    console.log(`Found ${conversationsResult.rows.length} recent conversations\n`);
    
    // 2. Search for February mentions in conversation data
    console.log('2. Searching for February/Feb/11 mentions...');
    const februaryConversations = [];
    
    for (const conv of conversationsResult.rows) {
      const data = conv.conversation_data;
      const dataString = JSON.stringify(data).toLowerCase();
      
      if (dataString.includes('february') || dataString.includes('feb') || dataString.includes('11')) {
        februaryConversations.push(conv);
        console.log(`📞 Found February mention in conversation ${conv.call_sid}`);
        console.log(`   Date: ${conv.created_at}`);
        console.log(`   Updated: ${conv.updated_at}\n`);
      }
    }
    
    // 3. Detailed analysis of February conversations
    if (februaryConversations.length > 0) {
      console.log('3. Detailed analysis of February conversations:\n');
      
      for (const conv of februaryConversations) {
        console.log(`--- CONVERSATION ${conv.call_sid} ---`);
        console.log(`Date: ${conv.created_at}`);
        console.log(`Updated: ${conv.updated_at}`);
        
        // Extract and display conversation flow
        const data = conv.conversation_data;
        if (data && data.messages) {
          console.log('\nConversation Flow:');
          data.messages.forEach((msg, index) => {
            console.log(`  ${index + 1}. ${msg.role}: ${msg.content.substring(0, 200)}${msg.content.length > 200 ? '...' : ''}`);
          });
        }
        
        // Look for booking attempts
        const dataString = JSON.stringify(data).toLowerCase();
        if (dataString.includes('book') || dataString.includes('appointment') || dataString.includes('schedule')) {
          console.log('\n🔍 BOOKING ATTEMPT DETECTED');
          
          // Check for error patterns
          if (dataString.includes('error') || dataString.includes('failed') || dataString.includes('problem')) {
            console.log('❌ ERROR PATTERNS FOUND');
          }
          
          // Check for date parsing issues
          if (dataString.includes('february 11') || dataString.includes('feb 11')) {
            console.log('📅 Date: February 11th mentioned');
          }
        }
        
        console.log('\n' + '='.repeat(50) + '\n');
      }
    } else {
      console.log('❌ No conversations found mentioning February/Feb/11\n');
    }
    
    // 4. Check calendar slots for February 11, 2026
    console.log('4. Checking calendar slots for February 11, 2026...');
    const calendarQuery = `
      SELECT 
        id,
        business_id,
        slot_start,
        slot_end,
        is_available,
        is_blocked,
        block_reason,
        created_at
      FROM calendar_slots 
      WHERE business_id = $1 
        AND DATE(slot_start) = '2026-02-11'
      ORDER BY slot_start
    `;
    
    const calendarResult = await pool.query(calendarQuery, [businessId]);
    console.log(`Found ${calendarResult.rows.length} slots for February 11, 2026`);
    
    if (calendarResult.rows.length > 0) {
      console.log('\nAvailable slots for February 11, 2026:');
      calendarResult.rows.forEach(slot => {
        console.log(`  ${slot.slot_start} - ${slot.slot_end} | Available: ${slot.is_available} | Blocked: ${slot.is_blocked} | Reason: ${slot.block_reason}`);
      });
    } else {
      console.log('❌ No calendar slots found for February 11, 2026');
      
      // Check what dates do have slots
      console.log('\n5. Checking what February 2026 dates have slots...');
      const febSlotsQuery = `
        SELECT 
          DATE(slot_start) as slot_date,
          COUNT(*) as slot_count,
          COUNT(CASE WHEN is_available THEN 1 END) as available_count
        FROM calendar_slots 
        WHERE business_id = $1 
          AND slot_start >= '2026-02-01'
          AND slot_start < '2026-03-01'
        GROUP BY DATE(slot_start)
        ORDER BY slot_date
      `;
      
      const febSlotsResult = await pool.query(febSlotsQuery, [businessId]);
      if (febSlotsResult.rows.length > 0) {
        console.log('February 2026 slots available:');
        febSlotsResult.rows.forEach(row => {
          console.log(`  ${row.slot_date}: ${row.available_count}/${row.slot_count} available`);
        });
      } else {
        console.log('❌ No calendar slots found for any February 2026 dates');
      }
    }
    
    // 6. Check business services
    console.log('\n6. Checking Tom\'s Garage services...');
    const servicesQuery = `
      SELECT id, name, duration_minutes, base_rate, is_active
      FROM service_types 
      WHERE business_id = $1 
      ORDER BY name
    `;
    
    const servicesResult = await pool.query(servicesQuery, [businessId]);
    console.log(`Found ${servicesResult.rows.length} services:`);
    servicesResult.rows.forEach(service => {
      console.log(`  ${service.name} (${service.duration_minutes} min, $${service.base_rate}) - Active: ${service.is_active}`);
    });
    
    // 7. Check for any booking errors in logs
    console.log('\n7. Checking for recent booking attempts...');
    const bookingsQuery = `
      SELECT 
        id,
        customer_name,
        customer_phone,
        service_type_id,
        status,
        created_at,
        booking_failure_reason,
        call_sid,
        start_time,
        end_time
      FROM appointments 
      WHERE business_id = $1 
      ORDER BY created_at DESC 
      LIMIT 10
    `;
    
    const bookingsResult = await pool.query(bookingsQuery, [businessId]);
    console.log(`Found ${bookingsResult.rows.length} recent bookings:`);
    bookingsResult.rows.forEach(booking => {
      console.log(`  ${booking.created_at}: ${booking.customer_name} (${booking.customer_phone}) - Status: ${booking.status}`);
      if (booking.booking_failure_reason) {
        console.log(`    Failure Reason: ${booking.booking_failure_reason}`);
      }
      if (booking.call_sid) {
        console.log(`    Call SID: ${booking.call_sid}`);
      }
      if (booking.start_time) {
        console.log(`    Appointment Time: ${booking.start_time} - ${booking.end_time}`);
      }
    });
    
    console.log('\n=== INVESTIGATION COMPLETE ===');
    
  } catch (error) {
    console.error('Investigation failed:', error);
  } finally {
    await pool.end();
  }
}

// Run the investigation
investigateFebruaryBooking();