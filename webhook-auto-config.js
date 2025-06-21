// AUTOMATIC WEBHOOK CONFIGURATION & SELF-HEALING SYSTEM
// Automatically configures and maintains webhooks for all businesses

require('dotenv').config();
const { Pool } = require('pg');
const twilio = require('twilio');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const twilioClient = twilio(process.env.TWILIO_SID, process.env.TWILIO_TOKEN);

// Get the correct webhook URL based on environment
function getWebhookBaseUrl() {
  // Production: Use Railway app URL or custom domain
  if (process.env.NODE_ENV === 'production') {
    return process.env.WEBHOOK_BASE_URL || 'https://ai-phone-system-production.up.railway.app';
  }
  
  // Development: Use ngrok or local tunneling
  return process.env.WEBHOOK_BASE_URL || 'https://your-ngrok-url.ngrok.io';
}

async function configureBusinessWebhook(businessId, twilioPhoneSid) {
  console.log(`🔧 Configuring webhook for business ${businessId} (phone: ${twilioPhoneSid})`);
  
  try {
    // Use root endpoint for voice (routes by phone number) and specific endpoint for SMS
    const voiceWebhookUrl = `${getWebhookBaseUrl()}/`;
    const smsWebhookUrl = `${getWebhookBaseUrl()}/sms/incoming/${businessId}`;
    
    // Update Twilio phone number webhook
    const updatedNumber = await twilioClient.incomingPhoneNumbers(twilioPhoneSid)
      .update({
        voiceUrl: voiceWebhookUrl,
        voiceMethod: 'POST',
        smsUrl: smsWebhookUrl,
        smsMethod: 'POST'
      });
    
    // Update business webhook status in database
    await pool.query(`
      UPDATE businesses 
      SET webhook_configured = true, 
          webhook_last_verified = CURRENT_TIMESTAMP, 
          webhook_status = 'active'
      WHERE id = $1
    `, [businessId]);
    
    console.log(`✅ Webhooks configured for business ${businessId}:`);
    console.log(`   Voice: ${voiceWebhookUrl}`);
    console.log(`   SMS: ${smsWebhookUrl}`);
    return { success: true, voiceWebhookUrl, smsWebhookUrl, twilioResponse: updatedNumber };
    
  } catch (error) {
    console.error(`❌ Failed to configure webhook for business ${businessId}:`, error);
    
    // Update business webhook status to failed
    await pool.query(`
      UPDATE businesses 
      SET webhook_status = 'failed', 
          webhook_last_verified = CURRENT_TIMESTAMP
      WHERE id = $1
    `, [businessId]);
    
    return { success: false, error: error.message };
  }
}

async function verifyWebhookConfiguration(businessId, twilioPhoneSid) {
  console.log(`🔍 Verifying webhook for business ${businessId}`);
  
  try {
    // Get current Twilio phone number configuration
    const phoneNumber = await twilioClient.incomingPhoneNumbers(twilioPhoneSid).fetch();
    
    const expectedWebhookUrl = `${getWebhookBaseUrl()}/`;
    const currentVoiceUrl = phoneNumber.voiceUrl;
    
    // Check if webhook URL matches expected
    if (currentVoiceUrl === expectedWebhookUrl) {
      // Update verification timestamp
      await pool.query(`
        UPDATE businesses 
        SET webhook_last_verified = CURRENT_TIMESTAMP, 
            webhook_status = 'active'
        WHERE id = $1
      `, [businessId]);
      
      console.log(`✅ Webhook verified for business ${businessId}`);
      return { success: true, status: 'verified', currentUrl: currentVoiceUrl };
    } else {
      console.log(`⚠️ Webhook mismatch for business ${businessId}: expected ${expectedWebhookUrl}, got ${currentVoiceUrl}`);
      
      // Auto-repair the webhook
      const repairResult = await configureBusinessWebhook(businessId, twilioPhoneSid);
      
      return { 
        success: repairResult.success, 
        status: 'repaired', 
        expectedUrl: expectedWebhookUrl,
        foundUrl: currentVoiceUrl,
        repairResult 
      };
    }
    
  } catch (error) {
    console.error(`❌ Failed to verify webhook for business ${businessId}:`, error);
    
    // Mark as failed
    await pool.query(`
      UPDATE businesses 
      SET webhook_status = 'verification_failed', 
          webhook_last_verified = CURRENT_TIMESTAMP
      WHERE id = $1
    `, [businessId]);
    
    return { success: false, error: error.message };
  }
}

