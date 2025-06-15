// FIXED VERSION: Complete onboarding endpoint with race condition prevention
// This is the replacement for the existing endpoint in app.js

// Add this at the top of app.js with other global variables
const processedOnboardingRequests = new Set();

// Replace the existing complete-onboarding endpoint with this:
app.post('/api/businesses/:businessId/complete-onboarding', authenticateToken, getBusinessContext, async (req, res) => {
  const client = await pool.connect();
  
  try {
    const { areaCode, selectedPhoneNumber, requestId } = req.body;
    
    // REQUEST DEDUPLICATION: Check if this request was already processed
    if (requestId && processedOnboardingRequests.has(requestId)) {
      console.log(`🔄 Duplicate request detected (${requestId}), returning cached result`);
      return res.json({
        success: true,
        message: 'Onboarding already processed',
        phoneNumber: req.business.phone_number,
        alreadyComplete: true,
        duplicate: true
      });
    }
    
    // Start database transaction
    await client.query('BEGIN');
    
    // DATABASE LOCKING: Lock the business row to prevent race conditions
    console.log(`🔒 Acquiring lock for business ${req.business.id}...`);
    const lockResult = await client.query(
      'SELECT id, name, phone_number, twilio_phone_sid FROM businesses WHERE id = $1 FOR UPDATE',
      [req.business.id]
    );
    
    if (lockResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Business not found' });
    }
    
    const lockedBusiness = lockResult.rows[0];
    
    // RACE CONDITION PREVENTION: Check again after acquiring lock
    if (lockedBusiness.phone_number) {
      console.log(`🚫 Business ${lockedBusiness.name} already has phone number: ${lockedBusiness.phone_number}`);
      await client.query('COMMIT');
      
      // Mark request as processed even for duplicates
      if (requestId) {
        processedOnboardingRequests.add(requestId);
        // Clean up old request IDs (keep only last 1000)
        if (processedOnboardingRequests.size > 1000) {
          const oldestRequests = Array.from(processedOnboardingRequests).slice(0, 100);
          oldestRequests.forEach(id => processedOnboardingRequests.delete(id));
        }
      }
      
      return res.json({
        success: true,
        message: 'Onboarding already complete',
        phoneNumber: lockedBusiness.phone_number,
        twilioSid: lockedBusiness.twilio_phone_sid,
        alreadyComplete: true
      });
    }
    
    console.log(`📞 Provisioning phone number for ${lockedBusiness.name}`);
    console.log(`📞 Request body:`, JSON.stringify(req.body, null, 2));
    console.log(`📞 Selected phone number from request: ${selectedPhoneNumber}`);
    console.log(`📞 Area code from request: ${areaCode}`);
    console.log(`📞 Request ID: ${requestId || 'None provided'}`);
    
    let phoneNumberToPurchase;
    
    if (selectedPhoneNumber) {
      // Use the selected phone number from onboarding
      phoneNumberToPurchase = selectedPhoneNumber;
      console.log(`📞 Using selected phone number: ${selectedPhoneNumber}`);
    } else {
      // Fallback to auto-selection (for backwards compatibility)
      console.log(`📞 Auto-selecting phone number (no selection provided)`);
      
      const searchParams = {
        limit: 5,
        voiceEnabled: true,
        smsEnabled: true
      };
      
      if (areaCode) {
        searchParams.areaCode = areaCode;
      }
      
      const availableNumbers = await twilioClient.availablePhoneNumbers('US')
        .local
        .list(searchParams);
      
      if (availableNumbers.length === 0) {
        await client.query('ROLLBACK');
        throw new Error('No phone numbers available in the requested area');
      }
      
      phoneNumberToPurchase = availableNumbers[0].phoneNumber;
    }
    
    console.log(`📞 Purchasing phone number: ${phoneNumberToPurchase}`);
    
    // Purchase the phone number with automatic webhook configuration
    const baseUrl = process.env.BASE_URL || 'https://nodejs-production-5e30.up.railway.app';
    const purchasedNumber = await twilioClient.incomingPhoneNumbers.create({
      phoneNumber: phoneNumberToPurchase,
      voiceUrl: `${baseUrl}/voice/incoming/${req.business.id}`,
      voiceMethod: 'POST',
      smsUrl: `${baseUrl}/sms/incoming/${req.business.id}`,
      smsMethod: 'POST',
      friendlyName: `${lockedBusiness.name} - BookIt AI`
    });
    
    console.log(`✅ Phone number purchased: ${phoneNumberToPurchase} (${purchasedNumber.sid})`);
    
    // Update business with new phone number and mark onboarding complete
    await client.query(
      'UPDATE businesses SET phone_number = $1, twilio_phone_sid = $2, onboarding_completed = true, updated_at = CURRENT_TIMESTAMP WHERE id = $3',
      [phoneNumberToPurchase, purchasedNumber.sid, req.business.id]
    );
    
    // Commit the transaction BEFORE non-critical operations
    await client.query('COMMIT');
    
    console.log(`✅ ${lockedBusiness.name} onboarding complete with phone ${phoneNumberToPurchase}`);
    
    // Mark request as processed
    if (requestId) {
      processedOnboardingRequests.add(requestId);
      console.log(`✅ Request ${requestId} marked as processed`);
    }
    
    // 🚀 AUTOMATIC WEBHOOK CONFIGURATION: Configure webhook for new business
    console.log(`🔗 Configuring webhook for new business ${req.business.id}`);
    let webhookConfigured = false;
    try {
      const webhookResult = await configureBusinessWebhook(req.business.id, purchasedNumber.sid);
      if (webhookResult.success) {
        console.log(`✅ Webhook configured: ${webhookResult.webhookUrl}`);
        webhookConfigured = true;
      } else {
        console.error(`⚠️ Webhook configuration failed: ${webhookResult.error}`);
      }
    } catch (webhookError) {
      console.error('⚠️ Webhook configuration failed for new business (non-critical):', webhookError);
    }
    
    // 🚀 AUTOMATIC CALENDAR GENERATION: When business onboarding completes, generate calendar slots
    console.log(`📅 Onboarding complete - generating calendar slots for new business ${req.business.id}`);
    let calendarGenerated = false;
    try {
      // Check if business has business_hours set
      const businessHoursResult = await pool.query('SELECT business_hours FROM businesses WHERE id = $1', [req.business.id]);
      if (businessHoursResult.rows.length > 0 && businessHoursResult.rows[0].business_hours) {
        const slotsGenerated = await generateCalendarSlots(req.business.id, 400);
        console.log(`✅ Auto-generated ${slotsGenerated} calendar slots for new business (400+ days for annual appointments)`);
        calendarGenerated = true;
      } else {
        console.log(`⚠️ Business hours not set yet - calendar slots will be generated when hours are configured`);
      }
    } catch (calendarError) {
      console.error('⚠️ Calendar generation failed for new business (non-critical):', calendarError);
      // Don't fail the onboarding if calendar generation fails
    }
    
    res.json({
      success: true,
      message: 'Onboarding completed successfully!',
      phoneNumber: phoneNumberToPurchase,
      twilioSid: purchasedNumber.sid,
      webhookConfigured: webhookConfigured,
      calendarGenerated: calendarGenerated,
      ready: true,
      requestId: requestId
    });
    
  } catch (error) {
    console.error('Auto-provisioning error:', error);
    
    // Rollback transaction on any error
    try {
      await client.query('ROLLBACK');
      console.log('🔄 Transaction rolled back due to error');
    } catch (rollbackError) {
      console.error('❌ Rollback failed:', rollbackError);
    }
    
    res.status(500).json({ 
      error: 'Failed to complete onboarding',
      details: error.message,
      requestId: req.body.requestId
    });
  } finally {
    // Always release the database connection
    client.release();
  }
});

// Periodic cleanup of processed request IDs (run every hour)
setInterval(() => {
  if (processedOnboardingRequests.size > 500) {
    console.log(`🧹 Cleaning up old request IDs (${processedOnboardingRequests.size} total)`);
    const requestIds = Array.from(processedOnboardingRequests);
    const oldIds = requestIds.slice(0, Math.floor(requestIds.length / 2));
    oldIds.forEach(id => processedOnboardingRequests.delete(id));
    console.log(`✅ Cleaned up ${oldIds.length} old request IDs, ${processedOnboardingRequests.size} remaining`);
  }
}, 60 * 60 * 1000); // Every hour