require('dotenv').config();
const { Pool } = require('pg');

// Test the exact service matching logic
function intelligentServiceMatching(services, requestedService) {
  console.log(`🔍 Testing service matching for: "${requestedService}"`);
  console.log(`📋 Available services: ${services.map(s => s.name).join(', ')}`);
  
  if (!requestedService || services.length === 0) {
    console.log('❌ No service requested or no services available');
    return services[0];
  }
  
  const requested = requestedService.toLowerCase();
  console.log(`🔍 Normalized request: "${requested}"`);
  
  // Exact match first
  let match = services.find(s => s.name.toLowerCase() === requested);
  if (match) {
    console.log(`✅ EXACT MATCH: ${match.name}`);
    return match;
  }
  console.log('❌ No exact match found');
  
  // Partial match
  match = services.find(s => 
    s.name.toLowerCase().includes(requested) || 
    requested.includes(s.name.toLowerCase())
  );
  if (match) {
    console.log(`✅ PARTIAL MATCH: ${match.name}`);
    return match;
  }
  console.log('❌ No partial match found');
  
  // Keyword matching for automotive terms
  const serviceKeywords = {
    'oil': ['oil', 'lube', 'fluid'],
    'brake': ['brake', 'brakes', 'stopping'],
    'battery': ['battery', 'dead', 'jump', 'start'],
    'diagnostics': ['diagnostic', 'check', 'scan', 'code'],
    'alignment': ['alignment', 'straight', 'pull'],
    'transmission': ['transmission', 'shift', 'gear'],
    'air conditioning': ['ac', 'air conditioning', 'cooling', 'heat'],
    'towing': ['tow', 'towing', 'haul', 'emergency'],
    'inspection': ['inspection', 'test', 'safety'],
    'maintenance': ['maintenance', 'service', 'tune']
  };
  
  console.log('🔍 Checking keyword matching...');
  for (const [category, keywords] of Object.entries(serviceKeywords)) {
    console.log(`  Checking category "${category}" with keywords: ${keywords.join(', ')}`);
    if (keywords.some(keyword => requested.includes(keyword))) {
      console.log(`  ✅ Found keyword match in category: ${category}`);
      match = services.find(s => s.name.toLowerCase().includes(category));
      if (match) {
        console.log(`✅ KEYWORD MATCH: ${match.name}`);
        return match;
      } else {
        console.log(`  ❌ No service found for category: ${category}`);
      }
    }
  }
  
  console.log(`⚠️ FALLBACK: Using first service: ${services[0].name}`);
  return services[0];
}

async function testServiceMatching() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  
  try {
    // Get first business for testing
    const firstBusiness = await pool.query('SELECT id FROM businesses WHERE status = $1 LIMIT 1', ['active']);
    if (firstBusiness.rows.length === 0) {
      throw new Error('No active businesses found for testing');
    }
    const businessId = firstBusiness.rows[0].id;
    
    // Get actual services
    const services = await pool.query(
      'SELECT id, name FROM service_types WHERE business_id = $1 AND is_active = true ORDER BY name',
      [businessId]
    );
    
    console.log('🧪 TESTING SERVICE MATCHING');
    console.log('='.repeat(50));
    
    // Test cases
    const testCases = ['oil change', 'brake', 'battery', 'towing', 'diagnostic'];
    
    testCases.forEach(testCase => {
      console.log(`\n🧪 TEST: "${testCase}"`);
      const result = intelligentServiceMatching(services.rows, testCase);
      console.log(`🎯 RESULT: ${result.name} (ID: ${result.id})`);
    });
    
  } catch (error) {
    console.error('❌ Error:', error.message);
  } finally {
    await pool.end();
  }
}

testServiceMatching();