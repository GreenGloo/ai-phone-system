require('dotenv').config();
const { Pool } = require('pg');

async function investigateIssues() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  
  try {
    console.log('🔍 INVESTIGATING TOM\'S GARAGE BOOKING ISSUES');
    console.log('='.repeat(60));
    
    // ISSUE 1: Check Tom's Garage business hours
    console.log('\n📅 ISSUE 1: Checking Tom\'s Garage business hours...');
    
    const businessCheck = await pool.query(`
      SELECT id, name, business_hours, calendar_preferences 
      FROM businesses 
      WHERE id = '8fea02b5-850a-4167-913b-a12043c65d17'
    `);
    
    if (businessCheck.rows.length === 0) {
      console.log('❌ Tom\'s Garage not found with that ID!');
      
      // Let's search for Tom's Garage by name
      const nameSearch = await pool.query(`
        SELECT id, name, business_hours, calendar_preferences 
        FROM businesses 
        WHERE name ILIKE '%tom%garage%'
      `);
      
      if (nameSearch.rows.length > 0) {
        console.log('✅ Found Tom\'s Garage by name search:');
        nameSearch.rows.forEach(row => {
          console.log(`  ID: ${row.id}`);
          console.log(`  Name: ${row.name}`);
          console.log(`  Business Hours:`, JSON.stringify(row.business_hours, null, 2));
        });
      } else {
        console.log('❌ No businesses found with "Tom" and "Garage" in name');
        
        // Let's see all businesses
        const allBiz = await pool.query('SELECT id, name FROM businesses LIMIT 10');
        console.log('\n📋 Available businesses:');
        allBiz.rows.forEach(row => {
          console.log(`  ${row.id} - ${row.name}`);
        });
      }
    } else {
      const business = businessCheck.rows[0];
      console.log(`✅ Found: ${business.name}`);
      console.log('Business Hours:', JSON.stringify(business.business_hours, null, 2));
      console.log('Calendar Preferences:', JSON.stringify(business.calendar_preferences, null, 2));
      
      // Check if calendar_slots table exists
      console.log('\n📊 Checking calendar_slots table...');
      const tableExists = await pool.query(`
        SELECT EXISTS (
          SELECT FROM information_schema.tables 
          WHERE table_name = 'calendar_slots'
        )
      `);
      
      if (tableExists.rows[0].exists) {
        console.log('✅ calendar_slots table exists');
        
        // Check calendar slots for June 16, 2025 (tomorrow) between 8-10 AM
        console.log('\n🕘 Checking calendar slots for June 16, 2025 between 8-10 AM...');
        const slotsCheck = await pool.query(`
          SELECT 
            slot_start, 
            slot_end, 
            is_available, 
            is_blocked, 
            block_reason
          FROM calendar_slots 
          WHERE business_id = $1 
            AND slot_start >= '2025-06-16 08:00:00'::timestamp
            AND slot_start < '2025-06-16 10:00:00'::timestamp
          ORDER BY slot_start
        `, [business.id]);
        
        console.log(`Found ${slotsCheck.rows.length} slots between 8-10 AM:`);
        slotsCheck.rows.forEach(slot => {
          console.log(`  ${slot.slot_start} - ${slot.slot_end} | Available: ${slot.is_available} | Blocked: ${slot.is_blocked}`);
          if (slot.block_reason) console.log(`    Block reason: ${slot.block_reason}`);
        });
        
        // Let's also check what slots DO exist for that day
        console.log('\n📊 All calendar slots for June 16, 2025:');
        const allSlots = await pool.query(`
          SELECT 
            slot_start, 
            slot_end, 
            is_available, 
            is_blocked
          FROM calendar_slots 
          WHERE business_id = $1 
            AND slot_start >= '2025-06-16 00:00:00'::timestamp
            AND slot_start < '2025-06-17 00:00:00'::timestamp
          ORDER BY slot_start
        `, [business.id]);
        
        console.log(`All ${allSlots.rows.length} slots for June 16:`);
        allSlots.rows.forEach(slot => {
          const time = new Date(slot.slot_start).toLocaleTimeString('en-US', { 
            hour: '2-digit', 
            minute: '2-digit',
            hour12: true 
          });
          console.log(`  ${time} | Available: ${slot.is_available} | Blocked: ${slot.is_blocked}`);
        });
        
        // Check if there are any slots at all for June 16
        const allSlotsJune16 = await pool.query(`
          SELECT COUNT(*) as total_slots
          FROM calendar_slots 
          WHERE business_id = $1 
            AND slot_start >= '2025-06-16 00:00:00'::timestamp
            AND slot_start < '2025-06-17 00:00:00'::timestamp
        `, [business.id]);
        
        console.log(`\n📊 Total slots for June 16, 2025: ${allSlotsJune16.rows[0].total_slots}`);
        
        // Check existing appointments for that time
        console.log('\n📅 Checking existing appointments for June 16, 2025...');
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
        `, [business.id]);
        
        console.log(`Found ${appointments.rows.length} appointments:`);
        appointments.rows.forEach(apt => {
          console.log(`  ${apt.start_time} - ${apt.end_time} | ${apt.customer_name} | ${apt.service_name} | Status: ${apt.status}`);
        });
        
      } else {
        console.log('❌ calendar_slots table does not exist!');
        console.log('This could be why 9 AM slots are missing - slots are not being generated.');
      }
    }
    
    // ISSUE 2: Check conversation handling logic
    console.log('\n' + '='.repeat(60));
    console.log('🧠 ISSUE 2: Examining conversation handling for context loss...');
    
    // Check if conversations table exists
    const conversationsTableExists = await pool.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_name = 'conversations'
      )
    `);
    
    if (conversationsTableExists.rows[0].exists) {
      console.log('✅ conversations table exists');
      
      // First, let's see what columns exist
      const tableStructure = await pool.query(`
        SELECT column_name, data_type 
        FROM information_schema.columns 
        WHERE table_name = 'conversations'
        ORDER BY ordinal_position
      `);
      
      console.log('\n📋 Conversations table structure:');
      tableStructure.rows.forEach(col => {
        console.log(`  ${col.column_name}: ${col.data_type}`);
      });
      
      // Get recent conversations with available columns
      const recentConversations = await pool.query(`
        SELECT * FROM conversations 
        ORDER BY created_at DESC 
        LIMIT 5
      `);
      
      console.log(`\n📞 Recent conversations (${recentConversations.rows.length}):`);
      recentConversations.rows.forEach(conv => {
        console.log(`  Conversation:`, JSON.stringify(conv, null, 2));
      });
      
    } else {
      console.log('❌ conversations table does not exist!');
      console.log('This explains the context loss - there\'s no conversation state persistence.');
    }
    
  } catch (error) {
    console.error('❌ Investigation error:', error.message);
    console.error('Stack trace:', error.stack);
  } finally {
    await pool.end();
  }
}

investigateIssues();