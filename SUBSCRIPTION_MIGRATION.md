# AuthKit Subscription System - Migration Guide

## Overview

AuthKit now includes **complete subscription and payment management** for the FastLoop suite. All apps serve ONLY their core purpose - everything else is centralized in AuthKit.

## 🎯 Core Principle: Complete Centralization

**Each app does ONE thing only:**

| App | Purpose | Does NOT Handle |
|-----|---------|-----------------|
| **FastTask** | Kanban boards & tickets | ❌ Subscriptions, ❌ Payments, ❌ Auth, ❌ Stripe |
| **FastDeploy** | HTML deployment | ❌ Subscriptions, ❌ Payments, ❌ Auth, ❌ Stripe |
| **FastLoop Master** | App launcher | ❌ Subscriptions, ❌ Payments, ❌ Auth, ❌ Stripe |
| **AuthKit** | Auth, Users, Orgs, **Subscriptions**, **Payments**, **Stripe** | ✅ Everything centralized |

## Architecture

**100% Centralized in AuthKit**:
1. ✅ **Users & Authentication**
2. ✅ **Organizations & Multi-tenancy**
3. ✅ **Subscription Plans & Management**
4. ✅ **Stripe Integration (customers, subscriptions, webhooks)**
5. ✅ **Payment Processing**
6. ✅ **Usage Tracking**

**Apps Query AuthKit for Everything**:
- Authentication status
- Subscription status
- Feature access
- Usage limits

## System Flow Diagram

```
┌──────────────────────────────────────────────────────────────────┐
│                         USER                                      │
└────────────┬───────────────────────────────────┬─────────────────┘
             │                                   │
             │ Uses app                          │ Upgrades to Pro
             ▼                                   ▼
┌────────────────────────┐            ┌──────────────────────────┐
│      FastTask          │            │       AuthKit            │
│                        │            │                          │
│  ✅ Kanban boards      │◄───────────┤  ✅ Users & Auth         │
│  ✅ Tickets            │ Auth check │  ✅ Organizations        │
│  ✅ Workspaces         │            │  ✅ Subscriptions        │
│                        │◄───────────┤  ✅ Stripe Integration   │
│  ❌ NO subscriptions   │ Sub status │  ✅ Payment Processing   │
│  ❌ NO payments        │            │  ✅ Usage Tracking       │
│  ❌ NO Stripe          │            │                          │
└────────────────────────┘            └──────────┬───────────────┘
                                                 │
                                                 │ Stripe API
                                                 │ Webhook events
                                                 ▼
                                      ┌──────────────────────────┐
                                      │       Stripe             │
                                      │  (Payment Platform)      │
                                      └──────────────────────────┘
```

**Key Points**:
1. **FastTask** never talks to Stripe - only to AuthKit
2. **AuthKit** is the single point of contact with Stripe
3. **Stripe webhooks** point to AuthKit only
4. **All apps** query AuthKit for subscription/auth status

## Database Schema

### Tables Created in AuthKit:

1. **subscription_plans**
   - Plan metadata (name, display_name, description)
   - Pricing (monthly, yearly)
   - Stripe IDs (product_id, price_id, price_id_yearly)
   - Features (JSONB - flexible configuration)

2. **subscriptions**
   - User subscription records
   - Stripe sync data (customer_id, subscription_id)
   - Status tracking (active, trialing, past_due, cancelled)
   - Feature overrides (JSONB)
   - Billing periods and trial info

3. **subscription_usage**
   - Per-period usage tracking
   - Counters: boards, tickets, AI tokens, storage, translations

## Migration Process

### Phase 1: Setup AuthKit (COMPLETED)

✅ **Files Created**:
- `migrations/add_subscriptions.sql` - Database schema
- `stripe-service.js` - Stripe integration
- `client/subscription-client.js` - HTTP client for apps
- `migrations/migrate-fasttask-subscriptions.js` - Data migration script

✅ **Code Changes**:
- Added subscription methods to `PostgreSQLAdapter`
- Added subscription methods to `AuthKit` class
- Added subscription HTTP endpoints to `server.js`
- Installed `stripe` npm package

### Phase 2: Migrate Data (TODO)

**Run Migration Script**:

```bash
# Set environment variables
export FASTTASK_DB_URL="postgresql://user:pass@host/fasttask_db"
export AUTHKIT_DB_URL="postgresql://user:pass@host/authkit_db"

# Run migration
cd /path/to/auth.api-internal
node migrations/migrate-fasttask-subscriptions.js
```

**What Gets Migrated**:
- All subscription plans from FastTask
- All user subscriptions (with Stripe data intact)
- All usage records

