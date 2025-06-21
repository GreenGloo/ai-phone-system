#!/usr/bin/env node

// Check booking horizon for Tom's Garage
// This script analyzes how far into the future customers can actually book appointments

require('dotenv').config();
const { Pool } = require('pg');

const TOMS_GARAGE_ID = '8fea02b5-850a-4167-913b-a12043c65d17';

async function checkBookingHorizon() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  
  try {
    console.log('🔍 Analyzing booking horizon for Tom\'s Garage...');
    console.log(`Business ID: ${TOMS_GARAGE_ID}`);
    console.log('');
    
    // First, verify the business exists
    const businessCheck = await pool.query(`
      SELECT name, business_type, calendar_preferences 
      FROM businesses 
      WHERE id = $1
    `, [TOMS_GARAGE_ID]);
    
    if (businessCheck.rows.length === 0) {
      throw new Error('❌ Business not found! Check the business ID.');
    }
    
    const business = businessCheck.rows[0];
    console.log(`✅ Found business: ${business.name} (${business.business_type})`);
    console.log('');
    
    // Check calendar slots
    const slotsQuery = await pool.query(`
      SELECT 
        COUNT(*) as total_slots,
        COUNT(*) FILTER (WHERE is_available = true) as available_slots,
        MIN(slot_start) as earliest_slot,
        MAX(slot_start) as latest_slot,
        MAX(slot_start) FILTER (WHERE is_available = true) as latest_available_slot
      FROM calendar_slots 
      WHERE business_id = $1
    `, [TOMS_GARAGE_ID]);
    
    if (slotsQuery.rows.length === 0 || slotsQuery.rows[0].total_slots === '0') {
      console.log('❌ No calendar slots found for this business!');
      console.log('💡 Calendar slots need to be generated first.');
      return;
    }
    
    const slots = slotsQuery.rows[0];
    console.log(`📊 CALENDAR SLOTS SUMMARY:`);
    console.log(`   Total slots: ${slots.total_slots}`);
    console.log(`   Available slots: ${slots.available_slots}`);
    console.log('');
    
    // Calculate booking horizon
    const now = new Date();
    const earliestSlot = new Date(slots.earliest_slot);
    const latestSlot = new Date(slots.latest_slot);
    const latestAvailableSlot = new Date(slots.latest_available_slot);
    
    const daysToLatestSlot = Math.ceil((latestSlot - now) / (1000 * 60 * 60 * 24));
    const daysToLatestAvailable = Math.ceil((latestAvailableSlot - now) / (1000 * 60 * 60 * 24));
    
    console.log(`📅 BOOKING HORIZON ANALYSIS:`);
    console.log(`   Today: ${now.toLocaleDateString()}`);
    console.log(`   Earliest slot: ${earliestSlot.toLocaleDateString()}`);
    console.log(`   Latest slot: ${latestSlot.toLocaleDateString()}`);
    console.log(`   Latest available slot: ${latestAvailableSlot.toLocaleDateString()}`);
    console.log('');
    
    console.log(`📏 HORIZON DISTANCES:`);
    console.log(`   Days to latest slot: ${daysToLatestSlot} days`);
    console.log(`   Days to latest available slot: ${daysToLatestAvailable} days`);
    console.log('');
    
    // Check if it's truly a full year
    const isFullYear = daysToLatestAvailable >= 365;
    const coverage = (daysToLatestAvailable / 365 * 100).toFixed(1);
    
    console.log(`🎯 BOOKING COVERAGE:`);
    if (isFullYear) {
      console.log(`   ✅ Full year coverage: ${daysToLatestAvailable} days (${coverage}% of year)`);
    } else {
      console.log(`   ⚠️  Partial coverage: ${daysToLatestAvailable} days (${coverage}% of year)`);
      console.log(`   📊 Missing: ${365 - daysToLatestAvailable} days to reach full year`);
    }
    console.log('');
    
    // Check for gaps in coverage
    const gapsQuery = await pool.query(`
      WITH date_series AS (
        SELECT 
          generate_series(
            CURRENT_DATE,
            CURRENT_DATE + INTERVAL '365 days',
            INTERVAL '1 day'
          )::date as check_date
      ),
      daily_availability AS (
        SELECT 
          DATE(slot_start) as slot_date,
          COUNT(*) FILTER (WHERE is_available = true) as available_count
        FROM calendar_slots 
        WHERE business_id = $1
          AND slot_start >= CURRENT_DATE
          AND slot_start <= CURRENT_DATE + INTERVAL '365 days'
        GROUP BY DATE(slot_start)
      )
      SELECT 
        COUNT(*) as total_days,
        COUNT(da.slot_date) as days_with_slots,
        COUNT(*) - COUNT(da.slot_date) as days_without_slots
      FROM date_series ds
      LEFT JOIN daily_availability da ON ds.check_date = da.slot_date
    `, [TOMS_GARAGE_ID]);
    
    const gaps = gapsQuery.rows[0];
    console.log(`📈 COVERAGE GAPS:`);
    console.log(`   Days in next 365 days: ${gaps.total_days}`);
    console.log(`   Days with available slots: ${gaps.days_with_slots}`);
    console.log(`   Days without slots: ${gaps.days_without_slots}`);
    
    if (parseInt(gaps.days_without_slots) > 0) {
      console.log(`   ⚠️  Gap percentage: ${(gaps.days_without_slots / gaps.total_days * 100).toFixed(1)}%`);
    } else {
      console.log(`   ✅ No gaps found in coverage`);
    }
    console.log('');
    
    // Check business hours to understand gaps
    const businessHours = business.calendar_preferences;
    console.log(`🕐 BUSINESS HOURS ANALYSIS:`);
    console.log(`   Calendar preferences:`, businessHours);
    
    // Get business hours from businesses table
    const hoursQuery = await pool.query(`
      SELECT business_hours 
      FROM businesses 
      WHERE id = $1
    `, [TOMS_GARAGE_ID]);
    
    const hours = hoursQuery.rows[0].business_hours;
    console.log(`   Business hours by day:`);
    Object.entries(hours).forEach(([day, dayHours]) => {
      if (dayHours.enabled) {
        console.log(`     ${day}: ${dayHours.start} - ${dayHours.end}`);
      } else {
        console.log(`     ${day}: CLOSED`);
      }
    });
    console.log('');
    
    // Sample of upcoming available slots
    const upcomingSlots = await pool.query(`
      SELECT slot_start, slot_end
      FROM calendar_slots 
      WHERE business_id = $1 
        AND is_available = true 
        AND slot_start >= NOW()
      ORDER BY slot_start 
      LIMIT 10
    `, [TOMS_GARAGE_ID]);
    
    console.log(`📋 NEXT 10 AVAILABLE SLOTS:`);
    upcomingSlots.rows.forEach((slot, index) => {
      const start = new Date(slot.slot_start);
      const end = new Date(slot.slot_end);
      console.log(`   ${index + 1}. ${start.toLocaleDateString()} ${start.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})} - ${end.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}`);
    });
    
    console.log('');
    
    // Final summary and recommendations
    console.log('📝 SUMMARY & RECOMMENDATIONS:');
    console.log('─'.repeat(50));
    
    const closedDays = Object.entries(hours).filter(([day, dayHours]) => !dayHours.enabled).length;
    const expectedGapPercentage = (closedDays / 7 * 100).toFixed(1);
    
    console.log(`• Tom's Garage is closed ${closedDays} days per week (${Object.entries(hours).filter(([day, dayHours]) => !dayHours.enabled).map(([day]) => day).join(', ')})`);
    console.log(`• Expected gap percentage: ~${expectedGapPercentage}% (due to closed days)`);
    console.log(`• Actual gap percentage: ${(gaps.days_without_slots / gaps.total_days * 100).toFixed(1)}%`);
    console.log('');
    
    if (daysToLatestAvailable >= 365) {
      console.log('✅ RESULT: Tom\'s Garage offers TRUE full-year booking coverage');
    } else if (daysToLatestAvailable >= 360) {
      console.log('✅ RESULT: Tom\'s Garage offers NEAR full-year booking coverage');
      console.log(`   (${365 - daysToLatestAvailable} days short of full year)`);
    } else {
      console.log('⚠️  RESULT: Tom\'s Garage has LIMITED booking coverage');
      console.log(`   Only ${daysToLatestAvailable} days available (${coverage}% of year)`);
    }
    
    console.log('');
    console.log('🎯 KEY FINDINGS:');
    console.log(`   • Booking horizon: ${daysToLatestAvailable} days from today`);
    console.log(`   • Total bookable slots: ${slots.available_slots}`);
    console.log(`   • Coverage gaps are primarily due to weekend closures`);
    console.log(`   • Customers can book appointments until ${latestAvailableSlot.toLocaleDateString()}`);
    
    console.log('');
    console.log('🔍 ANALYSIS COMPLETE');
    
  } catch (error) {
    console.error('❌ Error checking booking horizon:', error.message);
    if (error.code) {
      console.error(`   Database error code: ${error.code}`);
    }
  } finally {
    await pool.end();
  }
}

// Run the analysis
if (require.main === module) {
  checkBookingHorizon().catch(console.error);
}

module.exports = { checkBookingHorizon };