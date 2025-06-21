#!/usr/bin/env node

// Check how many slots exist for Aydens Game Store
require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function checkSlots() {
  try {
    // Find Aydens Game Store
    const businessResult = await pool.query(`
      SELECT id, name, business_hours, timezone 
      FROM businesses 
      WHERE name ILIKE '%ayden%' OR name ILIKE '%game%'
    `);
    
    if (businessResult.rows.length === 0) {
      console.log('❌ No game store business found');
      return;
    }
    
    const business = businessResult.rows[0];
    console.log(`🎮 Found business: ${business.name} (${business.id})`);
    console.log(`📅 Timezone: ${business.timezone}`);
    console.log(`🕒 Business hours: ${JSON.stringify(business.business_hours, null, 2)}`);
    
    // Check total slots
    const totalSlots = await pool.query(`
      SELECT COUNT(*) as total 
      FROM calendar_slots 
      WHERE business_id = $1
    `, [business.id]);
    
    console.log(`\n📊 TOTAL SLOTS: ${totalSlots.rows[0].total}`);
    
    // Check available slots
    const availableSlots = await pool.query(`
      SELECT COUNT(*) as available 
      FROM calendar_slots 
      WHERE business_id = $1 AND is_available = true
    `, [business.id]);
    
    console.log(`✅ AVAILABLE SLOTS: ${availableSlots.rows[0].available}`);
    
    // Check date range
    const dateRange = await pool.query(`
      SELECT 
        MIN(slot_start) as earliest,
        MAX(slot_start) as latest,
        DATE_PART('day', MAX(slot_start) - MIN(slot_start)) as days_span
      FROM calendar_slots 
      WHERE business_id = $1
    `, [business.id]);
    
    if (dateRange.rows[0].earliest) {
      console.log(`\n📅 DATE RANGE:`);
      console.log(`   Earliest: ${dateRange.rows[0].earliest}`);
      console.log(`   Latest: ${dateRange.rows[0].latest}`);
      console.log(`   Days span: ${Math.round(dateRange.rows[0].days_span)} days`);
    }
    
    // Check July 2025 specifically
    const julySlots = await pool.query(`
      SELECT COUNT(*) as july_slots,
        MIN(slot_start) as first_july,
        MAX(slot_start) as last_july
      FROM calendar_slots 
      WHERE business_id = $1 
      AND EXTRACT(year FROM slot_start) = 2025
      AND EXTRACT(month FROM slot_start) = 7
    `, [business.id]);
    
    console.log(`\n🗓️ JULY 2025 SLOTS: ${julySlots.rows[0].july_slots}`);
    if (julySlots.rows[0].first_july) {
      console.log(`   First July slot: ${julySlots.rows[0].first_july}`);
      console.log(`   Last July slot: ${julySlots.rows[0].last_july}`);
    }
    
    // Show sample upcoming slots
    console.log(`\n📝 SAMPLE UPCOMING SLOTS:`);
    const sampleSlots = await pool.query(`
      SELECT slot_start, is_available
      FROM calendar_slots 
      WHERE business_id = $1 
      AND slot_start > NOW()
      ORDER BY slot_start
      LIMIT 10
    `, [business.id]);
    
    sampleSlots.rows.forEach((slot, index) => {
      const date = new Date(slot.slot_start);
      const dateStr = date.toLocaleString('en-US', {
        weekday: 'short',
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
        hour12: true,
        timeZone: business.timezone || 'America/New_York'
      });
      console.log(`   ${index + 1}. ${dateStr} (${slot.is_available ? 'Available' : 'Booked'})`);
    });
    
  } catch (error) {
    console.error('❌ Error:', error.message);
  } finally {
    await pool.end();
  }
}

checkSlots();