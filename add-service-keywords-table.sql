-- Create service_keywords table for AI-generated keywords
-- This enables dynamic, business-specific service matching

CREATE TABLE IF NOT EXISTS service_keywords (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    service_id UUID NOT NULL REFERENCES service_types(id) ON DELETE CASCADE,
    business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    keyword VARCHAR(100) NOT NULL,
    confidence_score DECIMAL(3,2) DEFAULT 1.0, -- How confident we are in this keyword match
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    -- Ensure no duplicate keywords per service
    UNIQUE(service_id, keyword)
);

-- Create indexes for fast keyword lookups during conversations
CREATE INDEX IF NOT EXISTS idx_service_keywords_business_keyword ON service_keywords(business_id, keyword);
CREATE INDEX IF NOT EXISTS idx_service_keywords_service ON service_keywords(service_id);

-- Add some sample data for testing (will be replaced by AI generation)
-- This shows the structure we're aiming for
INSERT INTO service_keywords (service_id, business_id, keyword, confidence_score) 
SELECT 
    st.id as service_id,
    st.business_id,
    unnest(ARRAY['oil', 'lube', 'fluid', 'change']) as keyword,
    1.0
FROM service_types st 
WHERE st.name ILIKE '%oil%' 
AND NOT EXISTS (SELECT 1 FROM service_keywords WHERE service_id = st.id)
LIMIT 10; -- Limit to prevent too many inserts

COMMENT ON TABLE service_keywords IS 'AI-generated keywords for dynamic service matching. Keywords are automatically created when services are added and deleted when services are removed.';
COMMENT ON COLUMN service_keywords.confidence_score IS 'AI confidence in keyword relevance (0.0-1.0). Higher scores used for better matching.';