require('dotenv').config();
const { Pool } = require('pg');

async function checkTomGarageServices() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const businessId = '8fea02b5-850a-4167-913b-a12043c65d17';
  
  try {
    console.log('🔍 Checking services for Tom\'s Garage...\n');
    
    // 1. First verify the business exists
    console.log('1. Verifying Tom\'s Garage business record:');
    const businessResult = await pool.query(
      'SELECT id, name, phone_number FROM businesses WHERE id = $1', 
      [businessId]
    );
    
    if (businessResult.rows.length === 0) {
      console.log('❌ No business found with ID:', businessId);
      return;
    }
    
    const business = businessResult.rows[0];
    console.log(`✅ Found business: ${business.name} (${business.id})`);
    console.log(`   Phone: ${business.phone_number}\n`);
    
    // 2. Get all services for this business
    console.log('2. All services for Tom\'s Garage:');
    const servicesResult = await pool.query(
      'SELECT id, name, description, duration_minutes, base_rate, is_active, created_at FROM service_types WHERE business_id = $1 ORDER BY created_at',
      [businessId]
    );
    
    if (servicesResult.rows.length === 0) {
      console.log('❌ No services found for this business!');
      console.log('   This could be why the AI booking is failing.');
      return;
    }
    
    console.log(`📋 Found ${servicesResult.rows.length} services:`);
    servicesResult.rows.forEach((service, index) => {
      console.log(`${index + 1}. "${service.name}" (ID: ${service.id})`);
      console.log(`   Description: ${service.description || 'No description'}`);
      console.log(`   Duration: ${service.duration_minutes} minutes`);
      console.log(`   Base Rate: $${service.base_rate}`);
      console.log(`   Active: ${service.is_active ? '✅' : '❌'}`);
      console.log(`   Created: ${service.created_at}\n`);
    });
    
    // 3. Check specifically for wheel alignment service
    console.log('3. Checking for "wheel alignment" service:');
    const wheelAlignmentServices = servicesResult.rows.filter(service => 
      service.name.toLowerCase().includes('wheel') || 
      service.name.toLowerCase().includes('alignment') ||
      service.description?.toLowerCase().includes('wheel') ||
      service.description?.toLowerCase().includes('alignment')
    );
    
    if (wheelAlignmentServices.length === 0) {
      console.log('❌ No "wheel alignment" service found!');
      console.log('   This is likely why the AI booking failed.');
      console.log('   The customer requested "wheel alignment" but this service doesn\'t exist.');
    } else {
      console.log('✅ Found wheel alignment related services:');
      wheelAlignmentServices.forEach(service => {
        console.log(`   - "${service.name}" (Active: ${service.is_active ? 'Yes' : 'No'})`);
      });
    }
    
    // 4. Check service keywords for wheel alignment
    console.log('\n4. Checking service keywords for wheel alignment matches:');
    const keywordsResult = await pool.query(`
      SELECT sk.service_id, sk.keyword, sk.confidence_score, st.name as service_name
      FROM service_keywords sk
      JOIN service_types st ON sk.service_id = st.id
      WHERE sk.business_id = $1 
      AND (sk.keyword ILIKE '%wheel%' OR sk.keyword ILIKE '%alignment%')
      ORDER BY sk.confidence_score DESC
    `, [businessId]);
    
    if (keywordsResult.rows.length === 0) {
      console.log('❌ No service keywords found for "wheel" or "alignment"');
      console.log('   The AI service matching system won\'t be able to match customer requests for wheel alignment.');
    } else {
      console.log(`✅ Found ${keywordsResult.rows.length} relevant keywords:`);
      keywordsResult.rows.forEach(keyword => {
        console.log(`   - "${keyword.keyword}" → ${keyword.service_name} (confidence: ${keyword.confidence_score})`);
      });
    }
    
    // 5. Show all keywords for context
    console.log('\n5. All service keywords for this business:');
    const allKeywordsResult = await pool.query(`
      SELECT sk.keyword, st.name as service_name, sk.confidence_score
      FROM service_keywords sk
      JOIN service_types st ON sk.service_id = st.id
      WHERE sk.business_id = $1
      ORDER BY st.name, sk.confidence_score DESC
    `, [businessId]);
    
    if (allKeywordsResult.rows.length === 0) {
      console.log('❌ No service keywords found at all!');
      console.log('   The AI won\'t be able to match any customer service requests.');
    } else {
      console.log(`📝 Found ${allKeywordsResult.rows.length} total keywords:`);
      const keywordsByService = {};
      allKeywordsResult.rows.forEach(row => {
        if (!keywordsByService[row.service_name]) {
          keywordsByService[row.service_name] = [];
        }
        keywordsByService[row.service_name].push(`${row.keyword} (${row.confidence_score})`);
      });
      
      Object.entries(keywordsByService).forEach(([serviceName, keywords]) => {
        console.log(`   ${serviceName}:`);
        keywords.forEach(keyword => {
          console.log(`     - ${keyword}`);
        });
      });
    }
    
    // 6. Recommendations
    console.log('\n6. 🔧 RECOMMENDATIONS:');
    if (servicesResult.rows.length === 0) {
      console.log('   ❗ CRITICAL: No services configured for this business');
      console.log('   → Add services using the admin dashboard');
    } else if (wheelAlignmentServices.length === 0) {
      console.log('   ❗ ISSUE: No "wheel alignment" service found');
      console.log('   → Add a "Wheel Alignment" service to the business');
      console.log('   → Or update an existing service name to include "alignment"');
    }
    
    if (keywordsResult.rows.length === 0) {
      console.log('   ❗ ISSUE: No service keywords for wheel alignment');
      console.log('   → Run the service keyword generator to create AI matching keywords');
      console.log('   → Or manually add keywords like "wheel alignment", "alignment", "tire alignment"');
    }
    
  } catch (error) {
    console.error('❌ Database query error:', error);
  } finally {
    await pool.end();
  }
}

checkTomGarageServices();