#!/usr/bin/env node

// Integration test to verify AI phone system works end-to-end
require('dotenv').config();

const baseUrl = process.env.BASE_URL || 'https://nodejs-production-5e30.up.railway.app';

async function testIntegration() {
  console.log('🧪 Testing AI Phone System Integration...\n');
  
  // 1. Test login
  console.log('1️⃣ Testing login...');
  const loginResponse = await fetch(`${baseUrl}/api/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'test5@email.com', password: 'password' })
  });
  
  if (!loginResponse.ok) {
    console.log('❌ Login failed');
    return;
  }
  
  const loginData = await loginResponse.json();
  console.log('✅ Login successful');
  console.log(`Business: ${loginData.businesses[0].name} (${loginData.businesses[0].id})`);
  
  const token = loginData.token;
  const businessId = loginData.businesses[0].id;
  
  // 2. Test business data loading
  console.log('\n2️⃣ Testing business data...');
  const businessResponse = await fetch(`${baseUrl}/api/businesses`, {
    headers: { 'Authorization': `Bearer ${token}` }
  });
  
  if (businessResponse.ok) {
    const businesses = await businessResponse.json();
    console.log(`✅ Business API works - ${businesses.length} businesses found`);
  } else {
    console.log('❌ Business API failed');
  }
  
  // 3. Test appointments loading
  console.log('\n3️⃣ Testing appointments...');
  const aptsResponse = await fetch(`${baseUrl}/api/businesses/${businessId}/appointments`, {
    headers: { 'Authorization': `Bearer ${token}` }
  });
  
  if (aptsResponse.ok) {
    const appointments = await aptsResponse.json();
    console.log(`✅ Appointments API works - ${appointments.length} appointments found`);
    
    // Show recent AI appointments
    const aiApts = appointments.filter(apt => apt.booking_source === 'conversational_ai');
    console.log(`🤖 AI Appointments: ${aiApts.length}`);
    
    if (aiApts.length > 0) {
      console.log('Recent AI bookings:');
      aiApts.slice(0, 3).forEach(apt => {
        console.log(`  - ${apt.service_name} for ${apt.customer_phone}`);
      });
    }
  } else {
    console.log('❌ Appointments API failed');
  }
  
  // 4. Test AI voice endpoint
  console.log('\n4️⃣ Testing AI voice system...');
  const voiceResponse = await fetch(`${baseUrl}/voice/incoming/${businessId}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'CallSid=test123&From=+15551234567&SpeechResult=I need an oil change'
  });
  
  if (voiceResponse.ok) {
    const voiceXml = await voiceResponse.text();
    if (voiceXml.includes('<Say>')) {
      console.log('✅ AI voice system responding');
    } else {
      console.log('❌ AI voice system not responding properly');
    }
  } else {
    console.log('❌ AI voice system failed');
  }
  
  console.log('\n🏁 Integration test complete!');
}

testIntegration().catch(console.error);