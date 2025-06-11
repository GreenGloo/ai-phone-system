-- Add twilio_phone_sid column for phone number management
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS twilio_phone_sid VARCHAR(255);
