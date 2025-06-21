require('dotenv').config();
const { Pool } = require('pg');

async function finalInvestigationSummary() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  
  try {
    console.log('📋 FINAL INVESTIGATION SUMMARY - TOM\'S GARAGE BOOKING ISSUES');
    console.log('='.repeat(80));
    
    const businessId = '8fea02b5-850a-4167-913b-a12043c65d17';
    
    // ISSUE 1: Missing 9 AM slots - FINAL ANALYSIS
    console.log('\n🔍 ISSUE 1: Missing 9 AM slots - FINAL ANALYSIS');
    console.log('-'.repeat(50));
    
    console.log('\n1. Business Hours Verification:');
    const business = await pool.query(`
      SELECT business_hours, timezone 
      FROM businesses 
      WHERE id = $1
    `, [businessId]);
    
    const businessHours = business.rows[0].business_hours;
    console.log(`Monday hours: ${businessHours.monday.start} - ${businessHours.monday.end} (enabled: ${businessHours.monday.enabled})`);
    console.log(`Business timezone: ${business.rows[0].timezone}`);
    
    console.log('\n2. Existing Appointments for June 16, 2025:');
    const appointments = await pool.query(`
      SELECT 
        customer_name,
        service_name,
        start_time,
        end_time,
        status
      FROM appointments 
      WHERE business_id = $1 
        AND start_time >= '2025-06-16 00:00:00'::timestamp
        AND start_time < '2025-06-17 00:00:00'::timestamp
      ORDER BY start_time
    `, [businessId]);
    
    appointments.rows.forEach(apt => {
      const startTime = new Date(apt.start_time);
      const timeStr = startTime.toLocaleTimeString('en-US', { 
        hour: '2-digit', 
        minute: '2-digit',
        hour12: true 
      });
      console.log(`  ${timeStr}: ${apt.customer_name} - ${apt.service_name} (${apt.status})`);
    });
    
    console.log('\n3. Calendar Slots for June 16, 2025:');
    const slots = await pool.query(`
      SELECT 
        slot_start,
        is_available,
        is_blocked
      FROM calendar_slots 
      WHERE business_id = $1 
        AND slot_start >= '2025-06-16 00:00:00'::timestamp
        AND slot_start < '2025-06-17 00:00:00'::timestamp
      ORDER BY slot_start
    `, [businessId]);
    
    console.log(`Total calendar slots: ${slots.rows.length}`);
    
    const morningSlots = slots.rows.filter(slot => {
      const hour = new Date(slot.slot_start).getHours();
      return hour >= 8 && hour < 12;
    });
    
    const afternoonSlots = slots.rows.filter(slot => {
      const hour = new Date(slot.slot_start).getHours();
      return hour >= 12;
    });
    
    console.log(`Morning slots (8 AM - 12 PM): ${morningSlots.length}`);
    console.log(`Afternoon slots (12 PM+): ${afternoonSlots.length}`);
    
    if (morningSlots.length > 0) {
      console.log('\nMorning slots found:');
      morningSlots.forEach(slot => {
        const timeStr = new Date(slot.slot_start).toLocaleTimeString('en-US', { 
          hour: '2-digit', 
          minute: '2-digit',
          hour12: true 
        });
        console.log(`  ${timeStr}: Available=${slot.is_available}, Blocked=${slot.is_blocked}`);
      });
    } else {
      console.log('\n❌ NO MORNING SLOTS FOUND - This explains why 9 AM is "missing"');
    }
    
    console.log('\n4. Specific 9 AM Slot Check:');
    const nineAmSlot = await pool.query(`
      SELECT 
        slot_start,
        is_available,
        is_blocked
      FROM calendar_slots 
      WHERE business_id = $1 
        AND EXTRACT(hour FROM slot_start) = 9
        AND slot_start >= '2025-06-16 00:00:00'::timestamp
        AND slot_start < '2025-06-17 00:00:00'::timestamp
    `, [businessId]);
    
    if (nineAmSlot.rows.length > 0) {
      const slot = nineAmSlot.rows[0];
      console.log(`✅ 9 AM slot exists: Available=${slot.is_available}, Blocked=${slot.is_blocked}`);
      
      // Check if it's booked
      const nineAmBooking = appointments.rows.find(apt => {
        const hour = new Date(apt.start_time).getHours();
        return hour === 9;
      });
      
      if (nineAmBooking) {
        console.log(`⚠️  9 AM is BOOKED: ${nineAmBooking.customer_name} - ${nineAmBooking.service_name}`);
        console.log(`   This is why it appears "unavailable" to new customers`);
      }
    } else {
      console.log('❌ No 9 AM slot exists in calendar_slots table');
    }
    
    // ISSUE 2: Context loss analysis
    console.log('\n' + '='.repeat(80));
    console.log('🔍 ISSUE 2: Context loss when asking for different day - ANALYSIS');
    console.log('-'.repeat(50));
    
    const conversation = await pool.query(`
      SELECT conversation_data
      FROM conversations 
      WHERE business_id = $1
      ORDER BY updated_at DESC
      LIMIT 1
    `, [businessId]);
    
    if (conversation.rows.length > 0) {
      const data = conversation.rows[0].conversation_data;
      const history = data.conversationHistory || [];
      
      console.log('\n1. Conversation Flow Analysis:');
      
      let selectedService = null;
      let contextLossDetected = false;
      
      history.forEach((msg, index) => {
        if (msg.speaker === 'assistant' && msg.data?.service) {
          if (!selectedService) {
            selectedService = msg.data.service;
            console.log(`  ${index + 1}. Service identified: "${selectedService}"`);
          }
        }
        
        if (msg.speaker === 'customer' && msg.message.toLowerCase().includes('tuesday')) {
          console.log(`  ${index + 1}. Customer asked about Tuesday: "${msg.message}"`);
          
          const nextMsg = history[index + 1];
          if (nextMsg && nextMsg.speaker === 'assistant') {
            if (nextMsg.data?.service === selectedService) {
              console.log(`  ${index + 2}. ✅ Context preserved: "${nextMsg.data.service}"`);
            } else if (nextMsg.data?.shouldListServices) {
              console.log(`  ${index + 2}. ❌ Context lost - asking for services again`);
              contextLossDetected = true;
            }
          }
        }
      });
      
      console.log('\n2. Context Preservation Status:');
      if (contextLossDetected) {
        console.log('❌ Context loss confirmed in conversation');
        console.log('   AI forgot previously selected service when date changed');
      } else {
        console.log('✅ Context appears to be preserved');
        console.log('   AI remembered service selection across date changes');
      }
      
      // Check if current conversation shows the issue
      console.log('\n3. Current Conversation State:');
      console.log(`Customer: ${data.customerInfo?.name || 'Unknown'}`);
      console.log(`Phone: ${data.customerPhone}`);
      console.log(`Interaction count: ${data.interactionCount}`);
      
      const lastCustomerMsg = history.filter(h => h.speaker === 'customer').pop();
      const lastAssistantMsg = history.filter(h => h.speaker === 'assistant').pop();
      
      if (lastCustomerMsg) {
        console.log(`Last customer message: "${lastCustomerMsg.message}"`);
      }
      if (lastAssistantMsg && lastAssistantMsg.data) {
        console.log(`Last AI service: "${lastAssistantMsg.data.service || 'None'}"`);
        console.log(`Should list services: ${lastAssistantMsg.data.shouldListServices || false}`);
      }
    }
    
    // FINAL DIAGNOSIS
    console.log('\n' + '='.repeat(80));
    console.log('🎯 FINAL DIAGNOSIS AND SOLUTIONS');
    console.log('='.repeat(80));
    
    console.log('\nISSUE 1: Missing 9 AM slots');
    console.log('ROOT CAUSE:');
    if (morningSlots.length === 0) {
      console.log('  ❌ Calendar generator is not creating morning slots (8 AM - 12 PM)');
      console.log('  ❌ Only afternoon/evening slots (12 PM+) are being generated');
      console.log('  ❌ This is likely due to timezone handling issues in calendar-generator.js');
    } else if (nineAmSlot.rows.length > 0) {
      console.log('  ✅ 9 AM slot exists but is already booked');
      console.log('  ⚠️  Customer requesting 9 AM gets "unavailable" because it\'s occupied');
    }
    
    console.log('\nSOLUTION:');
    console.log('  1. Fix calendar-generator.js to properly handle Eastern timezone');
    console.log('  2. Ensure morning slots (8 AM - 11:30 AM) are generated');
    console.log('  3. Re-run calendar generation for all future dates');
    
    console.log('\nISSUE 2: Context loss when asking for different day');
    console.log('ROOT CAUSE:');
    if (contextLossDetected) {
      console.log('  ❌ AI prompt in conversational-ai.js doesn\'t preserve service context');
      console.log('  ❌ When customer asks about different dates, service selection is lost');
    } else {
      console.log('  ✅ Context preservation appears to be working in latest conversation');
      console.log('  ℹ️  May have been a one-time issue or already improved');
    }
    
    console.log('\nSOLUTION:');
    console.log('  1. Enhance AI prompt to explicitly preserve selected service');
    console.log('  2. Add service persistence checks in conversation flow');
    console.log('  3. Only ask for service clarification when truly unclear');
    
    console.log('\nIMPLEMENTATION PRIORITY:');
    console.log('  🥇 HIGH: Fix calendar generator timezone issues');
    console.log('  🥈 MEDIUM: Enhance AI context preservation');
    console.log('  🥉 LOW: Add monitoring for future conversation issues');
    
  } catch (error) {
    console.error('❌ Investigation error:', error);
  } finally {
    await pool.end();
  }
}

finalInvestigationSummary();