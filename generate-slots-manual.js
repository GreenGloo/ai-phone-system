#!/usr/bin/env node

// Manually generate 13 months of slots for Aydens Game Store
require('dotenv').config();
const { Pool } = require('pg');
const { generateCalendarSlots } = require('./calendar-generator');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function generateSlots() {
  try {
    // Find Aydens Game Store
    const businessResult = await pool.query(`
      SELECT id, name 
      FROM businesses 
      WHERE name ILIKE '%ayden%' OR name ILIKE '%game%'
    `);
    
    if (businessResult.rows.length === 0) {
      console.log('❌ No game store business found');
      return;
    }
    
    const business = businessResult.rows[0];
    console.log(`🎮 Found business: ${business.name} (${business.id})`);
    
    // Generate 400+ days of slots (13+ months)
    console.log(`📅 Generating 13+ months of calendar slots...`);
    const slotsGenerated = await generateCalendarSlots(business.id, 400);
    console.log(`✅ Generated ${slotsGenerated} slots for ${business.name}`);
    
    // Verify the generation
    const verification = await pool.query(`
      SELECT 
        COUNT(*) as total,
        COUNT(CASE WHEN is_available THEN 1 END) as available,
        MIN(slot_start) as earliest,
        MAX(slot_start) as latest
      FROM calendar_slots 
      WHERE business_id = $1
    `, [business.id]);
    
    const result = verification.rows[0];
    console.log(`\n📊 VERIFICATION:`);
    console.log(`   Total slots: ${result.total}`);
    console.log(`   Available slots: ${result.available}`);
    console.log(`   Date range: ${result.earliest} to ${result.latest}`);
    
  } catch (error) {
    console.error('❌ Error:', error.message);
  } finally {
    await pool.end();
  }
}

generateSlots();