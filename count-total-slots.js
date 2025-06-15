require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
});

async function countTotalSlots() {
  try {
    const businessId = '8fea02b5-850a-4167-913b-a12043c65d17';
    
    console.log('=== COUNTING TOTAL SLOTS ANALYSIS ===\n');
    
    // Count total slots
    const totalQuery = `
      SELECT COUNT(*) as total_count
      FROM calendar_slots
      WHERE business_id = $1
      AND is_available = true
      AND is_blocked = false
      AND slot_start >= NOW()
    `;
    
    const totalResult = await pool.query(totalQuery, [businessId]);
    console.log(`Total available slots: ${totalResult.rows[0].total_count}`);
    
    // Count slots by month
    const monthlyQuery = `
      SELECT 
        DATE_TRUNC('month', slot_start) as month,
        COUNT(*) as slot_count
      FROM calendar_slots
      WHERE business_id = $1
      AND is_available = true
      AND is_blocked = false
      AND slot_start >= NOW()
      GROUP BY DATE_TRUNC('month', slot_start)
      ORDER BY month
    `;
    
    const monthlyResult = await pool.query(monthlyQuery, [businessId]);
    console.log('\nSlots by month:');
    monthlyResult.rows.forEach(row => {
      const month = new Date(row.month).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
      console.log(`  ${month}: ${row.slot_count} slots`);
    });
    
    // Check specifically for February 2026
    const feb2026Query = `
      SELECT COUNT(*) as feb_count
      FROM calendar_slots
      WHERE business_id = $1
      AND is_available = true
      AND is_blocked = false
      AND slot_start >= '2026-02-01'
      AND slot_start < '2026-03-01'
    `;
    
    const feb2026Result = await pool.query(feb2026Query, [businessId]);
    console.log(`\nFebruary 2026 slots: ${feb2026Result.rows[0].feb_count}`);
    
    // Show what the first 2000 slots include
    const first2000Query = `
      SELECT 
        slot_start,
        ROW_NUMBER() OVER (ORDER BY slot_start) as slot_number
      FROM calendar_slots
      WHERE business_id = $1
      AND is_available = true
      AND is_blocked = false
      AND slot_start >= NOW()
      ORDER BY slot_start
      LIMIT 2000
    `;
    
    const first2000Result = await pool.query(first2000Query, [businessId]);
    const lastSlotIn2000 = first2000Result.rows[first2000Result.rows.length - 1];
    
    console.log(`\nFirst 2000 slots end at: ${lastSlotIn2000.slot_start}`);
    console.log(`This is slot number: ${lastSlotIn2000.slot_number}`);
    
    // Show the position of February 11, 2026 slots
    const feb11PositionQuery = `
      SELECT 
        slot_start,
        ROW_NUMBER() OVER (ORDER BY slot_start) as slot_number
      FROM calendar_slots
      WHERE business_id = $1
      AND is_available = true
      AND is_blocked = false
      AND slot_start >= NOW()
      AND DATE(slot_start) = '2026-02-11'
      ORDER BY slot_start
      LIMIT 5
    `;
    
    const feb11PositionResult = await pool.query(feb11PositionQuery, [businessId]);
    
    if (feb11PositionResult.rows.length > 0) {
      console.log('\nFebruary 11, 2026 slots positions:');
      feb11PositionResult.rows.forEach(row => {
        console.log(`  Slot #${row.slot_number}: ${row.slot_start}`);
      });
    }
    
  } catch (error) {
    console.error('Count failed:', error);
  } finally {
    await pool.end();
  }
}

countTotalSlots();