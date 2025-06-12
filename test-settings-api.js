require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function testSettingsDirectly() {
  try {
    console.log('🧪 Testing settings database queries...');
    
    const businessId = '9e075387-b066-4b70-ac33-6bce880f73df';
    
    // Test the query that the settings API uses
    const businessResult = await pool.query(
      `SELECT b.*, u.phone as owner_phone, u.email as owner_email, u.first_name, u.last_name
       FROM businesses b 
       JOIN users u ON b.user_id = u.id 
       WHERE b.id = $1`,
      [businessId]
    );
    
    if (businessResult.rows.length === 0) {
      console.log('❌ Business not found');
      return;
    }
    
    const business = businessResult.rows[0];
    console.log('✅ Business found:', business.name);
    console.log('✅ Business type:', business.business_type);
    console.log('✅ Phone number:', business.phone_number);
    console.log('✅ Owner name:', business.first_name, business.last_name);
    console.log('✅ Owner phone:', business.owner_phone);
    console.log('✅ Owner email:', business.owner_email);
    console.log('✅ Website:', business.website || 'Not set');
    
    // Test business hours
    console.log('\\n📅 Business Hours:');
    if (business.business_hours) {
      Object.keys(business.business_hours).forEach(day => {
        const hours = business.business_hours[day];
        console.log(`   ${day}: ${hours.enabled ? hours.start + ' - ' + hours.end : 'Closed'}`);
      });
    } else {
      console.log('   No business hours set');
    }
    
    // Test updating business settings
    console.log('\\n🔧 Testing settings update...');
    const updateResult = await pool.query(
      `UPDATE businesses SET 
        name = $1,
        business_description = $2,
        website = $3,
        updated_at = CURRENT_TIMESTAMP
       WHERE id = $4
       RETURNING name, business_description, website`,
      [
        business.name, // Keep same name
        'Test description from API', // New description
        'https://test-website.com', // New website
        businessId
      ]
    );
    
    if (updateResult.rows.length > 0) {
      console.log('✅ Settings update successful:');
      console.log('   Name:', updateResult.rows[0].name);
      console.log('   Description:', updateResult.rows[0].business_description);
      console.log('   Website:', updateResult.rows[0].website);
    } else {
      console.log('❌ Settings update failed');
    }
    
  } catch (error) {
    console.error('❌ Test failed:', error.message);
    console.error('Stack:', error.stack);
  } finally {
    process.exit(0);
  }
}

testSettingsDirectly();