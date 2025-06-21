-- Conversations table for reliable conversation persistence
-- Optimized for Railway free tier with minimal storage impact

CREATE TABLE IF NOT EXISTS conversations (
    call_sid VARCHAR(50) PRIMARY KEY,
    business_id UUID REFERENCES businesses(id) ON DELETE CASCADE,
    conversation_data JSONB,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Index for fast business lookups and cleanup
CREATE INDEX IF NOT EXISTS idx_conversations_business_created ON conversations(business_id, created_at);
CREATE INDEX IF NOT EXISTS idx_conversations_cleanup ON conversations(created_at);

-- Auto-update timestamp trigger
CREATE OR REPLACE FUNCTION update_conversations_timestamp()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS conversations_update_timestamp ON conversations;
CREATE TRIGGER conversations_update_timestamp
    BEFORE UPDATE ON conversations
    FOR EACH ROW
    EXECUTE FUNCTION update_conversations_timestamp();