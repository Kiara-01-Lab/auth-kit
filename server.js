/**
 * AuthKit - Simple REST API Server
 *
 * Demonstrates AuthKit as a standalone auth service.
 * Mount behind your app or run as a sidecar.
 */

const path = require('path');
const express = require('express');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const { AuthKit } = require('./index.js');
const StripeService = require('./stripe-service.js');

const app = express();
const PORT = process.env.PORT || 3001;

// Rate limiters
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 20,
  message: { error: 'Too many requests, please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// Middleware
app.use(cors());
app.use(express.json());

let auth;
let stripeService;

async function init() {
  auth = await AuthKit.create({
    storage: process.env.DATABASE_URL ? 'postgres' : process.env.AUTH_DB ? 'file' : 'memory',
    filename: process.env.AUTH_DB || undefined,
    tokenExpiry: process.env.TOKEN_EXPIRY || '7d',
    roles: {
      admin: ['*'],
      member: ['read', 'write'],
      viewer: ['read'],
    },
  });

  // Initialize Stripe service if key is provided
  if (process.env.STRIPE_SECRET_KEY) {
    stripeService = new StripeService(process.env.STRIPE_SECRET_KEY, auth);
    console.log('✅ Stripe service initialized');
  } else {
    console.log('⚠️  STRIPE_SECRET_KEY not set - Stripe features disabled');
  }

  // Attach middleware globally so req.user is populated on all routes
  app.use(auth.expressMiddleware());

  // Seed an admin user in dev if none exists
  if (process.env.NODE_ENV !== 'production') {
    const existing = await auth.getUserByEmail('admin@example.com');
    if (!existing) {
      await auth.createUser({
        email: 'admin@example.com',
        password: 'password123',
        username: 'admin',
        roles: ['admin'],
      });
      console.log('✅ Seeded admin user: admin@example.com / password123');
    }
  }

  console.log('✅ AuthKit initialized');
}

// ============================================================================
// ADMIN UI (served at /admin)
// ============================================================================

app.use('/admin', express.static(path.join(__dirname, 'client/dist')));

// ============================================================================
// HEALTH / INFO
// ============================================================================

app.get('/', (req, res) => {
  res.json({
    name: 'AuthKit',
    version: require('./package.json').version,
    status: 'ok',
    stripe_enabled: !!stripeService,
    admin_ui: '/admin',
    categories: {
      authentication: [
        'POST /auth/register',
        'POST /auth/login',
        'POST /auth/logout',
        'GET  /auth/me',
        'POST /auth/refresh',
        'POST /auth/change-password',
        'POST /auth/forgot-password',
        'POST /auth/reset-password',
      ],
      users: [
        'GET  /users              (admin)',
        'POST /users              (admin)',
        'GET  /users/:id          (admin)',
        'PATCH /users/:id         (admin)',
        'DELETE /users/:id        (admin)',
        'POST /users/:id/roles    (admin)',
        'DELETE /users/:id/roles/:role (admin)',
        'GET  /users/:id/api-keys',
        'POST /users/:id/api-keys',
        'DELETE /api-keys/:id',
      ],
      subscriptions: [
        'GET  /api/subscriptions/plans',
        'GET  /api/subscriptions/user/:userId',
        'GET  /api/subscriptions/user/:userId/features',
        'GET  /api/subscriptions/user/:userId/check-limit/:limitName',
        'POST /api/subscriptions/user/:userId/usage',
        'POST /api/subscriptions/subscribe',
        'POST /api/subscriptions/user/:userId/cancel',
        'POST /api/subscriptions/user/:userId/change-plan',
        'POST /api/subscriptions/user/:userId/stripe',
      ],
      stripe: [
        'POST /api/stripe/create-checkout',
        'POST /api/stripe/create-customer',
        'POST /api/stripe/cancel-subscription',
        'POST /api/stripe/update-payment-method',
        'POST /api/stripe/change-plan',
        'POST /webhooks/stripe',
      ],
    },
  });
});

// ============================================================================
// AUTH ROUTES
// ============================================================================

// Register
app.post('/auth/register', authLimiter, async (req, res, next) => {
  try {
    const { email, password, username } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: 'email and password are required' });
    }
    const user = await auth.createUser({ email, password, username, roles: ['member'] });
    const { token, expiresAt } = await auth.login(email, password);
    res.status(201).json({ user, token, expiresAt });
  } catch (err) {
    if (err.message.includes('already registered')) return res.status(409).json({ error: err.message });
    next(err);
  }
});

// Login
app.post('/auth/login', authLimiter, async (req, res, next) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: 'email and password are required' });
    }
    const result = await auth.login(email, password);
    res.json(result);
  } catch (err) {
    if (err.message.includes('Invalid email or password')) {
      return res.status(401).json({ error: err.message });
    }
    next(err);
  }
});