**Migration Safety**:
- Script checks for existing records (no duplicates)
- Skips users not found in AuthKit
- Preserves all Stripe IDs and statuses

### Phase 3: Update FastTask (TODO)

**Option A: HTTP Client (Separate Databases)**

If AuthKit and FastTask use different databases:

```javascript
// In FastTask
const { SubscriptionClient } = require('@getkiara/auth-kit/client/subscription-client');

const authKitClient = new SubscriptionClient(
  process.env.AUTHKIT_URL, // e.g., 'http://authkit-service:3001'
  process.env.AUTHKIT_API_KEY
);

// Replace local subscription queries with:
const subscription = await authKitClient.getSubscription(userId);
const features = await authKitClient.getFeatures(userId);
const withinLimit = await authKitClient.checkLimit(userId, 'max_boards');
await authKitClient.incrementUsage(userId, 'ai_tokens', 1000);
```

**Option B: Direct Client (Same Database)**

If AuthKit and FastTask share the same database:

```javascript
// In FastTask
const { AuthKit } = require('@getkiara/auth-kit');
const { DirectSubscriptionClient } = require('@getkiara/auth-kit/client/subscription-client');

const authKit = await AuthKit.create({
  storage: 'postgres',
  connectionString: process.env.DATABASE_URL,
});

const authKitClient = new DirectSubscriptionClient(authKit);

// Use same methods as HTTP client:
const subscription = await authKitClient.getSubscription(userId);
```

**Update FastTask Code**:

Replace these FastTask files/methods:
- ❌ `api/_lib/subscription-service.js` → ✅ Use AuthKit client
- ❌ `api/_lib/stripe-service.js` → ✅ Use AuthKit Stripe service
- ❌ Local subscription queries → ✅ Call `authKitClient.getSubscription()`
- ❌ Local feature checks → ✅ Call `authKitClient.checkLimit()`
- ❌ Local usage increments → ✅ Call `authKitClient.incrementUsage()`

### Phase 4: Remove ALL Subscription & Stripe Code from FastTask (TODO)

**After verifying AuthKit integration works**:

1. **Backup FastTask subscription tables**:
   ```sql
   -- Create backup
   CREATE TABLE subscriptions_backup AS SELECT * FROM subscriptions;
   CREATE TABLE subscription_plans_backup AS SELECT * FROM subscription_plans;
   CREATE TABLE subscription_usage_backup AS SELECT * FROM subscription_usage;
   ```

2. **Drop FastTask subscription tables**:
   ```sql
   DROP TABLE IF EXISTS subscription_usage CASCADE;
   DROP TABLE IF EXISTS subscriptions CASCADE;
   DROP TABLE IF EXISTS subscription_plans CASCADE;
   ```

