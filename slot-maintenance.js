// SMART CALENDAR SLOT MAINTENANCE SYSTEM
// Keeps 13+ months of slots available with automatic cleanup and generation

const { Pool } = require('pg');
const { generateCalendarSlots } = require('./calendar-generator');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

// Configuration
const DAYS_TO_MAINTAIN = 400; // 13+ months
const CLEANUP_THRESHOLD = 30; // Remove slots older than 30 days
const MIN_FUTURE_DAYS = 350; // Generate more slots if we have less than this

class SlotMaintenanceSystem {
  constructor() {
    this.isRunning = false;
    this.lastCleanup = null;
    this.lastGeneration = null;
  }

  // Start automatic maintenance (runs every 6 hours)
  start() {
    console.log('🔧 Starting slot maintenance system...');
    
    // Run initial maintenance
    this.runMaintenance();
    
    // Schedule regular maintenance every 6 hours
    setInterval(() => {
      this.runMaintenance();
    }, 6 * 60 * 60 * 1000); // 6 hours
    
    console.log('✅ Slot maintenance system started (runs every 6 hours)');
  }

  // Run complete maintenance cycle
  async runMaintenance() {
    if (this.isRunning) {
      console.log('⏳ Maintenance already running, skipping...');
      return;
    }

    this.isRunning = true;
    const startTime = Date.now();
    
    try {
      console.log('\n🔧 STARTING SLOT MAINTENANCE CYCLE');
      console.log('=' * 50);
      
      // Step 1: Cleanup old slots
      await this.cleanupOldSlots();
      
      // Step 2: Check businesses that need more slots
      await this.generateMissingSlots();
      
      // Step 3: Database optimization
      await this.optimizeDatabase();
      
      const duration = Date.now() - startTime;
      console.log(`✅ Maintenance cycle completed in ${duration}ms`);
      console.log('=' * 50);
      
    } catch (error) {
      console.error('❌ Maintenance cycle failed:', error);
    } finally {
      this.isRunning = false;
    }
  }

  // Remove slots older than threshold
  async cleanupOldSlots() {
    try {
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - CLEANUP_THRESHOLD);
      
      console.log(`🗑️ Cleaning up slots older than ${cutoffDate.toISOString()}`);
      
      const result = await pool.query(`
        DELETE FROM calendar_slots 
        WHERE slot_start < $1
      `, [cutoffDate.toISOString()]);
      
      console.log(`✅ Cleaned up ${result.rowCount} old slots`);
      this.lastCleanup = new Date();
      
    } catch (error) {
      console.error('❌ Slot cleanup failed:', error);
    }
  }

  // Generate slots for businesses that need them
  async generateMissingSlots() {
    try {
      console.log('📅 Checking businesses for missing slots...');
      
      // Find businesses that need more slots
      const businessesNeedingSlots = await pool.query(`
        SELECT b.id, b.name, 
               COUNT(cs.id) as current_slots,
               MAX(cs.slot_start) as furthest_slot
        FROM businesses b
        LEFT JOIN calendar_slots cs ON b.id = cs.business_id 
          AND cs.slot_start > NOW()
        WHERE b.business_hours IS NOT NULL
        GROUP BY b.id, b.name
        HAVING COUNT(cs.id) < $1 
           OR MAX(cs.slot_start) < NOW() + INTERVAL '${MIN_FUTURE_DAYS} days'
        ORDER BY COUNT(cs.id) ASC
      `, [MIN_FUTURE_DAYS * 10]); // Assuming ~10 slots per day
      
      console.log(`🔍 Found ${businessesNeedingSlots.rows.length} businesses needing slot generation`);
      
      let totalGenerated = 0;
      
      for (const business of businessesNeedingSlots.rows) {
        try {
          console.log(`📅 Generating slots for ${business.name} (current: ${business.current_slots})`);
          
          const slotsGenerated = await generateCalendarSlots(business.id, DAYS_TO_MAINTAIN);
          totalGenerated += slotsGenerated;
          
          console.log(`✅ Generated ${slotsGenerated} slots for ${business.name}`);
          
        } catch (error) {
          console.error(`❌ Failed to generate slots for ${business.name}:`, error.message);
        }
      }
      
      console.log(`📊 Total slots generated: ${totalGenerated}`);
      this.lastGeneration = new Date();
      
    } catch (error) {
      console.error('❌ Slot generation check failed:', error);
    }
  }

  // Optimize database performance
  async optimizeDatabase() {
    try {
      console.log('⚡ Running database optimizations...');
      
      // Update table statistics for better query planning
      await pool.query('ANALYZE calendar_slots');
      
      // Get slot statistics
      const stats = await pool.query(`
        SELECT 
          COUNT(*) as total_slots,
          COUNT(DISTINCT business_id) as businesses_with_slots,
          MIN(slot_start) as earliest_slot,
          MAX(slot_start) as latest_slot,
          COUNT(CASE WHEN is_available THEN 1 END) as available_slots
        FROM calendar_slots
      `);
      
      const stat = stats.rows[0];
      console.log('📊 DATABASE STATISTICS:');
      console.log(`   Total slots: ${stat.total_slots}`);
      console.log(`   Businesses: ${stat.businesses_with_slots}`);
      console.log(`   Available: ${stat.available_slots}`);
      console.log(`   Date range: ${stat.earliest_slot} to ${stat.latest_slot}`);
      
    } catch (error) {
      console.error('❌ Database optimization failed:', error);
    }
  }

  // Get maintenance status
  getStatus() {
    return {
      isRunning: this.isRunning,
      lastCleanup: this.lastCleanup,
      lastGeneration: this.lastGeneration,
      config: {
        daysToMaintain: DAYS_TO_MAINTAIN,
        cleanupThreshold: CLEANUP_THRESHOLD,
        minFutureDays: MIN_FUTURE_DAYS
      }
    };
  }

  // Manual maintenance trigger
  async runManualMaintenance() {
    console.log('🔧 Running manual maintenance...');
    await this.runMaintenance();
  }
}

// Export singleton instance
const maintenanceSystem = new SlotMaintenanceSystem();

module.exports = {
  SlotMaintenanceSystem,
  maintenanceSystem,
  startSlotMaintenance: () => maintenanceSystem.start(),
  runManualMaintenance: () => maintenanceSystem.runManualMaintenance(),
  getMaintenanceStatus: () => maintenanceSystem.getStatus()
};