// Lazy-bind requireAuth since auth is not ready at route definition time
function requireAuth() {
  return (req, res, next) => auth.requireAuth()(req, res, next);
}
function requireRole(role) {
  return (req, res, next) => auth.requireRole(role)(req, res, next);
}

// Logout
app.post('/auth/logout', requireAuth(), async (req, res, next) => {
  try {
    const token = (req.headers['authorization'] || '').replace('Bearer ', '') ||
                  req.headers['x-api-key'] || '';
    await auth.logout(token);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// Get current user
app.get('/auth/me', requireAuth(), (req, res) => {
  res.json(req.user);
});

// Refresh token
app.post('/auth/refresh', requireAuth(), async (req, res, next) => {
  try {
    const token = (req.headers['authorization'] || '').replace('Bearer ', '');
    const result = await auth.refreshToken(token);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

// Change password
app.post('/auth/change-password', requireAuth(), async (req, res, next) => {
  try {
    const { oldPassword, newPassword } = req.body;
    if (!oldPassword || !newPassword) {
      return res.status(400).json({ error: 'oldPassword and newPassword are required' });
    }
    await auth.changePassword(req.user.id, oldPassword, newPassword);
    res.json({ ok: true });
  } catch (err) {
    if (err.message.includes('incorrect')) return res.status(400).json({ error: err.message });
    next(err);
  }
});

// Forgot password — always returns 200 to avoid email enumeration
app.post('/auth/forgot-password', authLimiter, async (req, res, next) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: 'email is required' });
    const token = await auth.generatePasswordResetToken(email);
    // In production: send token via email. For now, return it in the response.
    const payload = { ok: true };
    if (token) payload.reset_token = token; // omit in prod when email is wired up
    res.json(payload);
  } catch (err) {
    next(err);
  }
});

// Reset password with token
app.post('/auth/reset-password', authLimiter, async (req, res, next) => {
  try {
    const { token, newPassword } = req.body;
    if (!token || !newPassword) {
      return res.status(400).json({ error: 'token and newPassword are required' });
    }
    await auth.resetPasswordWithToken(token, newPassword);
    res.json({ ok: true });
  } catch (err) {
    if (err.message.includes('Invalid or expired')) return res.status(400).json({ error: err.message });
    next(err);
  }
});

// ============================================================================
// USER MANAGEMENT (admin only)
// ============================================================================

// List users
app.get('/users', requireRole('admin'), async (req, res, next) => {
  try {
    const { role, keyword } = req.query;
    const users = await auth.listUsers({ role, keyword });
    res.json({ users });
  } catch (err) {
    next(err);
  }
});

// Get user
app.get('/users/:id', requireRole('admin'), async (req, res, next) => {
  try {
    const user = await auth.getUser(req.params.id);
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json(user);
  } catch (err) {
    next(err);
  }
});

// Create user (admin)
app.post('/users', requireRole('admin'), async (req, res, next) => {
  try {
    const { email, password, username, roles, metadata } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: 'email and password are required' });
    }
    const user = await auth.createUser({ email, password, username, roles, metadata });
    res.status(201).json(user);
  } catch (err) {
    if (err.message.includes('already registered')) return res.status(409).json({ error: err.message });
    next(err);
  }
});

// Update user
app.patch('/users/:id', requireRole('admin'), async (req, res, next) => {
  try {
    const user = await auth.updateUser(req.params.id, req.body);
    res.json(user);
  } catch (err) {
    if (err.message.includes('not found')) return res.status(404).json({ error: err.message });
    next(err);
  }
});

// Delete user
app.delete('/users/:id', requireRole('admin'), async (req, res, next) => {
  try {
    await auth.deleteUser(req.params.id);
    res.status(204).send();
  } catch (err) {
    if (err.message.includes('not found')) return res.status(404).json({ error: err.message });
    next(err);
  }
});

// Reset password (admin)
app.post('/users/:id/reset-password', requireRole('admin'), async (req, res, next) => {
  try {
    const { newPassword } = req.body;
    if (!newPassword) return res.status(400).json({ error: 'newPassword is required' });
    await auth.resetPassword(req.params.id, newPassword);
    res.json({ ok: true });
  } catch (err) {
    if (err.message.includes('not found')) return res.status(404).json({ error: err.message });
    next(err);
  }
});

// ============================================================================
// ROLES
// ============================================================================

// Assign role
app.post('/users/:id/roles', requireRole('admin'), async (req, res, next) => {
  try {
    const { role } = req.body;
    if (!role) return res.status(400).json({ error: 'role is required' });
    const user = await auth.assignRole(req.params.id, role);
    res.json(user);
  } catch (err) {
    next(err);
  }
});

