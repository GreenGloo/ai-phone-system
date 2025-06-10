-- CallCatcher SaaS Database Schema
-- Multi-tenant architecture for AI phone system

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Users table (main account holders)
CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    first_name VARCHAR(100) NOT NULL,
    last_name VARCHAR(100) NOT NULL,
    phone VARCHAR(20),
    email_verified BOOLEAN DEFAULT FALSE,
    email_verification_token VARCHAR(255),
    password_reset_token VARCHAR(255),
    password_reset_expires TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    last_login TIMESTAMP
);

-- Businesses table (each user can have multiple businesses)
CREATE TABLE businesses (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    business_type VARCHAR(100) NOT NULL, -- plumbing, electrical, hvac, etc
    address TEXT,
    city VARCHAR(100),
    state VARCHAR(50),
    zip_code VARCHAR(20),
    phone_number VARCHAR(20), -- Their Twilio number
    twilio_account_sid VARCHAR(255),
    twilio_auth_token VARCHAR(255),
    
    -- Business hours
    business_hours JSONB DEFAULT '{
        "monday": {"start": "08:00", "end": "18:00", "enabled": true},
        "tuesday": {"start": "08:00", "end": "18:00", "enabled": true},
        "wednesday": {"start": "08:00", "end": "18:00", "enabled": true},
        "thursday": {"start": "08:00", "end": "18:00", "enabled": true},
        "friday": {"start": "08:00", "end": "18:00", "enabled": true},
        "saturday": {"start": "09:00", "end": "17:00", "enabled": true},
        "sunday": {"start": "10:00", "end": "16:00", "enabled": false}
    }',
    
    -- AI Settings
    ai_personality VARCHAR(50) DEFAULT 'professional', -- professional, friendly, urgent
    ai_voice_id VARCHAR(100) DEFAULT 'Polly.Joanna-Neural',
    business_description TEXT,
    emergency_message TEXT,
    
    -- Status
    status VARCHAR(20) DEFAULT 'active', -- active, suspended, cancelled
    onboarding_completed BOOLEAN DEFAULT FALSE,
    
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Service types table (each business defines their services)
CREATE TABLE service_types (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL, -- Emergency Repair, Drain Cleaning, etc
    service_key VARCHAR(100) NOT NULL, -- emergency, drain-cleaning, etc
    description TEXT,
    duration_minutes INTEGER NOT NULL DEFAULT 60,
    base_rate DECIMAL(10,2) NOT NULL,
    emergency_multiplier DECIMAL(3,2) DEFAULT 1.5,
    travel_buffer_minutes INTEGER DEFAULT 30,
    is_emergency BOOLEAN DEFAULT FALSE,
    is_active BOOLEAN DEFAULT TRUE,
    display_order INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Subscriptions table (Stripe integration)
CREATE TABLE subscriptions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    stripe_customer_id VARCHAR(255) NOT NULL,
    stripe_subscription_id VARCHAR(255) UNIQUE,
    plan VARCHAR(50) NOT NULL, -- starter, professional, enterprise
    status VARCHAR(50) NOT NULL, -- active, cancelled, past_due, etc
    current_period_start TIMESTAMP,
    current_period_end TIMESTAMP,
    trial_ends_at TIMESTAMP,
    cancelled_at TIMESTAMP,
    
    -- Usage tracking
    monthly_call_limit INTEGER DEFAULT 100,
    calls_used_this_month INTEGER DEFAULT 0,
    overage_rate DECIMAL(5,2) DEFAULT 0.25, -- per call over limit
    
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Appointments table (multi-tenant)
CREATE TABLE appointments (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    
    -- Customer information
    customer_name VARCHAR(255) NOT NULL,
    customer_phone VARCHAR(20) NOT NULL,
    customer_email VARCHAR(255),
    customer_address TEXT,
    
    -- Service details
    service_type_id UUID REFERENCES service_types(id),
    service_name VARCHAR(255) NOT NULL,
    issue_description TEXT,
    
    -- Scheduling
    start_time TIMESTAMP NOT NULL,
    end_time TIMESTAMP NOT NULL,
    duration_minutes INTEGER NOT NULL,
    estimated_revenue DECIMAL(10,2),
    
    -- Status tracking
    status VARCHAR(50) DEFAULT 'scheduled', -- scheduled, confirmed, in_progress, completed, cancelled, no_show
    booking_source VARCHAR(50) DEFAULT 'ai_phone', -- ai_phone, website, manual, api
    
    -- Communication
    communication_log JSONB DEFAULT '[]',
    last_communication TIMESTAMP,
    
    -- Call details (if booked via phone)
    call_sid VARCHAR(255),
    call_duration INTEGER, -- seconds
    call_recording_url VARCHAR(500),
    
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    completed_at TIMESTAMP
);

-- Call logs table (detailed call tracking)
CREATE TABLE call_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    
    -- Twilio details
    call_sid VARCHAR(255) UNIQUE NOT NULL,
    from_number VARCHAR(20) NOT NULL,
    to_number VARCHAR(20) NOT NULL,
    call_status VARCHAR(50), -- completed, busy, no-answer, etc
    duration INTEGER, -- seconds
    recording_url VARCHAR(500),
    
    -- Conversation analysis
    conversation_log JSONB DEFAULT '[]',
    customer_intent VARCHAR(100), -- emergency, regular_service, pricing_inquiry, etc
    sentiment_score DECIMAL(3,2), -- -1 to 1
    
    -- Booking outcome
    appointment_id UUID REFERENCES appointments(id),
    booking_successful BOOLEAN DEFAULT FALSE,
    booking_failure_reason TEXT,
    
    -- Customer extracted info
    customer_name VARCHAR(255),
    customer_phone VARCHAR(20),
    issue_type VARCHAR(100),
    urgency_level VARCHAR(20), -- low, medium, high, emergency
    
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Notifications table (for dashboard alerts)
CREATE TABLE notifications (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    type VARCHAR(50) NOT NULL, -- new_booking, missed_call, payment_failed, etc
    title VARCHAR(255) NOT NULL,
    message TEXT NOT NULL,
    data JSONB, -- additional structured data
    read_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- SMS messages table (communication tracking)
CREATE TABLE sms_messages (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    appointment_id UUID REFERENCES appointments(id),
    
    -- Message details
    twilio_sid VARCHAR(255) UNIQUE,
    direction VARCHAR(10) NOT NULL, -- inbound, outbound
    from_number VARCHAR(20) NOT NULL,
    to_number VARCHAR(20) NOT NULL,
    message_body TEXT NOT NULL,
    status VARCHAR(50), -- sent, delivered, failed, etc
    
    -- Message type
    message_type VARCHAR(50), -- confirmation, reminder, running_late, arrived, etc
    automated BOOLEAN DEFAULT TRUE,
    
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Business analytics table (aggregated metrics)
CREATE TABLE business_analytics (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    
    -- Date for metrics
    date DATE NOT NULL,
    
    -- Call metrics
    total_calls INTEGER DEFAULT 0,
    answered_calls INTEGER DEFAULT 0,
    missed_calls INTEGER DEFAULT 0,
    average_call_duration DECIMAL(5,2) DEFAULT 0,
    
    -- Booking metrics
    appointments_booked INTEGER DEFAULT 0,
    booking_conversion_rate DECIMAL(5,2) DEFAULT 0,
    total_revenue DECIMAL(10,2) DEFAULT 0,
    average_job_value DECIMAL(10,2) DEFAULT 0,
    
    -- Service metrics
    emergency_calls INTEGER DEFAULT 0,
    regular_calls INTEGER DEFAULT 0,
    customer_satisfaction DECIMAL(3,2), -- 1-5 rating
    
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    UNIQUE(business_id, date)
);

-- Indexes for performance
CREATE INDEX idx_businesses_user_id ON businesses(user_id);
CREATE INDEX idx_appointments_business_id ON appointments(business_id);
CREATE INDEX idx_appointments_start_time ON appointments(start_time);
CREATE INDEX idx_appointments_status ON appointments(status);
CREATE INDEX idx_call_logs_business_id ON call_logs(business_id);
CREATE INDEX idx_call_logs_call_sid ON call_logs(call_sid);
CREATE INDEX idx_service_types_business_id ON service_types(business_id);
CREATE INDEX idx_subscriptions_business_id ON subscriptions(business_id);
CREATE INDEX idx_notifications_business_id_read ON notifications(business_id, read_at);
CREATE INDEX idx_sms_messages_business_id ON sms_messages(business_id);
CREATE INDEX idx_business_analytics_business_date ON business_analytics(business_id, date);

-- Triggers for updated_at timestamps
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_users_updated_at BEFORE UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_businesses_updated_at BEFORE UPDATE ON businesses
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_subscriptions_updated_at BEFORE UPDATE ON subscriptions
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_appointments_updated_at BEFORE UPDATE ON appointments
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Default service types for new businesses (will be inserted via code)
-- This is handled in the application layer during business onboarding
