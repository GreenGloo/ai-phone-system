-- Calendar slots table - Pre-generated availability
CREATE TABLE calendar_slots (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    
    -- Slot timing
    slot_start TIMESTAMP NOT NULL,
    slot_end TIMESTAMP NOT NULL,
    
    -- Availability
    is_available BOOLEAN DEFAULT true,
    is_blocked BOOLEAN DEFAULT false,  -- Manually blocked by owner
    block_reason TEXT,  -- "vacation", "maintenance", etc.
    
    -- Metadata
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for fast availability queries
CREATE INDEX idx_calendar_slots_business_time ON calendar_slots(business_id, slot_start);
CREATE INDEX idx_calendar_slots_available ON calendar_slots(business_id, is_available, slot_start) WHERE is_available = true;
CREATE INDEX idx_calendar_slots_date_range ON calendar_slots(business_id, slot_start, slot_end);

-- Prevent overlapping slots for same business
CREATE UNIQUE INDEX idx_calendar_slots_unique ON calendar_slots(business_id, slot_start);