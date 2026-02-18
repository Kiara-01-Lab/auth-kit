# AuthKit

A lightweight, embeddable authentication SDK for Node.js. Add users, sessions, API keys, and role-based access control (RBAC) to any app — no vendor lock-in, no cloud dependency.

- **Storage options:** In-memory, SQLite (file), PostgreSQL
- **Runs anywhere:** localhost, Docker, Railway, Render, Fly.io, any VPS
- **Use as:** an npm SDK embedded in your app, or a standalone REST service

---

## Table of Contents

- [Quick Start (SDK)](#quick-start-sdk)
- [Run as a REST Server (localhost)](#run-as-a-rest-server-localhost)
- [Environment Variables](#environment-variables)
- [Storage Backends](#storage-backends)
- [Deploy with Docker](#deploy-with-docker)
- [Deploy to a Server (VPS / Railway / Render)](#deploy-to-a-server)
- [SDK Reference](#sdk-reference)
- [REST API Reference](#rest-api-reference)

---

## Quick Start (SDK)

Install the package:

```bash
npm install authkit
```

Use it in your app:

```js
const { AuthKit } = require('authkit');

const auth = await AuthKit.create();

// Create a user
const user = await auth.createUser({
  email: 'alice@example.com',
  password: 'secret123',
});

// Login
const { token, expiresAt } = await auth.login('alice@example.com', 'secret123');

// Verify a token
const user = await auth.verifyToken(token);

// Logout
await auth.logout(token);
```

---

## Run as a REST Server (localhost)

### 1. Clone the repo

```bash
git clone git@github.com:Kiara-02-Lab-OW/auth-kit.git
cd auth-kit
```

### 2. Install dependencies

```bash
npm install
```

### 3. Start the server

```bash
npm run server
```

The server starts on `http://localhost:3001`.

In development mode a seed admin user is created automatically:

```
Email:    admin@example.com
Password: password123
```

### 4. Test it

```bash
# Register
curl -X POST http://localhost:3001/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"you@example.com","password":"mypassword"}'

# Login
curl -X POST http://localhost:3001/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"you@example.com","password":"mypassword"}'

# Get current user (use token from login response)
curl http://localhost:3001/auth/me \
  -H "Authorization: Bearer <token>"
```

---

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `PORT` | `3001` | Port the server listens on |
| `NODE_ENV` | `development` | Set to `production` to disable seed user |
| `DATABASE_URL` | — | PostgreSQL connection string (enables PostgreSQL storage) |
| `AUTH_DB` | — | Path to SQLite file e.g. `./auth.db` (enables file storage) |
| `TOKEN_EXPIRY` | `7d` | Token expiry e.g. `1h`, `24h`, `30d` |

### Storage selection priority

1. `DATABASE_URL` set → PostgreSQL
2. `AUTH_DB` set → SQLite file
3. Neither → In-memory (data lost on restart, good for dev/testing)

---

## Storage Backends

### In-memory (default, dev/testing)

```js
const auth = await AuthKit.create();
```

### SQLite (single-server, persistent)

```js
const auth = await AuthKit.create({
  storage: 'file',
  filename: './auth.db',
});
```

### PostgreSQL (production, cloud)

```js
const auth = await AuthKit.create({
  connectionString: 'postgresql://user:password@localhost:5432/mydb',
});
```

Or via environment variable:

```bash
DATABASE_URL=postgresql://user:password@host/db npm run server
```

SSL is automatically enabled for Supabase, AWS RDS, Neon, and Railway connection strings. For any other host with SSL, append `?sslmode=require` to the connection string.

---

## Deploy with Docker

### Build and run locally

```bash
docker build -t authkit .

# In-memory (dev)
docker run -p 3001:3001 authkit

# With PostgreSQL
docker run -p 3001:3001 \
  -e DATABASE_URL=postgresql://user:pass@host/db \
  -e NODE_ENV=production \
  authkit

# With SQLite file (persisted via volume)
docker run -p 3001:3001 \
  -e AUTH_DB=/data/auth.db \
  -v $(pwd)/data:/data \
  authkit
```

### docker-compose example

```yaml
version: '3.8'
services:
  authkit:
    build: .
    ports:
      - "3001:3001"
    environment:
      - NODE_ENV=production
      - DATABASE_URL=postgresql://postgres:password@db:5432/authkit
    depends_on:
      - db

  db:
    image: postgres:16-alpine
    environment:
      POSTGRES_DB: authkit
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: password
    volumes:
      - pgdata:/var/lib/postgresql/data

volumes:
  pgdata:
```

---

## Deploy to a Server

### Railway

1. Push code to GitHub
2. Create a new project at [railway.app](https://railway.app) → Deploy from GitHub
3. Add a PostgreSQL database from the Railway dashboard
4. Set `DATABASE_URL` (Railway injects this automatically when you link the database)
5. Set `NODE_ENV=production`

### Render

1. Push code to GitHub
2. Create a new **Web Service** at [render.com](https://render.com)
3. Set build command: `npm install`
4. Set start command: `node server.js`
5. Add environment variables: `DATABASE_URL`, `NODE_ENV=production`

### Fly.io

```bash
fly launch
fly postgres create
fly postgres attach
fly deploy
```

### VPS (Ubuntu)

```bash
# Install Node.js
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs

# Clone and install
git clone git@github.com:Kiara-02-Lab-OW/auth-kit.git
cd auth-kit
npm install --omit=dev

# Run with PM2
npm install -g pm2
DATABASE_URL=postgresql://... NODE_ENV=production pm2 start server.js --name authkit
pm2 save
pm2 startup
```

---

## SDK Reference

### Setup

```js
const { AuthKit, SQLiteAdapter, PostgreSQLAdapter } = require('authkit');

// In-memory
const auth = await AuthKit.create();

// SQLite
const auth = await AuthKit.create({ storage: 'file', filename: './auth.db' });

// PostgreSQL
const auth = await AuthKit.create({ connectionString: process.env.DATABASE_URL });

// Custom config
const auth = await AuthKit.create({
  tokenExpiry: '24h',
  passwordPolicy: {
    minLength: 10,
    requireUppercase: true,
    requireNumbers: true,
  },
  roles: {
    admin:  ['*'],
    editor: ['read', 'write'],
    viewer: ['read'],
  },
});
```

### Users

```js
// Create
const user = await auth.createUser({ email, password, username, roles, metadata });

// Read
const user = await auth.getUser(id);
const user = await auth.getUserByEmail('alice@example.com');
const users = await auth.listUsers({ role: 'admin', keyword: 'alice' });

// Update
const user = await auth.updateUser(id, { username: 'new-name', is_active: false });

// Delete
await auth.deleteUser(id);
```

### Authentication

```js
// Login — returns { user, token, expiresAt }
const { user, token, expiresAt } = await auth.login(email, password);

// Verify token — returns user or null
const user = await auth.verifyToken(token);

// Refresh — returns { token, expiresAt }
const { token, expiresAt } = await auth.refreshToken(oldToken);

// Logout
await auth.logout(token);

// Change password (requires old password, invalidates all sessions)
await auth.changePassword(userId, oldPassword, newPassword);

// Reset password (admin action, no old password needed)
await auth.resetPassword(userId, newPassword);
```

### API Keys

```js
// Create — returns { key, record } — key is shown only once
const { key, record } = await auth.createAPIKey(userId, { name: 'CI key', expiresAt: null });

// List (hashes are never exposed)
const keys = await auth.listAPIKeys(userId);

// Revoke
await auth.revokeAPIKey(keyId);
```

API keys can be used anywhere a session token is accepted (via `x-api-key` header or `Authorization: Bearer ak_...`).

### Roles & Permissions

```js
// Assign / remove
await auth.assignRole(userId, 'editor');
await auth.removeRole(userId, 'viewer');

// Check
auth.hasRole(user, 'admin');           // true / false
auth.hasPermission(user, 'write');     // true / false (uses roles config)
```

### Express Middleware

```js
const express = require('express');
const app = express();

// Populate req.user on all routes (does not block)
app.use(auth.expressMiddleware());

// Require authentication
app.get('/profile', auth.requireAuth(), (req, res) => {
  res.json(req.user);
});

// Require a role
app.get('/admin', auth.requireRole('admin'), (req, res) => {
  res.json({ ok: true });
});

// Require a permission
app.post('/posts', auth.requirePermission('write'), handler);
```

### Events

```js
auth.on('user:created',        ({ id, email }) => {});
auth.on('user:login',          ({ user }) => {});
auth.on('user:failed_login',   ({ email }) => {});
auth.on('user:logout',         ({ user_id }) => {});
auth.on('user:password_changed', ({ user_id }) => {});
auth.on('user:deleted',        ({ id }) => {});
auth.on('token:expired',       ({ user_id }) => {});
auth.on('apikey:created',      ({ user_id, name }) => {});
auth.on('apikey:revoked',      ({ id }) => {});
```

### Custom Storage Adapter

Implement the `StorageAdapter` interface to use any database:

```js
const { StorageAdapter, AuthKit } = require('authkit');

class MyAdapter extends StorageAdapter {
  async init() { /* connect */ }
  async close() { /* disconnect */ }
  async createUser(data) { /* ... */ }
  async getUser(id) { /* ... */ }
  // ... implement all methods
}

const auth = await AuthKit.create({ adapter: new MyAdapter() });
```

---

## REST API Reference

All authenticated endpoints require:
```
Authorization: Bearer <token>
```
or
```
x-api-key: ak_...
```

### Auth

| Method | Path | Auth | Description |
|---|---|---|---|
| `POST` | `/auth/register` | No | Register and auto-login |
| `POST` | `/auth/login` | No | Login |
| `POST` | `/auth/logout` | Yes | Logout (invalidate token) |
| `GET` | `/auth/me` | Yes | Get current user |
| `POST` | `/auth/refresh` | Yes | Refresh token |
| `POST` | `/auth/change-password` | Yes | Change own password |

### Users (admin only)

| Method | Path | Description |
|---|---|---|
| `GET` | `/users` | List users (`?role=admin&keyword=alice`) |
| `GET` | `/users/:id` | Get user |
| `POST` | `/users` | Create user |
| `PATCH` | `/users/:id` | Update user |
| `DELETE` | `/users/:id` | Delete user |
| `POST` | `/users/:id/reset-password` | Reset user password |
| `POST` | `/users/:id/roles` | Assign role |
| `DELETE` | `/users/:id/roles/:role` | Remove role |

### API Keys

| Method | Path | Auth | Description |
|---|---|---|---|
| `GET` | `/users/:id/api-keys` | Self or admin | List API keys |
| `POST` | `/users/:id/api-keys` | Self or admin | Create API key |
| `DELETE` | `/api-keys/:id` | Yes | Revoke API key |

---

## License

MIT
>>>>>>> 95556f0 (add README with setup and usage guide)
