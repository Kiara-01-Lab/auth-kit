/**
 * AuthKit - Simple REST API Server
 *
 * Demonstrates AuthKit as a standalone auth service.
 * Mount behind your app or run as a sidecar.
 */

const express = require('express');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const { AuthKit } = require('./index.js');

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

async function init() {
  auth = await AuthKit.create({
    storage: process.env.AUTH_DB ? 'file' : 'memory',
    filename: process.env.AUTH_DB || undefined,
    tokenExpiry: process.env.TOKEN_EXPIRY || '7d',
    roles: {
      admin: ['*'],
      member: ['read', 'write'],
      viewer: ['read'],
    },
  });

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
