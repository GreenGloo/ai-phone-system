require('dotenv').config();
const jwt = require('jsonwebtoken');

// Test the exact 404 scenario that's happening in the frontend

async function test404Error() {
  try {
    const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-this';
    
    // Generate a test token like the frontend would have
    const token = jwt.sign({ userId: '9de7a54a-376d-41e1-82c8-ccfb777255e7' }, JWT_SECRET); // Benny's user ID
    
    console.log('🧪 Testing settings API with token...');
    console.log('🔑 Generated token:', token.substring(0, 20) + '...');
    
    const businessId = '9e075387-b066-4b70-ac33-6bce880f73df';
    
    // Test 1: GET settings (should work)
    console.log('\n📡 Testing GET /api/businesses/:businessId/settings');
    const getResponse = await fetch(`http://localhost:3000/api/businesses/${businessId}/settings`, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      }
    });
    
    console.log('GET Status:', getResponse.status);
    if (!getResponse.ok) {
      const errorText = await getResponse.text();
      console.log('GET Error:', errorText);
    } else {
      const data = await getResponse.json();
      console.log('GET Success - Business name:', data.business?.name);
    }
    
    // Test 2: PUT settings (might fail)
    console.log('\n📡 Testing PUT /api/businesses/:businessId/settings');
    const testData = {
      name: 'Test Business',
      business_type: 'bookkeeping',
      business_description: 'Test update from Node.js'
    };
    
    const putResponse = await fetch(`http://localhost:3000/api/businesses/${businessId}/settings`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify(testData)
    });
    
    console.log('PUT Status:', putResponse.status);
    if (!putResponse.ok) {
      const errorText = await putResponse.text();
      console.log('PUT Error:', errorText);
    } else {
      const result = await putResponse.json();
      console.log('PUT Success:', result.message);
    }
    
  } catch (error) {
    console.error('❌ Test failed:', error.message);
  }
}

test404Error();