3. **Remove ALL subscription & Stripe code from FastTask**:

   **❌ DELETE these files:**
   - `api/_lib/subscription-service.js` - All subscription logic
   - `api/_lib/stripe-service.js` - **ALL Stripe integration**
   - `api/webhooks/stripe/*` - **ALL Stripe webhooks**
   - `migrations/add_subscriptions.sql` - Subscription schema
   - `migrations/add_free_plan.sql` - Free plan migration
   - Any Stripe-related routes in API

   **❌ REMOVE from package.json:**
   ```bash
   npm uninstall stripe
   ```

   **❌ REMOVE environment variables:**
   - `STRIPE_SECRET_KEY` (now only in AuthKit)
   - `STRIPE_WEBHOOK_SECRET` (now only in AuthKit)
   - `STRIPE_PUBLISHABLE_KEY` (if used)

   **✅ KEEP only:**
   - AuthKit client for querying subscriptions
   - Feature gating logic (now calls AuthKit)
   - Board/ticket/workspace logic (FastTask's core purpose)

## Free Plan Configuration

The free plan in AuthKit is configured with **unlimited access**:

```javascript
{
  name: 'free',
  display_name: 'Free Tier',
  price: 0,
  features: {
    max_boards: null,                    // Unlimited
    max_tickets_per_board: null,         // Unlimited
    ai_tokens_per_month: null,           // Unlimited
    max_storage_mb: null,                // Unlimited
    max_board_members: null,             // Unlimited
    // ... all features unlimited
    apps: ['fasttask', 'fastdeploy', 'fastloop-master', 'authkit']
  }
}
```

**To add limits later**, update the plan:

```javascript
await authKit.updatePlan(freePlanId, {
  features: {
    ...existingFeatures,
    max_board_members: 3,         // Add 3rd member upgrade trigger
    ai_tokens_per_month: 100000,  // Add AI token limit
  }
});
```

## API Endpoints

### Subscription Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/subscriptions/plans` | List all plans |
| GET | `/api/subscriptions/user/:userId` | Get user's subscription |
| GET | `/api/subscriptions/user/:userId/features` | Get merged features |
| GET | `/api/subscriptions/user/:userId/check-limit/:limitName` | Check if within limit |
| POST | `/api/subscriptions/user/:userId/usage` | Increment usage |
| POST | `/api/subscriptions/subscribe` | Subscribe user to plan |
| POST | `/api/subscriptions/user/:userId/cancel` | Cancel subscription |
| POST | `/api/subscriptions/user/:userId/change-plan` | Change plan |
| POST | `/api/subscriptions/user/:userId/stripe` | Update Stripe data |

### Stripe Endpoints (100% Centralized in AuthKit)

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/stripe/create-checkout` | Create Stripe subscription |
| POST | `/api/stripe/create-customer` | Create Stripe customer |
| POST | `/api/stripe/cancel-subscription` | Cancel via Stripe |
| POST | `/api/stripe/update-payment-method` | Update payment method |
| POST | `/api/stripe/change-plan` | Change plan with Stripe |
| POST | `/webhooks/stripe` | **Stripe webhook handler** |

**⚠️ IMPORTANT**: Configure Stripe webhooks to point to AuthKit:

```
Webhook URL: https://authkit.yourdomain.com/webhooks/stripe
                    ^^^^^^^^ AuthKit domain, NOT FastTask

Events to subscribe:
- customer.subscription.created
- customer.subscription.updated
- customer.subscription.deleted
- invoice.paid
- invoice.payment_failed
```

## Complete Payment Flow (Centralized)

### Example: User Upgrades from Free to Pro

**❌ OLD (FastTask handled payments):**
```
User → FastTask → Stripe → FastTask webhook → Update local DB
```

**✅ NEW (100% Centralized in AuthKit):**
```
1. User clicks "Upgrade" in FastTask
2. FastTask calls AuthKit: POST /api/stripe/create-checkout
3. AuthKit creates Stripe subscription
4. User pays via Stripe
5. Stripe sends webhook → AuthKit /webhooks/stripe
6. AuthKit updates subscription in DB
7. FastTask queries AuthKit: GET /api/subscriptions/user/:userId
8. FastTask sees Pro subscription, unlocks features
```

**FastTask Code Example:**

```javascript
// ✅ CORRECT: FastTask calls AuthKit
async function handleUpgrade(userId, planName) {
  // Call AuthKit to handle Stripe
  const response = await fetch(`${AUTHKIT_URL}/api/stripe/create-checkout`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${authToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      userId,
      planIdOrName: planName,
      billing_cycle: 'monthly',
    }),
  });

  const { stripe, subscription } = await response.json();

  // Redirect user to Stripe or show success
  console.log('Subscription created:', subscription);
}

// ❌ WRONG: FastTask NEVER does this
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY); // ❌ NO!
const session = await stripe.checkout.sessions.create({...}); // ❌ NO!
```

## Stripe Integration (AuthKit Only)

**StripeService** in AuthKit handles ALL Stripe operations:

```javascript
// This code runs ONLY in AuthKit, NEVER in FastTask
const StripeService = require('./stripe-service');

const stripeService = new StripeService(
  process.env.STRIPE_SECRET_KEY,
  authKit
);

// Create subscription with Stripe
const result = await stripeService.createSubscription(userId, 'pro', {
  billing_cycle: 'monthly',
  trial_days: 14,
});

// AuthKit webhook handler (in server.js)
app.post('/webhooks/stripe', express.raw({type: 'application/json'}), async (req, res) => {
  const sig = req.headers['stripe-signature'];
  const event = stripeService.verifyWebhookSignature(
    req.body,
    sig,
    process.env.STRIPE_WEBHOOK_SECRET
  );

  await stripeService.handleWebhook(event);
  res.json({ received: true });
});
```

### Environment Variables

**AuthKit** `.env`:
```bash
DATABASE_URL=postgresql://...
STRIPE_SECRET_KEY=sk_live_xxxxx           # ✅ Only in AuthKit
STRIPE_WEBHOOK_SECRET=whsec_xxxxx         # ✅ Only in AuthKit
```

**FastTask** `.env`:
```bash
DATABASE_URL=postgresql://...
AUTHKIT_URL=https://authkit.yourdomain.com  # ✅ Query AuthKit
AUTHKIT_API_KEY=ak_xxxxx                    # ✅ Authenticate to AuthKit

# ❌ REMOVE these - no longer needed:
# STRIPE_SECRET_KEY=...                    # ❌ DELETE
# STRIPE_WEBHOOK_SECRET=...                # ❌ DELETE
```

## Testing the Migration

### 1. Verify AuthKit Subscription Setup

```bash
# Start AuthKit server
cd /path/to/auth.api-internal
DATABASE_URL="your-authkit-db" npm run server

