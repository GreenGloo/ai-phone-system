-- CRITICAL SECURITY FIX: Business Isolation
-- This fixes the conversation storage security vulnerability

-- Fix 1: Add business_id validation to conversation queries
-- (This will be done in code changes)

-- Fix 2: Add Row Level Security (RLS) for bulletproof isolation
ALTER TABLE conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE appointments ENABLE ROW LEVEL SECURITY;
ALTER TABLE service_types ENABLE ROW LEVEL SECURITY;
ALTER TABLE calendar_slots ENABLE ROW LEVEL SECURITY;

-- Create policy to enforce business_id filtering on conversations
CREATE POLICY business_isolation_conversations ON conversations
  FOR ALL
  USING (business_id = current_setting('app.current_business_id', true)::uuid);

-- Create policy for appointments
CREATE POLICY business_isolation_appointments ON appointments
  FOR ALL  
  USING (business_id = current_setting('app.current_business_id', true)::uuid);

-- Create policy for service_types
CREATE POLICY business_isolation_service_types ON service_types
  FOR ALL
  USING (business_id = current_setting('app.current_business_id', true)::uuid);

-- Create policy for calendar_slots  
CREATE POLICY business_isolation_calendar_slots ON calendar_slots
  FOR ALL
  USING (business_id = current_setting('app.current_business_id', true)::uuid);

-- NOTE: These policies will be enforced at the database level
-- Code must set current_setting('app.current_business_id', business_id) before queries