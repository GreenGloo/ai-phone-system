const fetch = require('node-fetch');
const fs = require('fs');
const path = require('path');

// ElevenLabs voice configurations
const ELEVENLABS_VOICES = {
  // Male voices
  'matthew': 'pNInz6obpgDQGcFmaJgB', // Adam (male, US)
  'daniel': 'CwhRBWXzGAHq8TQ4Fs17', // Daniel (male, UK) 
  'sam': '2EiwWnXFnvU5JabPnv8n',    // Sam (male, US)
  
  // Female voices  
  'sarah': 'EXAVITQu4vr4xnSDxMaL',   // Sarah (female, US)
  'grace': 'oWAxZDx7w5VEj9dCyTzz',   // Grace (female, US)
  'bella': 'EXAVITQu4vr4xnSDxMaL',   // Bella (female, US)
};

// Map business voice selections to ElevenLabs voices
const VOICE_MAPPING = {
  // Current settings dropdown options
  'Polly.Matthew': 'matthew',     // Matthew (Male, US) → Adam
  'Polly.Joanna': 'sarah',        // Joanna (Female, US) → Sarah
  'Polly.Amy': 'grace',           // Amy (Female, UK) → Grace
  'Polly.Brian': 'daniel',        // Brian (Male, UK) → Daniel
  
  // Additional voice options
  'Polly.Daniel': 'daniel', 
  'Polly.Sam': 'sam',
  'Polly.Sarah': 'sarah',
  'Polly.Grace': 'grace',
  'Polly.Bella': 'bella',
  
  // Fallbacks for old format
  'Polly.Matthew-Neural': 'matthew',
  'Polly.Joanna-Neural': 'sarah',
  'Polly.Amy-Neural': 'grace',
  'Polly.Brian-Neural': 'daniel',
  'man': 'matthew',
  'male': 'matthew',
  'alice': 'sarah',
};

async function generateElevenLabsAudio(text, voiceId, options = {}) {
  if (!process.env.ELEVENLABS_API_KEY) {
    throw new Error('ElevenLabs API key not configured');
  }

  const elevenLabsVoiceId = VOICE_MAPPING[voiceId] || 'matthew';
  const actualVoiceId = ELEVENLABS_VOICES[elevenLabsVoiceId] || ELEVENLABS_VOICES.matthew;

  console.log(`🎤 ElevenLabs: Converting "${voiceId}" → "${elevenLabsVoiceId}" → "${actualVoiceId}"`);

  const url = `https://api.elevenlabs.io/v1/text-to-speech/${actualVoiceId}`;
  
  const requestBody = {
    text: text,
    model_id: "eleven_monolingual_v1",
    voice_settings: {
      stability: options.stability || 0.5,
      similarity_boost: options.similarity_boost || 0.5,
      style: options.style || 0.0,
      use_speaker_boost: options.use_speaker_boost || true
    }
  };

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Accept': 'audio/mpeg',
        'Content-Type': 'application/json',
        'xi-api-key': process.env.ELEVENLABS_API_KEY
      },
      body: JSON.stringify(requestBody)
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`ElevenLabs API error: ${response.status} - ${errorText}`);
    }

    // Get audio data
    const audioBuffer = await response.buffer();
    
    // Save to temporary file
    const timestamp = Date.now();
    const filename = `audio_${timestamp}.mp3`;
    const filepath = path.join(__dirname, 'temp', filename);
    
    // Ensure temp directory exists
    const tempDir = path.join(__dirname, 'temp');
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }

    fs.writeFileSync(filepath, audioBuffer);
    
    console.log(`🎵 Generated ElevenLabs audio: ${filename} (${audioBuffer.length} bytes)`);
    
    return {
      success: true,
      filepath: filepath,
      filename: filename,
      url: `/temp/${filename}`, // URL to serve the file
      duration: Math.ceil(text.length / 10) // Rough estimate
    };

  } catch (error) {
    console.error('❌ ElevenLabs generation failed:', error.message);
    return {
      success: false,
      error: error.message
    };
  }
}

// Cleanup old audio files (call periodically)
function cleanupOldAudioFiles() {
  const tempDir = path.join(__dirname, 'temp');
  if (!fs.existsSync(tempDir)) return;

  const files = fs.readdirSync(tempDir);
  const cutoffTime = Date.now() - (60 * 60 * 1000); // 1 hour ago

  files.forEach(file => {
    if (file.startsWith('audio_') && file.endsWith('.mp3')) {
      const filepath = path.join(tempDir, file);
      const stats = fs.statSync(filepath);
      
      if (stats.mtimeMs < cutoffTime) {
        fs.unlinkSync(filepath);
        console.log(`🗑️ Cleaned up old audio file: ${file}`);
      }
    }
  });
}

module.exports = {
  generateElevenLabsAudio,
  cleanupOldAudioFiles,
  ELEVENLABS_VOICES,
  VOICE_MAPPING
};