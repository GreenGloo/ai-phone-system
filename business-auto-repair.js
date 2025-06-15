// BUSINESS DATA AUTO-REPAIR SYSTEM
// Automatically detects and fixes business data inconsistencies

require('dotenv').config();
const { Pool } = require('pg');
const { generateKeywordsForService } = require('./service-keyword-generator');
const { generateCalendarSlots } = require('./calendar-generator');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

// Data integrity checks and auto-repairs
const INTEGRITY_CHECKS = [
  {
    name: 'missing_service_keywords',
    description: 'Ensure all services have AI-generated keywords',
    check: async (businessId) => {
      const result = await pool.query(`
        SELECT st.id, st.name
        FROM service_types st
        LEFT JOIN service_keywords sk ON st.id = sk.service_id
        WHERE st.business_id = $1 
        AND st.is_active = true
        AND sk.service_id IS NULL
      `, [businessId]);
      
      return {
        hasIssues: result.rows.length > 0,
        issues: result.rows,
        severity: 'medium'
      };
    },
    repair: async (businessId, issues) => {
      let repairedCount = 0;
      
      for (const service of issues) {
        try {
          const keywordResult = await generateKeywordsForService(service.id);
          if (keywordResult.success) {
            console.log(`✅ Generated keywords for service: ${service.name}`);
            repairedCount++;
          }
        } catch (error) {
          console.error(`❌ Failed to generate keywords for ${service.name}:`, error);
        }
      }
      
      return { repairedCount, totalIssues: issues.length };
    }
  },
  {
    name: 'missing_calendar_slots',
    description: 'Ensure businesses have calendar slots for booking',
    check: async (businessId) => {
      const result = await pool.query(`
        SELECT 
          COUNT(*) as slot_count,
          MAX(slot_start) as latest_slot,
          NOW() as current_time
        FROM calendar_slots
        WHERE business_id = $1
        AND slot_start > NOW()
      `, [businessId]);
      
      const slotCount = parseInt(result.rows[0].slot_count);
      const latestSlot = result.rows[0].latest_slot;
      const currentTime = new Date(result.rows[0].current_time);
      
      // Calculate days until latest bookable slot
      const daysAhead = latestSlot ? 
        Math.ceil((new Date(latestSlot) - currentTime) / (1000 * 60 * 60 * 24)) : 0;
      
      // Issue if less than 365 days of booking horizon (maintain 400-day rolling window for annual appointments)
      const hasIssues = daysAhead < 365;
      
      return {
        hasIssues,
        issues: [{ slotCount, daysAhead, businessId }],
        severity: daysAhead === 0 ? 'high' : 'medium'
      };
    },
    repair: async (businessId, issues) => {
      try {
        // Check if business has business hours
        const businessResult = await pool.query(
          'SELECT business_hours FROM businesses WHERE id = $1',
          [businessId]
        );
        
        if (businessResult.rows.length > 0 && businessResult.rows[0].business_hours) {
          const currentHorizon = issues[0].daysAhead || 0;
          console.log(`📅 Current booking horizon: ${currentHorizon} days - regenerating for annual appointments`);
          const slotsGenerated = await generateCalendarSlots(businessId, 400);
          console.log(`✅ Generated ${slotsGenerated} calendar slots - booking horizon now extends 400+ days for annual appointments`);
          return { repairedCount: 1, totalIssues: 1 };
        } else {
          console.log(`⚠️ Business has no business hours - cannot generate calendar slots`);
          return { repairedCount: 0, totalIssues: 1 };
        }
      } catch (error) {
        console.error(`❌ Failed to generate calendar slots:`, error);
        return { repairedCount: 0, totalIssues: 1 };
      }
    }
  },
  {
    name: 'webhook_configuration',
    description: 'Ensure webhook is properly configured',
    check: async (businessId) => {
      const result = await pool.query(`
        SELECT webhook_configured, webhook_status, twilio_phone_sid
        FROM businesses
        WHERE id = $1
      `, [businessId]);
      
      if (result.rows.length === 0) {
        return { hasIssues: true, issues: [{ error: 'Business not found' }], severity: 'high' };
      }
      
      const business = result.rows[0];
      const hasIssues = business.twilio_phone_sid && (!business.webhook_configured || business.webhook_status === 'failed');
      
      return {
        hasIssues,
        issues: hasIssues ? [business] : [],
        severity: 'high'
      };
    },
    repair: async (businessId, issues) => {
      try {
        const { configureBusinessWebhook } = require('./webhook-auto-config');
        
        const business = issues[0];
        if (business.twilio_phone_sid) {
          const result = await configureBusinessWebhook(businessId, business.twilio_phone_sid);
          if (result.success) {
            console.log(`✅ Repaired webhook configuration for business`);
            return { repairedCount: 1, totalIssues: 1 };
          }
        }
        
        return { repairedCount: 0, totalIssues: 1 };
      } catch (error) {
        console.error(`❌ Failed to repair webhook:`, error);
        return { repairedCount: 0, totalIssues: 1 };
      }
    }
  },
  {
    name: 'orphaned_data',
    description: 'Remove orphaned data from deleted services',
    check: async (businessId) => {
      const result = await pool.query(`
        SELECT sk.id, sk.service_id, sk.keyword
        FROM service_keywords sk
        LEFT JOIN service_types st ON sk.service_id = st.id
        WHERE sk.business_id = $1
        AND st.id IS NULL
      `, [businessId]);
      
      return {
        hasIssues: result.rows.length > 0,
        issues: result.rows,
        severity: 'low'
      };
    },
    repair: async (businessId, issues) => {
      let repairedCount = 0;
      
      for (const orphan of issues) {
        try {
          await pool.query('DELETE FROM service_keywords WHERE id = $1', [orphan.id]);
          console.log(`✅ Removed orphaned keyword: ${orphan.keyword}`);
          repairedCount++;
        } catch (error) {
          console.error(`❌ Failed to remove orphaned data:`, error);
        }
      }
      
      return { repairedCount, totalIssues: issues.length };
    }
  },
  {
    name: 'invalid_business_hours',
    description: 'Ensure business hours are properly formatted',
    check: async (businessId) => {
      const result = await pool.query(`
        SELECT id, business_hours
        FROM businesses
        WHERE id = $1
      `, [businessId]);
      
      if (result.rows.length === 0) {
        return { hasIssues: false, issues: [], severity: 'low' };
      }
      
      const business = result.rows[0];
      const businessHours = business.business_hours;
      
      // Check if business hours are valid
      const requiredDays = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
      const hasIssues = !businessHours || !requiredDays.every(day => 
        businessHours[day] && 
        typeof businessHours[day].enabled === 'boolean' &&
        (businessHours[day].enabled ? businessHours[day].start && businessHours[day].end : true)
      );
      
      return {
        hasIssues,
        issues: hasIssues ? [{ businessId, currentHours: businessHours }] : [],
        severity: 'medium'
      };
    },
    repair: async (businessId, issues) => {
      try {
        // Set default business hours (M-F 9-5, weekends closed)
        const defaultHours = {
          monday: { enabled: true, start: '09:00', end: '17:00' },
          tuesday: { enabled: true, start: '09:00', end: '17:00' },
          wednesday: { enabled: true, start: '09:00', end: '17:00' },
          thursday: { enabled: true, start: '09:00', end: '17:00' },
          friday: { enabled: true, start: '09:00', end: '17:00' },
          saturday: { enabled: false },
          sunday: { enabled: false }
        };
        
        await pool.query(
          'UPDATE businesses SET business_hours = $1 WHERE id = $2',
          [JSON.stringify(defaultHours), businessId]
        );
        
        console.log(`✅ Set default business hours for business`);
        return { repairedCount: 1, totalIssues: 1 };
      } catch (error) {
        console.error(`❌ Failed to repair business hours:`, error);
        return { repairedCount: 0, totalIssues: 1 };
      }
    }
  }
];

