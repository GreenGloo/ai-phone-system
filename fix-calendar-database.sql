-- Fix calendar system database issues

-- Add calendar_preferences column if it doesn't exist
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'businesses' 
        AND column_name = 'calendar_preferences'
    ) THEN
        ALTER TABLE businesses ADD COLUMN calendar_preferences JSONB DEFAULT '{
            "appointmentDuration": 60,
            "bufferTime": 30,
            "maxDailyAppointments": 8,
            "preferredSlots": null,
            "blockOutTimes": []
        }';
    END IF;
END $$;

-- Create calendar_slots table if it doesn't exist
CREATE TABLE IF NOT EXISTS calendar_slots (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    
    -- Slot timing
    slot_start TIMESTAMP NOT NULL,
    slot_end TIMESTAMP NOT NULL,
    
    -- Availability
    is_available BOOLEAN DEFAULT true,
    is_blocked BOOLEAN DEFAULT false,
    block_reason TEXT,
    
    -- Metadata
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create indexes if they don't exist
CREATE INDEX IF NOT EXISTS idx_calendar_slots_business_time ON calendar_slots(business_id, slot_start);
CREATE INDEX IF NOT EXISTS idx_calendar_slots_available ON calendar_slots(business_id, is_available, slot_start) WHERE is_available = true;
CREATE INDEX IF NOT EXISTS idx_calendar_slots_date_range ON calendar_slots(business_id, slot_start, slot_end);
CREATE UNIQUE INDEX IF NOT EXISTS idx_calendar_slots_unique ON calendar_slots(business_id, slot_start);