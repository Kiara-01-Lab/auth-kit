-- Subscription system for FastLoop Suite
-- Centralized subscription management across all apps
-- Run with: psql $DATABASE_URL < migrations/add_subscriptions.sql

-- =============================================================================
-- 1. SUBSCRIPTION PLANS (Flexible, database-driven)
-- =============================================================================
CREATE TABLE IF NOT EXISTS subscription_plans (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,

  -- Plan identification
  name TEXT NOT NULL UNIQUE, -- 'free', 'pro', 'enterprise'
  display_name TEXT NOT NULL, -- 'Free Plan', 'Pro Plan', 'Enterprise'
  description TEXT,

  -- Stripe integration
  stripe_product_id TEXT, -- prod_xxxxx
  stripe_price_id TEXT, -- price_xxxxx (monthly price)
  stripe_price_id_yearly TEXT, -- price_xxxxx (yearly price)

  -- Pricing
  price_monthly DECIMAL(10, 2),
  price_yearly DECIMAL(10, 2),
  currency TEXT DEFAULT 'USD',

  -- Features (flexible JSONB for easy updates)
  features JSONB NOT NULL DEFAULT '{}'::jsonb,
  -- Example structure:
  -- {
  --   "max_boards": 1,
  --   "max_tickets_per_board": 5,
  --   "ai_tokens_per_month": 100000,
  --   "file_attachments": true,
  --   "max_storage_mb": 1024,
  --   "max_file_size_mb": 50,
  --   "translation": true,
  --   "advanced_reporting": false,
  --   "custom_workflows": false,
  --   "api_access": false,
  --   "priority_support": false,
  --   "max_board_members": 3,
  --   "apps": ["fasttask", "fastdeploy", "fastloop-master", "authkit"]
  -- }

  -- Plan metadata
  is_active BOOLEAN DEFAULT true,
  sort_order INTEGER DEFAULT 0,
  recommended BOOLEAN DEFAULT false,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- =============================================================================
-- 2. USER SUBSCRIPTIONS (with Stripe sync)
-- =============================================================================
CREATE TABLE IF NOT EXISTS subscriptions (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  plan_id TEXT NOT NULL REFERENCES subscription_plans(id),

  -- Status tracking
  status TEXT NOT NULL DEFAULT 'active', -- 'active', 'trialing', 'past_due', 'cancelled', 'expired'

  -- Stripe sync data
  stripe_customer_id TEXT,
  stripe_subscription_id TEXT,
  stripe_latest_invoice_id TEXT,
  stripe_payment_intent_status TEXT,

  -- Billing cycle
  billing_cycle TEXT DEFAULT 'monthly', -- 'monthly', 'yearly'

  -- Custom overrides (optional - for special cases)
  feature_overrides JSONB DEFAULT '{}'::jsonb,
  -- Example: {"max_boards": 20, "ai_tokens_per_month": 100}

  -- Trial information
  trial_start TIMESTAMPTZ,
  trial_end TIMESTAMPTZ,

  -- Billing period
  current_period_start TIMESTAMPTZ,
  current_period_end TIMESTAMPTZ,

  -- Cancellation
  cancel_at_period_end BOOLEAN DEFAULT false,
  cancelled_at TIMESTAMPTZ,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for fast lookups
CREATE INDEX IF NOT EXISTS idx_subscriptions_user_id ON subscriptions(user_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_status ON subscriptions(status);
CREATE INDEX IF NOT EXISTS idx_subscriptions_stripe_customer ON subscriptions(stripe_customer_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_stripe_subscription ON subscriptions(stripe_subscription_id);

-- =============================================================================
-- 3. USAGE TRACKING (per billing period)
-- =============================================================================
CREATE TABLE IF NOT EXISTS subscription_usage (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  subscription_id TEXT NOT NULL REFERENCES subscriptions(id) ON DELETE CASCADE,

  -- Current period usage
  period_start TIMESTAMPTZ NOT NULL,
  period_end TIMESTAMPTZ NOT NULL,

  -- Usage counters
  boards_count INTEGER DEFAULT 0,
  tickets_count INTEGER DEFAULT 0,
  storage_used_mb DECIMAL(10, 2) DEFAULT 0,
  ai_tokens_used INTEGER DEFAULT 0,
  translation_requests_count INTEGER DEFAULT 0,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- One usage record per user per period
  UNIQUE(user_id, period_start)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_usage_user_id ON subscription_usage(user_id);
CREATE INDEX IF NOT EXISTS idx_usage_period ON subscription_usage(period_start, period_end);
CREATE INDEX IF NOT EXISTS idx_usage_subscription ON subscription_usage(subscription_id);

-- =============================================================================
-- 4. INSERT DEFAULT FREE PLAN (SUITE-WIDE)
-- =============================================================================
INSERT INTO subscription_plans (name, display_name, description, price_monthly, price_yearly, features, is_active, sort_order, recommended)
VALUES (
  'free',
  'Free Tier',
  'Default free tier for all users - unlimited access to all apps',
  0.00,
  0.00,
  '{
    "max_boards": null,
    "max_tickets_per_board": null,
    "unlimited_tickets": true,
    "ai_generation": true,
    "ai_tokens_per_month": null,
    "file_attachments": true,
    "max_storage_mb": null,
    "max_file_size_mb": 50,
    "translation": true,
    "translation_requests_per_month": null,
    "advanced_reporting": true,
    "custom_workflows": true,
    "api_access": true,
    "priority_support": false,
    "max_board_members": 3,
    "apps": ["fasttask", "fastdeploy", "fastloop-master", "authkit"]
  }'::jsonb,
  true,
  0,
  false
)
ON CONFLICT (name) DO UPDATE SET
  features = EXCLUDED.features,
  description = EXCLUDED.description,
  updated_at = NOW();

-- =============================================================================
-- 5. AUTO-SUBSCRIBE ALL EXISTING USERS TO FREE PLAN
-- =============================================================================
DO $$
DECLARE
  free_plan_id TEXT;
BEGIN
  -- Get free plan ID
  SELECT id INTO free_plan_id FROM subscription_plans WHERE name = 'free';

  -- Create free subscriptions for users without any subscription
  INSERT INTO subscriptions (user_id, plan_id, status, billing_cycle, current_period_start, current_period_end)
  SELECT
    id,
    free_plan_id,
    'active',
    'monthly',
    NOW(),
    NOW() + INTERVAL '1 month'
  FROM users
  WHERE NOT EXISTS (
    SELECT 1 FROM subscriptions WHERE subscriptions.user_id = users.id
  );

  -- Create usage records for new subscriptions
  INSERT INTO subscription_usage (user_id, subscription_id, period_start, period_end)
  SELECT
    u.id,
    s.id,
    DATE_TRUNC('month', NOW()),
    DATE_TRUNC('month', NOW()) + INTERVAL '1 month'
  FROM users u
  JOIN subscriptions s ON s.user_id = u.id AND s.plan_id = free_plan_id
  WHERE NOT EXISTS (
    SELECT 1 FROM subscription_usage
    WHERE subscription_usage.user_id = u.id
    AND subscription_usage.period_start = DATE_TRUNC('month', NOW())
  );

  RAISE NOTICE '✅ Free plan created and assigned to all users';
  RAISE NOTICE '   - Unlimited access to all FastLoop apps';
END $$;

-- =============================================================================
-- 6. TRIGGERS FOR UPDATED_AT
-- =============================================================================
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_update_subscription_plans_updated_at ON subscription_plans;
CREATE TRIGGER trigger_update_subscription_plans_updated_at
  BEFORE UPDATE ON subscription_plans
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS trigger_update_subscriptions_updated_at ON subscriptions;
CREATE TRIGGER trigger_update_subscriptions_updated_at
  BEFORE UPDATE ON subscriptions
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS trigger_update_subscription_usage_updated_at ON subscription_usage;
CREATE TRIGGER trigger_update_subscription_usage_updated_at
  BEFORE UPDATE ON subscription_usage
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();