// Remove role
app.delete('/users/:id/roles/:role', requireRole('admin'), async (req, res, next) => {
  try {
    const user = await auth.removeRole(req.params.id, req.params.role);
    res.json(user);
  } catch (err) {
    next(err);
  }
});

// ============================================================================
// API KEYS
// ============================================================================

// List API keys for a user
app.get('/users/:id/api-keys', requireAuth(), async (req, res, next) => {
  try {
    // users can only see their own keys, admins can see anyone's
    if (req.params.id !== req.user.id && !auth.hasRole(req.user, 'admin')) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    const keys = await auth.listAPIKeys(req.params.id);
    res.json({ keys });
  } catch (err) {
    next(err);
  }
});

// Create API key
app.post('/users/:id/api-keys', requireAuth(), async (req, res, next) => {
  try {
    if (req.params.id !== req.user.id && !auth.hasRole(req.user, 'admin')) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    const { name, expiresAt } = req.body;
    const result = await auth.createAPIKey(req.params.id, { name, expiresAt });
    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
});

// Revoke API key
app.delete('/api-keys/:id', requireAuth(), async (req, res, next) => {
  try {
    await auth.revokeAPIKey(req.params.id);
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

// ============================================================================
// SUBSCRIPTIONS
// ============================================================================

// Get all subscription plans
app.get('/api/subscriptions/plans', async (req, res, next) => {
  try {
    const activeOnly = req.query.activeOnly === 'true';
    const plans = await auth.getPlans(activeOnly);
    res.json(plans);
  } catch (err) {
    next(err);
  }
});

// Get user's active subscription
app.get('/api/subscriptions/user/:userId', requireAuth(), async (req, res, next) => {
  try {
    const subscription = await auth.getSubscription(req.params.userId);
    res.json(subscription || { subscription: null });
  } catch (err) {
    next(err);
  }
});

// Get user's subscription features
app.get('/api/subscriptions/user/:userId/features', requireAuth(), async (req, res, next) => {
  try {
    const features = await auth.getFeatures(req.params.userId);
    res.json({ features });
  } catch (err) {
    next(err);
  }
});

// Check if user has exceeded a limit
app.get('/api/subscriptions/user/:userId/check-limit/:limitName', requireAuth(), async (req, res, next) => {
  try {
    const withinLimit = await auth.checkLimit(req.params.userId, req.params.limitName);
    res.json({ withinLimit });
  } catch (err) {
    next(err);
  }
});

// Increment usage for a user
app.post('/api/subscriptions/user/:userId/usage', requireAuth(), async (req, res, next) => {
  try {
    const { usageType, amount = 1 } = req.body;
    const usage = await auth.incrementUsage(req.params.userId, usageType, amount);
    res.json(usage);
  } catch (err) {
    next(err);
  }
});

// Subscribe a user to a plan
app.post('/api/subscriptions/subscribe', requireAuth(), async (req, res, next) => {
  try {
    const { userId, planIdOrName, billing_cycle, trial_days, stripe_customer_id, stripe_subscription_id } = req.body;
    const subscription = await auth.subscribe(userId, planIdOrName, {
      billing_cycle,
      trial_days,
      stripe_customer_id,
      stripe_subscription_id,
    });
    res.json(subscription);
  } catch (err) {
    next(err);
  }
});

// Cancel a subscription
app.post('/api/subscriptions/user/:userId/cancel', requireAuth(), async (req, res, next) => {
  try {
    const { immediately = false } = req.body;
    const subscription = await auth.cancelSubscription(req.params.userId, immediately);
    res.json(subscription);
  } catch (err) {
    next(err);
  }
});

// Change subscription plan
app.post('/api/subscriptions/user/:userId/change-plan', requireAuth(), async (req, res, next) => {
  try {
    const { newPlanIdOrName, billing_cycle, prorate } = req.body;
    const subscription = await auth.changePlan(req.params.userId, newPlanIdOrName, {
      billing_cycle,
      prorate,
    });
    res.json(subscription);
  } catch (err) {
    next(err);
  }
});

// Update Stripe data for a subscription
app.post('/api/subscriptions/user/:userId/stripe', requireAuth(), async (req, res, next) => {
  try {
    const { stripe_customer_id, stripe_subscription_id, stripe_latest_invoice_id, stripe_payment_intent_status, status } = req.body;
    const subscription = await auth.updateStripeData(req.params.userId, {
      stripe_customer_id,
      stripe_subscription_id,
      stripe_latest_invoice_id,
      stripe_payment_intent_status,
      status,
    });
    res.json(subscription);
  } catch (err) {
    next(err);
  }
});

// ============================================================================
// STRIPE INTEGRATION (Centralized Payment Processing)
// ============================================================================

// Create Stripe checkout session
app.post('/api/stripe/create-checkout', requireAuth(), async (req, res, next) => {
  try {
    if (!stripeService) {
      return res.status(503).json({ error: 'Stripe service not configured' });
    }

    const { userId, planIdOrName, billing_cycle = 'monthly', trial_days = 0 } = req.body;

    const result = await stripeService.createSubscription(userId, planIdOrName, {
      billing_cycle,
      trial_days,
    });

    res.json({
      stripe: result.stripe,
      subscription: result.authkit,
    });
  } catch (err) {
    next(err);
  }
});

// Create Stripe customer
app.post('/api/stripe/create-customer', requireAuth(), async (req, res, next) => {
  try {
    if (!stripeService) {
      return res.status(503).json({ error: 'Stripe service not configured' });
    }

    const { userId, email, metadata = {} } = req.body;
    const customer = await stripeService.createCustomer(userId, email, metadata);

    res.json(customer);
  } catch (err) {
    next(err);
  }
});

// Cancel Stripe subscription
app.post('/api/stripe/cancel-subscription', requireAuth(), async (req, res, next) => {
  try {
    if (!stripeService) {
      return res.status(503).json({ error: 'Stripe service not configured' });
    }

    const { userId, immediately = false } = req.body;
    const subscription = await stripeService.cancelSubscription(userId, immediately);

    res.json(subscription);
  } catch (err) {
    next(err);
  }
});

// Update payment method
app.post('/api/stripe/update-payment-method', requireAuth(), async (req, res, next) => {
  try {
    if (!stripeService) {
      return res.status(503).json({ error: 'Stripe service not configured' });
    }

    const { userId, paymentMethodId } = req.body;
    const result = await stripeService.updatePaymentMethod(userId, paymentMethodId);

    res.json(result);
  } catch (err) {
    next(err);
  }
});

// Change subscription plan
app.post('/api/stripe/change-plan', requireAuth(), async (req, res, next) => {
  try {
    if (!stripeService) {
      return res.status(503).json({ error: 'Stripe service not configured' });
    }

    const { userId, newPlanIdOrName, billing_cycle, prorate = true } = req.body;
    const subscription = await stripeService.changePlan(userId, newPlanIdOrName, {
      billing_cycle,
      prorate,
    });

    res.json(subscription);
  } catch (err) {
    next(err);
  }
});

// Stripe webhook handler (MUST receive raw body for signature verification)
app.post('/webhooks/stripe', express.raw({ type: 'application/json' }), async (req, res) => {
  if (!stripeService) {
    console.error('Stripe webhook received but service not configured');
    return res.status(503).json({ error: 'Stripe service not configured' });
  }

  const sig = req.headers['stripe-signature'];
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  if (!webhookSecret) {
    console.error('STRIPE_WEBHOOK_SECRET not set');
    return res.status(500).json({ error: 'Webhook secret not configured' });
  }

  try {
    // Verify and construct event
    const event = stripeService.verifyWebhookSignature(
      req.body,
      sig,
      webhookSecret
    );

    console.log(`✅ Stripe webhook received: ${event.type}`);

    // Handle the event
    const result = await stripeService.handleWebhook(event);

    res.json(result);
  } catch (err) {
    console.error(`❌ Webhook error: ${err.message}`);
    res.status(400).send(`Webhook Error: ${err.message}`);
  }
});

// ============================================================================
// ERROR HANDLING
// ============================================================================

app.use((err, req, res, next) => {
  console.error('Error:', err.message);
  res.status(500).json({ error: err.message });
});

// ============================================================================
// START
// ============================================================================

init().then(() => {
  app.listen(PORT, () => {
    console.log(`\n🔐 AuthKit REST API Server`);
    console.log(`📡 Listening on http://localhost:${PORT}`);
    console.log(`\n📚 Endpoints:`);
    console.log(`   POST   /auth/register`);
    console.log(`   POST   /auth/login`);
    console.log(`   POST   /auth/logout`);
    console.log(`   GET    /auth/me`);
    console.log(`   POST   /auth/refresh`);
    console.log(`   POST   /auth/change-password`);
    console.log(`   POST   /auth/forgot-password`);
    console.log(`   POST   /auth/reset-password`);
    console.log(`   GET    /users              (admin)`);
    console.log(`   POST   /users              (admin)`);
    console.log(`   PATCH  /users/:id          (admin)`);
    console.log(`   DELETE /users/:id          (admin)`);
    console.log(`   POST   /users/:id/roles    (admin)`);
    console.log(`   GET    /users/:id/api-keys`);
    console.log(`   POST   /users/:id/api-keys`);
    console.log(`   DELETE /api-keys/:id`);
    console.log(`\n`);
  });
}).catch(err => {
  console.error('Failed to initialize:', err);
  process.exit(1);
});
