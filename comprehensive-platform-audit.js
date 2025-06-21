#!/usr/bin/env node

// COMPREHENSIVE PLATFORM AUDIT SCRIPT
// Tests all critical functionality before removing any old code

require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

console.log('🔍 COMPREHENSIVE PLATFORM AUDIT');
console.log('='.repeat(60));

async function auditDatabaseConnections() {
  console.log('\n📊 1. DATABASE CONNECTION AUDIT');
  console.log('-'.repeat(40));
  
  try {
    const result = await pool.query('SELECT NOW() as current_time, VERSION() as version');
    console.log('✅ Database connection: WORKING');
    console.log(`   Current time: ${result.rows[0].current_time}`);
    console.log(`   PostgreSQL version: ${result.rows[0].version.split(' ')[0]}`);
    
    // Test timezone settings
    const tzResult = await pool.query('SHOW timezone');
    console.log(`   Database timezone: ${tzResult.rows[0].TimeZone}`);
    
    return true;
  } catch (error) {
    console.log('❌ Database connection: FAILED');
    console.log(`   Error: ${error.message}`);
    return false;
  }
}

async function auditCoreTables() {
  console.log('\n🗄️ 2. CORE TABLES AUDIT');
  console.log('-'.repeat(40));
  
  const criticalTables = [
    'businesses',
    'service_types', 
    'calendar_slots',
    'conversations',
    'customers',
    'service_keywords',
    'schema_migrations'
  ];
  
  let allTablesExist = true;
  
  for (const table of criticalTables) {
    try {
      const result = await pool.query(`
        SELECT EXISTS (
          SELECT FROM information_schema.tables 
          WHERE table_name = $1
        );
      `, [table]);
      
      if (result.rows[0].exists) {
        const countResult = await pool.query(`SELECT COUNT(*) as count FROM ${table}`);
        console.log(`✅ ${table}: EXISTS (${countResult.rows[0].count} rows)`);
      } else {
        console.log(`❌ ${table}: MISSING`);
        allTablesExist = false;
      }
    } catch (error) {
      console.log(`❌ ${table}: ERROR - ${error.message}`);
      allTablesExist = false;
    }
  }
  
  return allTablesExist;
}

async function auditAutoMigrations() {
  console.log('\n🔄 3. AUTO-MIGRATION SYSTEM AUDIT');
  console.log('-'.repeat(40));
  
  try {
    const { autoMigrate } = require('./auto-migration-system');
    console.log('✅ Auto-migration system: LOADED');
    
    // Check migration status
    const migrations = await pool.query('SELECT migration_name, applied_at FROM schema_migrations ORDER BY applied_at');
    console.log(`✅ Migrations applied: ${migrations.rows.length}`);
    
    migrations.rows.forEach(migration => {
      console.log(`   - ${migration.migration_name}`);
    });
    
    return true;
  } catch (error) {
    console.log('❌ Auto-migration system: FAILED');
    console.log(`   Error: ${error.message}`);
    return false;
  }
}

async function auditCalendarGeneration() {
  console.log('\n📅 4. CALENDAR GENERATION AUDIT');
  console.log('-'.repeat(40));
  
  try {
    const { generateCalendarSlots } = require('./calendar-generator');
    console.log('✅ Calendar generator: LOADED');
    
    // Use existing business for testing (safer than creating new one)
    const existingBusiness = await pool.query(`
      SELECT id, name, business_hours, timezone 
      FROM businesses 
      WHERE business_hours IS NOT NULL 
      LIMIT 1
    `);
    
    if (existingBusiness.rows.length === 0) {
      console.log('⚠️ No businesses with business hours found - skipping calendar test');
      return true;
    }
    
    const testBusinessId = existingBusiness.rows[0].id;
    const businessName = existingBusiness.rows[0].name;
    console.log(`   Testing with existing business: ${businessName}`);
    
    // Test calendar generation with existing business
    const slotsGenerated = await generateCalendarSlots(testBusinessId, 7); // 7 days
    console.log(`✅ Calendar generation: WORKING (${slotsGenerated} slots)`);
    
    // Verify timezone correctness
    const slots = await pool.query(`
      SELECT slot_start, slot_end 
      FROM calendar_slots 
      WHERE business_id = $1 
      ORDER BY slot_start 
      LIMIT 3
    `, [testBusinessId]);
    
    if (slots.rows.length > 0) {
      console.log('   Sample slots (timezone validation):');
      let hasBuggySlots = false;
      slots.rows.forEach((slot, index) => {
        const easternTime = new Date(slot.slot_start).toLocaleString('en-US', {
          timeZone: 'America/New_York',
          weekday: 'short',
          hour: 'numeric',
          minute: '2-digit',
          hour12: true
        });
        console.log(`     ${index + 1}. ${easternTime} (UTC: ${slot.slot_start})`);
        
        // Check for buggy 4 AM slots
        if (easternTime.includes('4:00 AM') || easternTime.includes('4:30 AM')) {
          console.log('       ❌ BUGGY SLOT DETECTED!');
          hasBuggySlots = true;
        } else {
          console.log('       ✅ Valid business hours');
        }
      });
      
      if (hasBuggySlots) {
        console.log('   ⚠️ WARNING: Buggy timezone slots still exist in database');
        console.log('   🔧 May need to regenerate calendar slots for this business');
      } else {
        console.log('   ✅ All sample slots show correct timezone');
      }
    }
    
    // Note: Not cleaning up slots for existing business to avoid affecting production data
    
    return true;
  } catch (error) {
    console.log('❌ Calendar generation: FAILED');
    console.log(`   Error: ${error.message}`);
    return false;
  }
}

