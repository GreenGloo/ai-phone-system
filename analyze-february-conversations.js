require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
});

async function analyzeFebruaryConversations() {
  try {
    const businessId = '8fea02b5-850a-4167-913b-a12043c65d17';
    
    console.log('=== DETAILED FEBRUARY CONVERSATION ANALYSIS ===\n');
    
    // Get the specific February conversations
    const conversationsQuery = `
      SELECT 
        call_sid,
        business_id,
        created_at,
        conversation_data,
        updated_at
      FROM conversations 
      WHERE business_id = $1 
      ORDER BY created_at DESC 
      LIMIT 20
    `;
    
    const conversationsResult = await pool.query(conversationsQuery, [businessId]);
    
    // Find February conversations and analyze them in detail
    for (const conv of conversationsResult.rows) {
      const data = conv.conversation_data;
      const dataString = JSON.stringify(data).toLowerCase();
      
      if (dataString.includes('february') || dataString.includes('feb') || dataString.includes('11')) {
        console.log(`=== ANALYZING CONVERSATION ${conv.call_sid} ===`);
        console.log(`Date: ${conv.created_at}`);
        console.log(`Updated: ${conv.updated_at}\n`);
        
        // Print full conversation data in a readable format
        if (data && data.messages) {
          console.log('CONVERSATION TRANSCRIPT:');
          console.log('-'.repeat(60));
          
          data.messages.forEach((msg, index) => {
            console.log(`\n${index + 1}. ${msg.role.toUpperCase()}:`);
            console.log(`   ${msg.content}`);
          });
          
          console.log('\n' + '-'.repeat(60));
          
          // Look for specific error patterns
          console.log('\nERROR ANALYSIS:');
          const fullConvText = JSON.stringify(data).toLowerCase();
          
          if (fullConvText.includes('error')) {
            console.log('❌ Contains "error" keyword');
            const errorMatches = fullConvText.match(/error[^"]*"/g);
            if (errorMatches) {
              errorMatches.forEach(match => console.log(`   Error: ${match}`));
            }
          }
          
          if (fullConvText.includes('failed')) {
            console.log('❌ Contains "failed" keyword');
          }
          
          if (fullConvText.includes('not available') || fullConvText.includes('no slots')) {
            console.log('❌ Availability issue detected');
          }
          
          if (fullConvText.includes('february 11') || fullConvText.includes('feb 11')) {
            console.log('📅 February 11th specifically mentioned');
          }
          
          if (fullConvText.includes('book') || fullConvText.includes('appointment') || fullConvText.includes('schedule')) {
            console.log('📋 Booking attempt confirmed');
          }
          
          // Check for date parsing issues
          if (fullConvText.includes('parse') || fullConvText.includes('format')) {
            console.log('🔍 Date parsing issues detected');
          }
          
          // Check for database/system errors
          if (fullConvText.includes('database') || fullConvText.includes('system')) {
            console.log('💾 System/database error detected');
          }
          
          // Look for slot selection issues
          if (fullConvText.includes('slot') || fullConvText.includes('time')) {
            console.log('⏰ Time slot related content found');
          }
        }
        
        // Check if this conversation has any linked appointments
        const appointmentQuery = `
          SELECT id, customer_name, customer_phone, status, booking_failure_reason, start_time
          FROM appointments 
          WHERE call_sid = $1
        `;
        
        const appointmentResult = await pool.query(appointmentQuery, [conv.call_sid]);
        
        if (appointmentResult.rows.length > 0) {
          console.log('\nLINKED APPOINTMENTS:');
          appointmentResult.rows.forEach(apt => {
            console.log(`  Customer: ${apt.customer_name} (${apt.customer_phone})`);
            console.log(`  Status: ${apt.status}`);
            console.log(`  Start Time: ${apt.start_time}`);
            if (apt.booking_failure_reason) {
              console.log(`  Failure Reason: ${apt.booking_failure_reason}`);
            }
          });
        } else {
          console.log('\nNo linked appointments found for this conversation');
        }
        
        console.log('\n' + '='.repeat(80) + '\n');
      }
    }
    
  } catch (error) {
    console.error('Analysis failed:', error);
  } finally {
    await pool.end();
  }
}

analyzeFebruaryConversations();