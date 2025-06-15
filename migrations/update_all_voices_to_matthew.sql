-- Migration: Update all existing businesses to use Matthew voice instead of Joanna
-- This fixes the Alice/Joanna voice issue by ensuring all businesses use male voice

-- Update all businesses that currently have the default female voice to use Matthew
UPDATE businesses 
SET ai_voice_id = 'Polly.Matthew-Neural',
    updated_at = CURRENT_TIMESTAMP
WHERE ai_voice_id = 'Polly.Joanna-Neural' 
   OR ai_voice_id IS NULL;

-- Also ensure all businesses have a personality set
UPDATE businesses 
SET ai_personality = 'professional',
    updated_at = CURRENT_TIMESTAMP  
WHERE ai_personality IS NULL;