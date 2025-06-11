-- Add twilio_phone_sid column for phone number management
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS twilio_phone_sid VARCHAR(255);

-- Add calendar_preferences column for business calendar management
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS calendar_preferences JSONB DEFAULT '{
    "appointmentDuration": 60,
    "bufferTime": 30,
    "maxDailyAppointments": 8,
    "preferredSlots": null,
    "blockOutTimes": []
}';