async function autoConfigureAllWebhooks() {
  console.log('🚀 STARTING AUTOMATIC WEBHOOK CONFIGURATION');
  console.log('='.repeat(60));
  
  try {
    // Get all businesses with phone numbers that need webhook configuration
    const businesses = await pool.query(`
      SELECT id, name, twilio_phone_sid, webhook_configured, webhook_status
      FROM businesses 
      WHERE twilio_phone_sid IS NOT NULL 
      AND onboarding_completed = true
      AND status = 'active'
      ORDER BY created_at
    `);
    
    console.log(`📋 Found ${businesses.rows.length} businesses with phone numbers`);
    
    let configuredCount = 0;
    let verifiedCount = 0;
    let failedCount = 0;
    
    for (const business of businesses.rows) {
      console.log(`\n🔧 Processing: ${business.name}`);
      
      if (!business.webhook_configured || business.webhook_status === 'failed') {
        // Configure webhook for unconfigured or failed businesses
        const result = await configureBusinessWebhook(business.id, business.twilio_phone_sid);
        if (result.success) {
          configuredCount++;
        } else {
          failedCount++;
        }
      } else {
        // Verify webhook for already configured businesses
        const result = await verifyWebhookConfiguration(business.id, business.twilio_phone_sid);
        if (result.success) {
          if (result.status === 'verified') {
            verifiedCount++;
          } else if (result.status === 'repaired') {
            configuredCount++;
          }
        } else {
          failedCount++;
        }
      }
      
      // Small delay to avoid rate limiting
      await new Promise(resolve => setTimeout(resolve, 200));
    }
    
    console.log('\n' + '='.repeat(60));
    console.log('🎯 WEBHOOK AUTO-CONFIGURATION RESULTS');
    console.log('='.repeat(60));
    console.log(`✅ Webhooks configured: ${configuredCount}`);
    console.log(`✅ Webhooks verified: ${verifiedCount}`);
    console.log(`❌ Webhooks failed: ${failedCount}`);
    
    if (failedCount > 0) {
      console.log(`\n⚠️ ${failedCount} webhooks failed - businesses may not receive calls properly`);
    } else {
      console.log('\n🚀 ALL WEBHOOKS CONFIGURED SUCCESSFULLY!');
    }
    
    return { configuredCount, verifiedCount, failedCount };
    
  } catch (error) {
    console.error('🚨 Webhook auto-configuration failed:', error);
    throw error;
  }
}

async function startWebhookHealthCheck() {
  console.log('🔄 Starting webhook health check system...');
  
  // Run webhook verification every 6 hours
  const healthCheckInterval = 6 * 60 * 60 * 1000; // 6 hours
  
  setInterval(async () => {
    console.log('\n🩺 Running scheduled webhook health check...');
    
    try {
      // Get businesses that haven't been verified recently
      const businessesToCheck = await pool.query(`
        SELECT id, name, twilio_phone_sid
        FROM businesses 
        WHERE twilio_phone_sid IS NOT NULL 
        AND onboarding_completed = true
        AND status = 'active'
        AND (webhook_last_verified IS NULL OR webhook_last_verified < NOW() - INTERVAL '6 hours')
        ORDER BY webhook_last_verified ASC NULLS FIRST
        LIMIT 10
      `);
      
      console.log(`📋 Health checking ${businessesToCheck.rows.length} businesses`);
      
      for (const business of businessesToCheck.rows) {
        await verifyWebhookConfiguration(business.id, business.twilio_phone_sid);
        
        // Small delay between checks
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
      
      console.log('✅ Webhook health check completed');
      
    } catch (error) {
      console.error('❌ Webhook health check failed:', error);
    }
  }, healthCheckInterval);
  
  console.log(`✅ Webhook health check scheduled every ${healthCheckInterval / (1000 * 60 * 60)} hours`);
}

// Self-healing webhook system for specific business
async function healBusinessWebhook(businessId) {
  console.log(`🩹 Self-healing webhook for business ${businessId}`);
  
  try {
    // Get business details
    const businessResult = await pool.query(
      'SELECT id, name, twilio_phone_sid FROM businesses WHERE id = $1',
      [businessId]
    );
    
    if (businessResult.rows.length === 0) {
      throw new Error(`Business ${businessId} not found`);
    }
    
    const business = businessResult.rows[0];
    
    if (!business.twilio_phone_sid) {
      throw new Error(`Business ${business.name} has no phone number configured`);
    }
    
    // Configure webhook
    const result = await configureBusinessWebhook(business.id, business.twilio_phone_sid);
    
    if (result.success) {
      console.log(`✅ Self-healing successful for ${business.name}`);
      return result;
    } else {
      console.error(`❌ Self-healing failed for ${business.name}:`, result.error);
      return result;
    }
    
  } catch (error) {
    console.error(`❌ Self-healing error for business ${businessId}:`, error);
    return { success: false, error: error.message };
  }
}

module.exports = {
  configureBusinessWebhook,
  verifyWebhookConfiguration,
  autoConfigureAllWebhooks,
  startWebhookHealthCheck,
  healBusinessWebhook,
  getWebhookBaseUrl
};