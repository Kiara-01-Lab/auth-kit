-- Update existing free plan to set max_board_members: 3
-- This migration updates the free plan that already exists in the database

UPDATE subscription_plans
SET features = jsonb_set(
  COALESCE(features, '{}'::jsonb),
  '{max_board_members}',
  '3'::jsonb
)
WHERE name = 'free';

-- Verify the update
SELECT name, features->>'max_board_members' as max_board_members
FROM subscription_plans
WHERE name IN ('free', 'trial', 'micro', 'start', 'business');