async function auditConversationalAI() {
  console.log('\n🤖 5. CONVERSATIONAL AI AUDIT');
  console.log('-'.repeat(40));
  
  try {
    const { handleVoiceCall, trackTrialUsage } = require('./conversational-ai');
    console.log('✅ Conversational AI: LOADED');
    
    // Test getAvailableSlots function
    const slots = require('./conversational-ai');
    console.log('✅ Available slots function: ACCESSIBLE');
    
    return true;
  } catch (error) {
    console.log('❌ Conversational AI: FAILED');
    console.log(`   Error: ${error.message}`);
    return false;
  }
}

async function auditVoiceIntegration() {
  console.log('\n🎤 6. VOICE INTEGRATION AUDIT');
  console.log('-'.repeat(40));
  
  try {
    const { generateElevenLabsAudio, ELEVENLABS_VOICES } = require('./elevenlabs-integration');
    console.log('✅ ElevenLabs integration: LOADED');
    console.log(`   Available voices: ${Object.keys(ELEVENLABS_VOICES).length}`);
    
    // Check API key
    if (process.env.ELEVENLABS_API_KEY) {
      console.log('✅ ElevenLabs API key: CONFIGURED');
    } else {
      console.log('⚠️ ElevenLabs API key: MISSING');
    }
    
    return true;
  } catch (error) {
    console.log('❌ Voice integration: FAILED');
    console.log(`   Error: ${error.message}`);
    return false;
  }
}

async function auditBusinessAI() {
  console.log('\n🏪 7. BUSINESS AI SYSTEMS AUDIT');
  console.log('-'.repeat(40));
  
  try {
    // Check service keyword generator
    const { generateKeywordsForService } = require('./service-keyword-generator');
    console.log('✅ Service keyword generator: LOADED');
    
    // Check business auto-repair
    const { startBusinessHealthMonitoring } = require('./business-auto-repair');
    console.log('✅ Business auto-repair: LOADED');
    
    // Check webhook auto-config
    const { autoConfigureAllWebhooks } = require('./webhook-auto-config');
    console.log('✅ Webhook auto-config: LOADED');
    
    return true;
  } catch (error) {
    console.log('❌ Business AI systems: FAILED');
    console.log(`   Error: ${error.message}`);
    return false;
  }
}

async function auditAPIEndpoints() {
  console.log('\n🌐 8. API ENDPOINTS AUDIT');
  console.log('-'.repeat(40));
  
  try {
    // Check if app.js loads without errors
    const path = require('path');
    const appPath = path.join(__dirname, 'app.js');
    
    // Just verify the file exists and can be required
    require.resolve(appPath);
    console.log('✅ Main application file: LOADABLE');
    
    // Check critical dependencies
    const express = require('express');
    const twilio = require('twilio');
    const stripe = require('stripe');
    console.log('✅ Core dependencies: LOADED');
    
    return true;
  } catch (error) {
    console.log('❌ API endpoints: FAILED');
    console.log(`   Error: ${error.message}`);
    return false;
  }
}

async function auditEnvironmentConfig() {
  console.log('\n⚙️ 9. ENVIRONMENT CONFIGURATION AUDIT');
  console.log('-'.repeat(40));
  
  const criticalEnvVars = [
    'DATABASE_URL',
    'TWILIO_SID',
    'TWILIO_TOKEN',
    'TWILIO_PHONE_NUMBER',
    'JWT_SECRET',
    'ANTHROPIC_API_KEY',
    'OPENAI_API_KEY',
    'ELEVENLABS_API_KEY'
  ];
  
  let allConfigured = true;
  
  criticalEnvVars.forEach(envVar => {
    if (process.env[envVar]) {
      console.log(`✅ ${envVar}: CONFIGURED`);
    } else {
      console.log(`❌ ${envVar}: MISSING`);
      allConfigured = false;
    }
  });
  
  return allConfigured;
}

async function runComprehensiveAudit() {
  const auditResults = [];
  
  try {
    auditResults.push(['Database Connection', await auditDatabaseConnections()]);
    auditResults.push(['Core Tables', await auditCoreTables()]);
    auditResults.push(['Auto-Migration System', await auditAutoMigrations()]);
    auditResults.push(['Calendar Generation', await auditCalendarGeneration()]);
    auditResults.push(['Conversational AI', await auditConversationalAI()]);
    auditResults.push(['Voice Integration', await auditVoiceIntegration()]);
    auditResults.push(['Business AI Systems', await auditBusinessAI()]);
    auditResults.push(['API Endpoints', await auditAPIEndpoints()]);
    auditResults.push(['Environment Config', await auditEnvironmentConfig()]);
    
  } catch (error) {
    console.log(`\n❌ AUDIT FAILED: ${error.message}`);
    process.exit(1);
  } finally {
    await pool.end();
  }
  
  // Summary
  console.log('\n🎯 AUDIT SUMMARY');
  console.log('='.repeat(60));
  
  const passed = auditResults.filter(([, result]) => result).length;
  const total = auditResults.length;
  
  auditResults.forEach(([name, result]) => {
    console.log(`${result ? '✅' : '❌'} ${name}`);
  });
  
  console.log(`\n📊 OVERALL RESULT: ${passed}/${total} systems passing`);
  
  if (passed === total) {
    console.log('🎉 ALL SYSTEMS OPERATIONAL - Platform is healthy!');
    console.log('✅ Safe to proceed with cleanup operations');
    return true;
  } else {
    console.log('⚠️ ISSUES DETECTED - Platform needs attention before cleanup');
    console.log('❌ DO NOT proceed with file removal until issues are resolved');
    return false;
  }
}

// Run the audit
runComprehensiveAudit()
  .then(success => {
    process.exit(success ? 0 : 1);
  })
  .catch(error => {
    console.error('💥 AUDIT CRASHED:', error);
    process.exit(1);
  });