// Run this script to immediately update all business voices to Matthew
const { Pool } = require('pg');

async function updateAllVoicesToMatthew() {
  if (!process.env.DATABASE_URL) {
    console.log('❌ DATABASE_URL not configured');
    return;
  }

  const pool = new Pool({
    connectionString: process.env.DATABASE_URL
  });

  try {
    console.log('🔄 Updating all business voices to Matthew...');
    
    // First, show current state
    const beforeResult = await pool.query(
      "SELECT id, name, ai_voice_id, ai_personality FROM businesses ORDER BY name"
    );
    
    console.log('\n📋 BEFORE - Current Voice Settings:');
    beforeResult.rows.forEach(business => {
      console.log(`   ${business.name}: Voice=${business.ai_voice_id || 'NULL'}, Personality=${business.ai_personality || 'NULL'}`);
    });

    // Update voices
    const voiceUpdateResult = await pool.query(`
      UPDATE businesses 
      SET ai_voice_id = 'Polly.Matthew-Neural',
          updated_at = CURRENT_TIMESTAMP
      WHERE ai_voice_id = 'Polly.Joanna-Neural' 
         OR ai_voice_id IS NULL
      RETURNING id, name, ai_voice_id
    `);

    console.log(`\n✅ Updated ${voiceUpdateResult.rows.length} businesses to Matthew voice`);

    // Update personalities  
    const personalityUpdateResult = await pool.query(`
      UPDATE businesses 
      SET ai_personality = 'professional',
          updated_at = CURRENT_TIMESTAMP  
      WHERE ai_personality IS NULL
      RETURNING id, name, ai_personality
    `);

    console.log(`✅ Updated ${personalityUpdateResult.rows.length} businesses to professional personality`);

    // Show final state
    const afterResult = await pool.query(
      "SELECT id, name, ai_voice_id, ai_personality FROM businesses ORDER BY name"
    );
    
    console.log('\n📋 AFTER - Updated Voice Settings:');
    afterResult.rows.forEach(business => {
      console.log(`   ${business.name}: Voice=${business.ai_voice_id}, Personality=${business.ai_personality}`);
    });

    console.log('\n🎤 All businesses should now use Matthew voice!');

  } catch (error) {
    console.error('❌ Error:', error.message);
  } finally {
    await pool.end();
  }
}

updateAllVoicesToMatthew();