async function calculateDataIntegrityScore(businessId) {
  let totalChecks = INTEGRITY_CHECKS.length;
  let passedChecks = 0;
  let highSeverityIssues = 0;
  let mediumSeverityIssues = 0;
  
  for (const check of INTEGRITY_CHECKS) {
    try {
      const result = await check.check(businessId);
      
      if (!result.hasIssues) {
        passedChecks++;
      } else {
        if (result.severity === 'high') {
          highSeverityIssues++;
        } else if (result.severity === 'medium') {
          mediumSeverityIssues++;
        }
      }
    } catch (error) {
      console.error(`❌ Integrity check ${check.name} failed:`, error);
    }
  }
  
  // Calculate score: high issues = -0.3, medium = -0.15, low = -0.05
  let score = passedChecks / totalChecks;
  score -= (highSeverityIssues * 0.3);
  score -= (mediumSeverityIssues * 0.15);
  
  return Math.max(0, Math.min(1, score)); // Clamp between 0 and 1
}

async function runBusinessDataRepair(businessId, autoFix = true) {
  console.log(`🔧 Running data integrity check for business ${businessId}`);
  
  try {
    let totalIssues = 0;
    let totalRepairs = 0;
    const issuesSummary = [];
    
    // Run all integrity checks
    for (const check of INTEGRITY_CHECKS) {
      console.log(`🔍 Checking: ${check.description}`);
      
      try {
        const result = await check.check(businessId);
        
        if (result.hasIssues) {
          console.log(`❌ Found ${result.issues.length} issues (${result.severity} severity)`);
          totalIssues += result.issues.length;
          
          issuesSummary.push({
            check: check.name,
            description: check.description,
            issueCount: result.issues.length,
            severity: result.severity
          });
          
          if (autoFix) {
            console.log(`🔧 Auto-repairing ${check.name}...`);
            const repairResult = await check.repair(businessId, result.issues);
            totalRepairs += repairResult.repairedCount;
            console.log(`✅ Repaired ${repairResult.repairedCount}/${repairResult.totalIssues} issues`);
          }
        } else {
          console.log(`✅ ${check.description}: OK`);
        }
      } catch (error) {
        console.error(`❌ Check ${check.name} failed:`, error);
      }
    }
    
    // Calculate and update integrity score
    const integrityScore = await calculateDataIntegrityScore(businessId);
    
    await pool.query(`
      UPDATE businesses 
      SET last_auto_repair = CURRENT_TIMESTAMP,
          auto_repair_status = $1,
          data_integrity_score = $2
      WHERE id = $3
    `, [
      totalIssues === 0 ? 'healthy' : (totalRepairs === totalIssues ? 'repaired' : 'needs_attention'),
      integrityScore,
      businessId
    ]);
    
    console.log(`📊 Data integrity score: ${(integrityScore * 100).toFixed(1)}%`);
    
    return {
      totalIssues,
      totalRepairs,
      integrityScore,
      issuesSummary
    };
    
  } catch (error) {
    console.error(`❌ Business data repair failed for ${businessId}:`, error);
    throw error;
  }
}

