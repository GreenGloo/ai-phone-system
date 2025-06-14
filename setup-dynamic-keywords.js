// Setup script for dynamic AI-generated service keywords
// Run this once to create the table and generate keywords for existing services

require('dotenv').config();
const { Pool } = require('pg');
const { generateKeywordsForAllServices } = require('./service-keyword-generator');
const fs = require('fs');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function setupDynamicKeywords() {
  console.log('🚀 SETTING UP DYNAMIC AI KEYWORD SYSTEM');
  console.log('='.repeat(50));
  
  try {
    // Step 1: Create the service_keywords table
    console.log('\n📊 Step 1: Creating service_keywords table...');
    const sqlScript = fs.readFileSync('add-service-keywords-table.sql', 'utf8');
    await pool.query(sqlScript);
    console.log('✅ service_keywords table created');
    
    // Step 2: Generate keywords for all existing services
    console.log('\n🧠 Step 2: Generating AI keywords for existing services...');
    const result = await generateKeywordsForAllServices();
    
    console.log('\n' + '='.repeat(50));
    console.log('🎯 DYNAMIC KEYWORD SETUP COMPLETE!');
    console.log(`✅ Successfully processed: ${result.successCount} services`);
    console.log(`❌ Errors: ${result.errorCount} services`);
    
    if (result.successCount > 0) {
      console.log('\n🔥 System Benefits:');
      console.log('   • Zero hardcoded service assumptions');
      console.log('   • AI-generated keywords for each service');
      console.log('   • Keywords auto-deleted when services removed');
      console.log('   • Scales to any business type automatically');
      console.log('   • Better speech recognition handling');
    }
    
    // Step 3: Show sample of generated keywords
    console.log('\n📋 Sample Generated Keywords:');
    const sampleResult = await pool.query(`
      SELECT st.name as service_name, 
             ARRAY_AGG(sk.keyword ORDER BY sk.confidence_score DESC) as keywords
      FROM service_keywords sk
      JOIN service_types st ON sk.service_id = st.id
      GROUP BY st.id, st.name
      LIMIT 3
    `);
    
    sampleResult.rows.forEach(row => {
      console.log(`   "${row.service_name}": ${row.keywords.slice(0, 8).join(', ')}`);
    });
    
  } catch (error) {
    console.error('❌ Setup failed:', error);
    throw error;
  } finally {
    await pool.end();
  }
}

// Run the setup
if (require.main === module) {
  setupDynamicKeywords()
    .then(() => {
      console.log('\n✅ Setup complete! The AI will now use dynamic keywords.');
      process.exit(0);
    })
    .catch(error => {
      console.error('\n❌ Setup failed:', error);
      process.exit(1);
    });
}

module.exports = { setupDynamicKeywords };