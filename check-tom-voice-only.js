// Simple script to check Tom's garage voice setting
const { Pool } = require('pg');

async function checkTomVoice() {
  if (!process.env.DATABASE_URL) {
    console.log('❌ DATABASE_URL not configured - this needs to run on the server');
    process.exit(1);
  }

  const pool = new Pool({
    connectionString: process.env.DATABASE_URL
  });

  try {
    const result = await pool.query(
      "SELECT id, name, ai_voice_id, ai_personality FROM businesses WHERE name ILIKE '%tom%' OR name ILIKE '%garage%'"
    );

    if (result.rows.length === 0) {
      console.log('❌ No Tom\'s garage found');
    } else {
      const tom = result.rows[0];
      console.log('🏢 Tom\'s Garage Voice Setting:');
      console.log(`   Name: ${tom.name}`);
      console.log(`   Voice ID: ${tom.ai_voice_id}`);
      console.log(`   Personality: ${tom.ai_personality}`);
      
      if (tom.ai_voice_id === 'Polly.Matthew-Neural') {
        console.log('✅ Tom\'s garage IS configured for Matthew voice');
      } else {
        console.log('❌ Tom\'s garage is NOT configured for Matthew voice');
        console.log('   This explains why Alice/Joanna voice is being used');
      }
    }

  } catch (error) {
    console.error('❌ Database Error:', error.message);
  } finally {
    await pool.end();
  }
}

checkTomVoice();