# Test endpoints
curl http://localhost:3001/api/subscriptions/plans
```

### 2. Test Migration Script

```bash
# Run with test databases first
FASTTASK_DB_URL="..." AUTHKIT_DB_URL="..." node migrations/migrate-fasttask-subscriptions.js
```

### 3. Verify Data Integrity

```sql
-- Check plan count matches
SELECT COUNT(*) FROM subscription_plans; -- Should match FastTask count

-- Check subscription count
SELECT COUNT(*) FROM subscriptions; -- Should match FastTask count

-- Verify Stripe IDs preserved
SELECT stripe_customer_id, stripe_subscription_id FROM subscriptions LIMIT 5;
```

### 4. Test FastTask Integration

```javascript
// In FastTask, test subscription queries
const sub = await authKitClient.getSubscription(testUserId);
console.log('Subscription:', sub);

const features = await authKitClient.getFeatures(testUserId);
console.log('Features:', features);

const withinLimit = await authKitClient.checkLimit(testUserId, 'max_boards');
console.log('Within limit:', withinLimit);
```

## Rollback Plan

If migration fails:

1. **Keep FastTask subscription tables** until verified working
2. **Run dual-write temporarily**: Write to both FastTask and AuthKit during transition
3. **Compare data** between FastTask and AuthKit before dropping tables
4. **Restore from backup** if needed:
   ```sql
   DROP TABLE subscriptions;
   CREATE TABLE subscriptions AS SELECT * FROM subscriptions_backup;
   ```

## Final Architecture Summary

### ✅ What AuthKit Handles (Everything Centralized)

```
AuthKit (auth.api-internal/)
├── Users & Authentication
├── Organizations & Multi-tenancy
├── Subscription Plans
├── User Subscriptions
├── Usage Tracking
├── Stripe Customers
├── Stripe Subscriptions
├── Stripe Webhooks
├── Payment Processing
└── Feature Access Control
```

### ✅ What FastTask Handles (Core Purpose Only)

```
FastTask (ticket.api-internal/)
├── Kanban Boards
├── Tickets
├── Workspaces
├── Labels & Tags
├── Attachments
├── Comments
└── AI Generation (uses AuthKit for token limits)
```

### ❌ What FastTask Does NOT Handle

```
FastTask does NOT have:
❌ Subscription tables
❌ Subscription logic
❌ Stripe integration
❌ Stripe webhooks
❌ Payment processing
❌ stripe npm package
❌ STRIPE_SECRET_KEY env var
❌ STRIPE_WEBHOOK_SECRET env var
```

### FastTask's Only Connection to Subscriptions

```javascript
// FastTask only has this:
const authKitClient = new SubscriptionClient(
  process.env.AUTHKIT_URL,
  process.env.AUTHKIT_API_KEY
);

// And calls these:
const sub = await authKitClient.getSubscription(userId);
const features = await authKitClient.getFeatures(userId);
const canCreate = await authKitClient.checkLimit(userId, 'max_boards');
await authKitClient.incrementUsage(userId, 'ai_tokens', 1000);
```

## Next Steps

1. ✅ **Phase 1 Complete**: AuthKit subscription & Stripe system is 100% set up
2. ⏳ **Phase 2**: Run migration script to copy FastTask data
3. ⏳ **Phase 3**: Update FastTask to use AuthKit client
4. ⏳ **Phase 4**: Remove ALL subscription & Stripe code from FastTask
5. ⏳ **Phase 5**: Update Stripe dashboard webhook URL to point to AuthKit

## Questions?

See `HANDOFF.md` for more context or check the implementation in:
- `index.js` (lines 1056-2223) - Subscription methods
- `server.js` (lines 365-625) - API endpoints (subscriptions + Stripe)
- `stripe-service.js` - Complete Stripe integration
- `client/subscription-client.js` - Client library for apps
- `migrations/add_subscriptions.sql` - Database schema
- `migrations/migrate-fasttask-subscriptions.js` - Data migration script

## Stripe Dashboard Configuration

After migration, update Stripe webhook:

```
Dashboard → Developers → Webhooks → Add endpoint

URL: https://authkit.yourdomain.com/webhooks/stripe
     ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
     MUST be AuthKit URL, NOT FastTask

Events:
✅ customer.subscription.created
✅ customer.subscription.updated
✅ customer.subscription.deleted
✅ invoice.paid
✅ invoice.payment_failed

Signing secret: Copy to AuthKit .env as STRIPE_WEBHOOK_SECRET
```
