// AI-powered service keyword generator
// Automatically creates relevant keywords when services are added

require('dotenv').config();
const { Pool } = require('pg');
const OpenAI = require('openai');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// Claude support for better keyword generation
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const USE_CLAUDE = process.env.USE_CLAUDE === 'true';

async function callClaude(prompt) {
  const axios = require('axios');
  
  const response = await axios.post('https://api.anthropic.com/v1/messages', {
    model: 'claude-3-5-sonnet-20241022',
    max_tokens: 300,
    temperature: 0.3, // Lower temperature for more consistent keyword generation
    messages: [
      {
        role: 'user',
        content: prompt
      }
    ]
  }, {
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01'
    }
  });
  
  return response.data.content[0].text;
}

async function generateServiceKeywords(serviceName, businessType = 'automotive') {
  console.log(`🧠 Generating keywords for service: "${serviceName}" (${businessType})`);
  
  const prompt = `Generate relevant keywords for the service "${serviceName}" in a ${businessType} business.

REQUIREMENTS:
- Include the exact service name words
- Add common synonyms and variations
- Include common misspellings customers might use
- Add related terms customers might say
- Include both formal and casual language
- Consider speech recognition errors (similar sounding words)
- Maximum 15 keywords
- Each keyword should be 1-3 words maximum
- Focus on words customers would actually say when calling

EXAMPLES:
Service: "Oil Change & Filter Replacement"
Keywords: oil, change, lube, fluid, filter, maintenance, service, lubrication, oil service

Service: "Brake Pad Replacement" 
Keywords: brake, brakes, pads, stopping, squeaking, grinding, brake service, brake work

Service: "Tire Rotation"
Keywords: tire, tires, rotation, rotate, rotating, wheel, wheels, tire service

Respond with ONLY a comma-separated list of keywords, no other text:`;

  try {
    let aiResponse;
    
    if (USE_CLAUDE && ANTHROPIC_API_KEY) {
      console.log('🧠 Using Claude for superior keyword generation');
      aiResponse = await callClaude(prompt);
    } else {
      console.log('🤖 Using OpenAI for keyword generation');
      const completion = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [{ role: "user", content: prompt }],
        temperature: 0.3,
        max_tokens: 150
      });
      aiResponse = completion.choices[0].message.content;
    }
    
    // Parse keywords from AI response
    const keywords = aiResponse
      .toLowerCase()
      .split(',')
      .map(k => k.trim())
      .filter(k => k.length > 0 && k.length <= 50) // Reasonable length limits
      .slice(0, 15); // Maximum 15 keywords
    
    console.log(`✅ Generated ${keywords.length} keywords:`, keywords);
    return keywords;
    
  } catch (error) {
    console.error('❌ Error generating keywords:', error);
    
    // Fallback: extract basic keywords from service name
    const fallbackKeywords = serviceName
      .toLowerCase()
      .replace(/[^\w\s]/g, '')
      .split(/\s+/)
      .filter(word => word.length > 2);
    
    console.log('🔄 Using fallback keywords:', fallbackKeywords);
    return fallbackKeywords;
  }
}

async function saveServiceKeywords(serviceId, businessId, keywords) {
  console.log(`💾 Saving ${keywords.length} keywords for service ${serviceId}`);
  
  try {
    // First, delete existing keywords for this service
    await pool.query('DELETE FROM service_keywords WHERE service_id = $1', [serviceId]);
    
    // Insert new keywords
    for (const keyword of keywords) {
      await pool.query(`
        INSERT INTO service_keywords (service_id, business_id, keyword, confidence_score)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT (service_id, keyword) DO NOTHING
      `, [serviceId, businessId, keyword, 1.0]);
    }
    
    console.log(`✅ Saved keywords for service ${serviceId}`);
    return true;
    
  } catch (error) {
    console.error('❌ Error saving keywords:', error);
    return false;
  }
}

async function generateKeywordsForService(serviceId) {
  try {
    // Get service details
    const serviceResult = await pool.query(`
      SELECT st.id, st.name, st.business_id, b.name as business_name, b.business_type
      FROM service_types st
      JOIN businesses b ON st.business_id = b.id
      WHERE st.id = $1
    `, [serviceId]);
    
    if (serviceResult.rows.length === 0) {
      throw new Error(`Service ${serviceId} not found`);
    }
    
    const service = serviceResult.rows[0];
    const businessType = service.business_type || 'automotive'; // Default to automotive
    
    console.log(`🔧 Processing service: "${service.name}" for business: "${service.business_name}"`);
    
    // Generate keywords using AI
    const keywords = await generateServiceKeywords(service.name, businessType);
    
    // Save to database
    const success = await saveServiceKeywords(service.id, service.business_id, keywords);
    
    return { success, keywords, serviceName: service.name };
    
  } catch (error) {
    console.error('❌ Error processing service:', error);
    return { success: false, error: error.message };
  }
}

async function generateKeywordsForAllServices(businessId = null) {
  console.log('🚀 GENERATING AI KEYWORDS FOR ALL SERVICES');
  console.log('='.repeat(50));
  
  try {
    // Get all active services, optionally filtered by business
    let query = 'SELECT id, name, business_id FROM service_types WHERE is_active = true';
    let params = [];
    
    if (businessId) {
      query += ' AND business_id = $1';
      params = [businessId];
    }
    
    query += ' ORDER BY business_id, name';
    
    const servicesResult = await pool.query(query, params);
    const services = servicesResult.rows;
    
    console.log(`📋 Found ${services.length} services to process`);
    
    let successCount = 0;
    let errorCount = 0;
    
    for (const service of services) {
      console.log(`\n🔄 Processing: ${service.name}`);
      const result = await generateKeywordsForService(service.id);
      
      if (result.success) {
        successCount++;
        console.log(`✅ Generated keywords for: ${result.serviceName}`);
      } else {
        errorCount++;
        console.log(`❌ Failed to generate keywords for: ${service.name}`);
      }
      
      // Small delay to avoid rate limiting
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    
    console.log('\n' + '='.repeat(50));
    console.log('🎯 KEYWORD GENERATION COMPLETE');
    console.log(`✅ Success: ${successCount} services`);
    console.log(`❌ Errors: ${errorCount} services`);
    
    return { successCount, errorCount };
    
  } catch (error) {
    console.error('❌ Fatal error in keyword generation:', error);
    throw error;
  }
}

module.exports = {
  generateServiceKeywords,
  saveServiceKeywords,
  generateKeywordsForService,
  generateKeywordsForAllServices
};