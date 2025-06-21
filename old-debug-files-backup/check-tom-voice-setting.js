const { Pool } = require('pg');

async function checkTomVoiceSetting() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL
  });

  try {
    // Find Tom's garage business
    const result = await pool.query(
      "SELECT id, name, ai_voice_id, ai_personality FROM businesses WHERE name ILIKE '%tom%' OR name ILIKE '%garage%'"
    );

    if (result.rows.length === 0) {
      console.log('❌ No Tom\'s garage business found');
      return;
    }

    const business = result.rows[0];
    console.log('🏢 Tom\'s Garage Current Settings:');
    console.log(`   Business ID: ${business.id}`);
    console.log(`   Name: ${business.name}`);
    console.log(`   Voice ID: ${business.ai_voice_id || 'NULL/UNDEFINED'}`);
    console.log(`   Personality: ${business.ai_personality || 'NULL/UNDEFINED'}`);

    // If voice is not Matthew, update it
    if (business.ai_voice_id !== 'Polly.Matthew-Neural') {
      console.log('\n🔧 Updating Tom\'s garage to use Matthew voice...');
      
      const updateResult = await pool.query(
        "UPDATE businesses SET ai_voice_id = 'Polly.Matthew-Neural', ai_personality = 'professional' WHERE id = $1 RETURNING *",
        [business.id]
      );

      if (updateResult.rows.length > 0) {
        console.log('✅ Successfully updated Tom\'s garage voice settings:');
        console.log(`   New Voice ID: ${updateResult.rows[0].ai_voice_id}`);
        console.log(`   New Personality: ${updateResult.rows[0].ai_personality}`);
      }
    } else {
      console.log('✅ Tom\'s garage already has Matthew voice configured');
    }

  } catch (error) {
    console.error('❌ Error:', error.message);
  } finally {
    await pool.end();
  }
}

checkTomVoiceSetting();