async function runAllBusinessRepairs() {
  console.log('🚀 STARTING AUTOMATIC BUSINESS DATA REPAIR');
  console.log('='.repeat(60));
  
  try {
    // Get all active businesses
    const businesses = await pool.query(`
      SELECT id, name, last_auto_repair
      FROM businesses 
      WHERE status = 'active'
      AND onboarding_completed = true
      ORDER BY last_auto_repair ASC NULLS FIRST
    `);
    
    console.log(`📋 Found ${businesses.rows.length} businesses for data repair`);
    
    let healthyCount = 0;
    let repairedCount = 0;
    let needsAttentionCount = 0;
    
    for (const business of businesses.rows) {
      console.log(`\n🔧 Processing: ${business.name}`);
      
      try {
        const result = await runBusinessDataRepair(business.id, true);
        
        if (result.totalIssues === 0) {
          healthyCount++;
        } else if (result.totalRepairs === result.totalIssues) {
          repairedCount++;
        } else {
          needsAttentionCount++;
        }
        
        // Small delay to avoid overwhelming the system
        await new Promise(resolve => setTimeout(resolve, 100));
        
      } catch (error) {
        console.error(`❌ Failed to repair business ${business.name}:`, error);
        needsAttentionCount++;
      }
    }
    
    console.log('\n' + '='.repeat(60));
    console.log('🎯 BUSINESS DATA REPAIR RESULTS');
    console.log('='.repeat(60));
    console.log(`✅ Healthy businesses: ${healthyCount}`);
    console.log(`🔧 Repaired businesses: ${repairedCount}`);
    console.log(`⚠️ Need attention: ${needsAttentionCount}`);
    
    if (needsAttentionCount > 0) {
      console.log(`\n⚠️ ${needsAttentionCount} businesses need manual attention`);
    } else {
      console.log('\n🚀 ALL BUSINESSES DATA INTEGRITY: HEALTHY!');
    }
    
    return { healthyCount, repairedCount, needsAttentionCount };
    
  } catch (error) {
    console.error('🚨 Business data repair system failed:', error);
    throw error;
  }
}

async function startBusinessHealthMonitoring() {
  console.log('🔄 Starting business health monitoring system...');
  
  // Run business data repair every 12 hours
  const healthCheckInterval = 12 * 60 * 60 * 1000; // 12 hours
  
  setInterval(async () => {
    console.log('\n🩺 Running scheduled business health check...');
    
    try {
      // Check businesses that haven't been repaired recently or have low integrity scores
      const businessesToCheck = await pool.query(`
        SELECT id, name
        FROM businesses 
        WHERE status = 'active'
        AND onboarding_completed = true
        AND (
          last_auto_repair IS NULL 
          OR last_auto_repair < NOW() - INTERVAL '24 hours'
          OR data_integrity_score < 0.8
        )
        ORDER BY data_integrity_score ASC NULLS FIRST, last_auto_repair ASC NULLS FIRST
        LIMIT 5
      `);
      
      console.log(`📋 Health checking ${businessesToCheck.rows.length} businesses`);
      
      for (const business of businessesToCheck.rows) {
        console.log(`🔧 Health check: ${business.name}`);
        await runBusinessDataRepair(business.id, true);
        
        // Small delay between checks
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
      
      console.log('✅ Business health check completed');
      
    } catch (error) {
      console.error('❌ Business health check failed:', error);
    }
  }, healthCheckInterval);
  
  console.log(`✅ Business health monitoring scheduled every ${healthCheckInterval / (1000 * 60 * 60)} hours`);
}

module.exports = {
  runBusinessDataRepair,
  runAllBusinessRepairs,
  startBusinessHealthMonitoring,
  calculateDataIntegrityScore,
  INTEGRITY_CHECKS
};