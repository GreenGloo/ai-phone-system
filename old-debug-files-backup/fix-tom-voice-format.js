// Fix Tom's garage voice format from old -Neural to new format
const { Pool } = require('pg');

async function fixTomVoiceFormat() {
  if (!process.env.DATABASE_URL) {
    console.log('❌ DATABASE_URL not configured - run this on the server');
    return;
  }

  const pool = new Pool({
    connectionString: process.env.DATABASE_URL
  });

  try {
    // Find Tom's garage
    const result = await pool.query(
      "SELECT id, name, ai_voice_id, ai_personality FROM businesses WHERE name ILIKE '%tom%' OR name ILIKE '%garage%'"
    );

    if (result.rows.length === 0) {
      console.log('❌ No Tom\'s garage found');
      return;
    }

    const tom = result.rows[0];
    console.log('🏢 Tom\'s Garage BEFORE:');
    console.log(`   Name: ${tom.name}`);
    console.log(`   Voice ID: ${tom.ai_voice_id}`);
    console.log(`   Personality: ${tom.ai_personality}`);

    // Fix the voice format if it has -Neural
    let needsUpdate = false;
    let newVoiceId = tom.ai_voice_id;

    if (tom.ai_voice_id === 'Polly.Matthew-Neural') {
      newVoiceId = 'Polly.Matthew';
      needsUpdate = true;
      console.log('\n🔧 Converting Polly.Matthew-Neural → Polly.Matthew');
    } else if (tom.ai_voice_id === 'Polly.Joanna-Neural') {
      newVoiceId = 'Polly.Joanna';
      needsUpdate = true;
      console.log('\n🔧 Converting Polly.Joanna-Neural → Polly.Joanna');
    } else if (tom.ai_voice_id === 'Polly.Amy-Neural') {
      newVoiceId = 'Polly.Amy';
      needsUpdate = true;
      console.log('\n🔧 Converting Polly.Amy-Neural → Polly.Amy');
    } else if (tom.ai_voice_id === 'Polly.Brian-Neural') {
      newVoiceId = 'Polly.Brian';
      needsUpdate = true;
      console.log('\n🔧 Converting Polly.Brian-Neural → Polly.Brian');
    }

    if (needsUpdate) {
      const updateResult = await pool.query(
        "UPDATE businesses SET ai_voice_id = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2 RETURNING *",
        [newVoiceId, tom.id]
      );

      if (updateResult.rows.length > 0) {
        const updated = updateResult.rows[0];
        console.log('\n✅ Tom\'s Garage AFTER:');
        console.log(`   Voice ID: ${updated.ai_voice_id}`);
        console.log(`   Personality: ${updated.ai_personality}`);
        console.log('\n🎤 Voice format updated! Test a call now.');
      }
    } else {
      console.log('\n✅ Tom\'s garage voice format is already correct');
      console.log(`   Current voice: ${tom.ai_voice_id}`);
    }

  } catch (error) {
    console.error('❌ Error:', error.message);
  } finally {
    await pool.end();
  }
}

fixTomVoiceFormat();