// Temporary script to force Tom's garage to use Matthew voice
// Run this after deployment to ensure database has correct voice setting

const { Pool } = require('pg');

async function forceTomMatthewVoice() {
  if (!process.env.DATABASE_URL) {
    console.log('❌ DATABASE_URL not configured - run this on the server');
    return;
  }

  const pool = new Pool({
    connectionString: process.env.DATABASE_URL
  });

  try {
    console.log('🔍 Searching for Tom\'s garage business...');
    
    // Find ALL businesses and show their voice settings
    const allResult = await pool.query(
      "SELECT id, name, ai_voice_id, ai_personality FROM businesses ORDER BY name"
    );

    console.log('\n📋 All Business Voice Settings:');
    allResult.rows.forEach(business => {
      console.log(`   ${business.name}: Voice=${business.ai_voice_id || 'NULL'}, Personality=${business.ai_personality || 'NULL'}`);
    });

    // Find Tom's garage specifically
    const tomResult = await pool.query(
      "SELECT id, name, ai_voice_id, ai_personality FROM businesses WHERE name ILIKE '%tom%' OR name ILIKE '%garage%'"
    );

    if (tomResult.rows.length === 0) {
      console.log('\n❌ No Tom\'s garage business found');
      return;
    }

    const tom = tomResult.rows[0];
    console.log('\n🏢 Tom\'s Garage Found:');
    console.log(`   ID: ${tom.id}`);
    console.log(`   Name: ${tom.name}`);
    console.log(`   Current Voice: ${tom.ai_voice_id || 'NULL'}`);
    console.log(`   Current Personality: ${tom.ai_personality || 'NULL'}`);

    // Force update to Matthew voice
    console.log('\n🔧 Forcing update to Matthew voice...');
    const updateResult = await pool.query(
      `UPDATE businesses 
       SET ai_voice_id = 'Polly.Matthew-Neural', 
           ai_personality = 'professional',
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $1 
       RETURNING id, name, ai_voice_id, ai_personality`,
      [tom.id]
    );

    if (updateResult.rows.length > 0) {
      const updated = updateResult.rows[0];
      console.log('✅ Successfully updated Tom\'s garage:');
      console.log(`   New Voice: ${updated.ai_voice_id}`);
      console.log(`   New Personality: ${updated.ai_personality}`);
      console.log('\n🎤 Tom\'s garage should now use Matthew voice for all calls!');
    }

  } catch (error) {
    console.error('❌ Error:', error.message);
  } finally {
    await pool.end();
  }
}

// Only run if called directly
if (require.main === module) {
  forceTomMatthewVoice();
}

module.exports = forceTomMatthewVoice;