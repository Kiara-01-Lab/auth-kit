/**
 * AuthKit - A simple, flexible authentication SDK
 * Add users, sessions, API keys, and RBAC to any Node.js app
 *
 * MIT License
 */

const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');
const { nanoid } = require('nanoid');
const EventEmitter = require('events');

// ============================================================================
// CONSTANTS
// ============================================================================

const TOKEN_EXPIRY_DEFAULT = 7 * 24 * 60 * 60 * 1000; // 7 days in ms
const API_KEY_PREFIX = 'ak_';
const PBKDF2_ITERATIONS = 100000;
const PBKDF2_KEYLEN = 64;
const PBKDF2_DIGEST = 'sha512';

// ============================================================================
// HELPERS
// ============================================================================

function hashPassword(password) {
  const salt = crypto.randomBytes(32).toString('hex');
  const hash = crypto
    .pbkdf2Sync(password, salt, PBKDF2_ITERATIONS, PBKDF2_KEYLEN, PBKDF2_DIGEST)
    .toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  const [salt, hash] = stored.split(':');
  const candidate = crypto
    .pbkdf2Sync(password, salt, PBKDF2_ITERATIONS, PBKDF2_KEYLEN, PBKDF2_DIGEST)
    .toString('hex');
  return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(candidate, 'hex'));
}

function generateToken() {
  return uuidv4().replace(/-/g, '') + uuidv4().replace(/-/g, '');
}

function generateAPIKey() {
  return API_KEY_PREFIX + nanoid(32);
}

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function parseExpiry(expiry) {
  if (typeof expiry === 'number') return expiry;
  const units = { s: 1000, m: 60000, h: 3600000, d: 86400000, w: 604800000 };
  const match = String(expiry).match(/^(\d+)([smhdw])$/);
  if (!match) return TOKEN_EXPIRY_DEFAULT;
  return parseInt(match[1]) * units[match[2]];
}

function sanitizeUser(user) {
  const { password_hash, ...safe } = user;
  return safe;
}

// ============================================================================
// STORAGE ADAPTER (Abstract Base)
// ============================================================================

class StorageAdapter {
  async init() { throw new Error('Not implemented'); }
  async close() { throw new Error('Not implemented'); }
  async createUser(data) { throw new Error('Not implemented'); }
  async getUser(id) { throw new Error('Not implemented'); }
  async getUserByEmail(email) { throw new Error('Not implemented'); }
  async listUsers(query) { throw new Error('Not implemented'); }
  async updateUser(id, updates) { throw new Error('Not implemented'); }
  async deleteUser(id) { throw new Error('Not implemented'); }
  async createToken(data) { throw new Error('Not implemented'); }
  async getToken(tokenHash) { throw new Error('Not implemented'); }
  async deleteToken(tokenHash) { throw new Error('Not implemented'); }
  async deleteUserTokens(userId) { throw new Error('Not implemented'); }
  async updateTokenLastUsed(tokenHash) { throw new Error('Not implemented'); }
  async createAPIKey(data) { throw new Error('Not implemented'); }
  async getAPIKey(keyHash) { throw new Error('Not implemented'); }
  async listAPIKeys(userId) { throw new Error('Not implemented'); }
  async deleteAPIKey(id) { throw new Error('Not implemented'); }
  async updateAPIKeyLastUsed(keyHash) { throw new Error('Not implemented'); }
}

// ============================================================================
// MEMORY ADAPTER
// ============================================================================

class MemoryAdapter {
  constructor() {
    this.users = new Map();
    this.tokens = new Map();    // token_hash -> token record
    this.apiKeys = new Map();   // key_hash -> api key record
  }

  async init() { return this; }
  async close() {}

  // --- Users ---
  async createUser(data) {
    this.users.set(data.id, { ...data });
    return { ...data };
  }

  async getUser(id) {
    const u = this.users.get(id);
    return u ? { ...u } : null;
  }

  async getUserByEmail(email) {
    for (const u of this.users.values()) {
      if (u.email.toLowerCase() === email.toLowerCase()) return { ...u };
    }
    return null;
  }

  async listUsers(query = {}) {
    let users = Array.from(this.users.values());
    if (query.role) {
      users = users.filter(u => u.roles && u.roles.includes(query.role));
    }
    if (query.keyword) {
      const kw = query.keyword.toLowerCase();
      users = users.filter(u =>
        u.email.toLowerCase().includes(kw) ||
        (u.username && u.username.toLowerCase().includes(kw))
      );
    }
    return users.map(u => ({ ...u }));
  }

  async updateUser(id, updates) {
    const user = this.users.get(id);
    if (!user) return null;
    const updated = { ...user, ...updates, updated_at: new Date().toISOString() };
    this.users.set(id, updated);
    return { ...updated };
  }

  async deleteUser(id) {
    this.users.delete(id);
    // clean up tokens and api keys
    for (const [hash, t] of this.tokens.entries()) {
      if (t.user_id === id) this.tokens.delete(hash);
    }
    for (const [hash, k] of this.apiKeys.entries()) {
      if (k.user_id === id) this.apiKeys.delete(hash);
    }
  }

  // --- Tokens ---
  async createToken(data) {
    this.tokens.set(data.token_hash, { ...data });
    return { ...data };
  }

  async getToken(tokenHash) {
    const t = this.tokens.get(tokenHash);
    return t ? { ...t } : null;
  }

  async deleteToken(tokenHash) {
    this.tokens.delete(tokenHash);
  }

  async deleteUserTokens(userId) {
    for (const [hash, t] of this.tokens.entries()) {
      if (t.user_id === userId) this.tokens.delete(hash);
    }
  }

  async updateTokenLastUsed(tokenHash) {
    const t = this.tokens.get(tokenHash);
    if (t) {
      t.last_used_at = new Date().toISOString();
      this.tokens.set(tokenHash, t);
    }
  }

  // --- API Keys ---
  async createAPIKey(data) {
    this.apiKeys.set(data.key_hash, { ...data });
    return { ...data };
  }

  async getAPIKey(keyHash) {
    const k = this.apiKeys.get(keyHash);
    return k ? { ...k } : null;
  }

  async listAPIKeys(userId) {
    const keys = [];
    for (const k of this.apiKeys.values()) {
      if (k.user_id === userId) keys.push({ ...k });
    }
    return keys;
  }

  async deleteAPIKey(id) {
    for (const [hash, k] of this.apiKeys.entries()) {
      if (k.id === id) { this.apiKeys.delete(hash); return; }
    }
  }

  async updateAPIKeyLastUsed(keyHash) {
    const k = this.apiKeys.get(keyHash);
    if (k) {
      k.last_used_at = new Date().toISOString();
      this.apiKeys.set(keyHash, k);
    }
  }
}

// ============================================================================
// SQLITE ADAPTER
// ============================================================================

class SQLiteAdapter {
  constructor(dbPath) {
    this.dbPath = dbPath || null;
    this.db = null;
  }

  async init() {
    const initSqlJs = require('sql.js');
    const SQL = await initSqlJs();
    const fs = require('fs');

    if (this.dbPath && fs.existsSync(this.dbPath)) {
      const fileBuffer = fs.readFileSync(this.dbPath);
      this.db = new SQL.Database(fileBuffer);
    } else {
      this.db = new SQL.Database();
    }

    this._migrate();
    return this;
  }

  _migrate() {
    this.db.run(`
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        email TEXT UNIQUE NOT NULL,
        username TEXT,
        password_hash TEXT NOT NULL,
        roles TEXT NOT NULL DEFAULT '[]',
        metadata TEXT NOT NULL DEFAULT '{}',
        is_active INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        last_login_at TEXT
      )
    `);

    this.db.run(`
      CREATE TABLE IF NOT EXISTS tokens (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        token_hash TEXT UNIQUE NOT NULL,
        token_type TEXT NOT NULL DEFAULT 'session',
        expires_at TEXT,
        created_at TEXT NOT NULL,
        last_used_at TEXT,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      )
    `);

    this.db.run(`
      CREATE TABLE IF NOT EXISTS api_keys (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        key_hash TEXT UNIQUE NOT NULL,
        name TEXT,
        expires_at TEXT,
        created_at TEXT NOT NULL,
        last_used_at TEXT,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      )
    `);
  }

  _persist() {
    if (this.dbPath) {
      const fs = require('fs');
      const data = this.db.export();
      fs.writeFileSync(this.dbPath, Buffer.from(data));
    }
  }

  _row(row) {
    if (!row) return null;
    const obj = {};
    row.columns.forEach((col, i) => { obj[col] = row.values[0][i]; });
    if (obj.roles) obj.roles = JSON.parse(obj.roles);
    if (obj.metadata) obj.metadata = JSON.parse(obj.metadata);
    if (obj.is_active !== undefined) obj.is_active = obj.is_active === 1;
    return obj;
  }

  _rows(result) {
    if (!result || !result[0]) return [];
    return result[0].values.map(vals => {
      const obj = {};
      result[0].columns.forEach((col, i) => { obj[col] = vals[i]; });
      if (obj.roles) obj.roles = JSON.parse(obj.roles);
      if (obj.metadata) obj.metadata = JSON.parse(obj.metadata);
      if (obj.is_active !== undefined) obj.is_active = obj.is_active === 1;
      return obj;
    });
  }

  async close() {
    this._persist();
    if (this.db) this.db.close();
  }

  // --- Users ---
  async createUser(data) {
    this.db.run(
      `INSERT INTO users (id, email, username, password_hash, roles, metadata, is_active, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [data.id, data.email, data.username || null, data.password_hash,
       JSON.stringify(data.roles || []), JSON.stringify(data.metadata || {}),
       1, data.created_at, data.updated_at]
    );
    this._persist();
    return this.getUser(data.id);
  }

  async getUser(id) {
    const res = this.db.exec('SELECT * FROM users WHERE id = ?', [id]);
    return this._rows(res)[0] || null;
  }

  async getUserByEmail(email) {
    const res = this.db.exec('SELECT * FROM users WHERE LOWER(email) = LOWER(?)', [email]);
    return this._rows(res)[0] || null;
  }

  async listUsers(query = {}) {
    let sql = 'SELECT * FROM users WHERE 1=1';
    const params = [];
    if (query.keyword) {
      sql += ' AND (LOWER(email) LIKE ? OR LOWER(username) LIKE ?)';
      params.push(`%${query.keyword.toLowerCase()}%`, `%${query.keyword.toLowerCase()}%`);
    }
    sql += ' ORDER BY created_at DESC';
    const res = this.db.exec(sql, params);
    let users = this._rows(res);
    if (query.role) {
      users = users.filter(u => u.roles && u.roles.includes(query.role));
    }
    return users;
  }

  async updateUser(id, updates) {
    const user = await this.getUser(id);
    if (!user) return null;
    const merged = { ...user, ...updates, updated_at: new Date().toISOString() };
    this.db.run(
      `UPDATE users SET email=?, username=?, password_hash=?, roles=?, metadata=?, is_active=?, updated_at=?, last_login_at=? WHERE id=?`,
      [merged.email, merged.username || null, merged.password_hash,
       JSON.stringify(merged.roles || []), JSON.stringify(merged.metadata || {}),
       merged.is_active ? 1 : 0, merged.updated_at, merged.last_login_at || null, id]
    );
    this._persist();
    return this.getUser(id);
  }

  async deleteUser(id) {
    this.db.run('DELETE FROM users WHERE id = ?', [id]);
    this._persist();
  }

  // --- Tokens ---
  async createToken(data) {
    this.db.run(
      `INSERT INTO tokens (id, user_id, token_hash, token_type, expires_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [data.id, data.user_id, data.token_hash, data.token_type || 'session',
       data.expires_at || null, data.created_at]
    );
    this._persist();
    return data;
  }

  async getToken(tokenHash) {
    const res = this.db.exec('SELECT * FROM tokens WHERE token_hash = ?', [tokenHash]);
    return this._rows(res)[0] || null;
  }

  async deleteToken(tokenHash) {
    this.db.run('DELETE FROM tokens WHERE token_hash = ?', [tokenHash]);
    this._persist();
  }

  async deleteUserTokens(userId) {
    this.db.run('DELETE FROM tokens WHERE user_id = ?', [userId]);
    this._persist();
  }

  async updateTokenLastUsed(tokenHash) {
    this.db.run('UPDATE tokens SET last_used_at = ? WHERE token_hash = ?',
      [new Date().toISOString(), tokenHash]);
    this._persist();
  }

  // --- API Keys ---
  async createAPIKey(data) {
    this.db.run(
      `INSERT INTO api_keys (id, user_id, key_hash, name, expires_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [data.id, data.user_id, data.key_hash, data.name || null,
       data.expires_at || null, data.created_at]
    );
    this._persist();
    return data;
  }

  async getAPIKey(keyHash) {
    const res = this.db.exec('SELECT * FROM api_keys WHERE key_hash = ?', [keyHash]);
    return this._rows(res)[0] || null;
  }

  async listAPIKeys(userId) {
    const res = this.db.exec(
      'SELECT * FROM api_keys WHERE user_id = ? ORDER BY created_at DESC', [userId]);
    return this._rows(res);
  }

  async deleteAPIKey(id) {
    this.db.run('DELETE FROM api_keys WHERE id = ?', [id]);
    this._persist();
  }

  async updateAPIKeyLastUsed(keyHash) {
    this.db.run('UPDATE api_keys SET last_used_at = ? WHERE key_hash = ?',
      [new Date().toISOString(), keyHash]);
    this._persist();
  }
}

// ============================================================================
// POSTGRESQL ADAPTER
// ============================================================================

class PostgreSQLAdapter extends StorageAdapter {
  constructor(connectionString) {
    super();
    this.connectionString = connectionString;
    this.pool = null;
  }

  async init() {
    const { Pool } = require('pg');

    const needsSSL = this.connectionString.includes('sslmode=require') ||
                     this.connectionString.includes('.supabase.com') ||
                     this.connectionString.includes('.amazonaws.com') ||
                     this.connectionString.includes('.neon.tech') ||
                     this.connectionString.includes('.railway.app');

    let connString = this.connectionString;
    if (needsSSL && connString.includes('?')) {
      const [baseUrl, queryString] = connString.split('?');
      const params = new URLSearchParams(queryString);
      params.delete('sslmode');
      params.delete('supa');
      const remaining = params.toString();
      connString = remaining ? `${baseUrl}?${remaining}` : baseUrl;
    }

    this.pool = new Pool({
      connectionString: connString,
      ssl: needsSSL ? { rejectUnauthorized: false } : false,
    });

    await this._migrate();
    return this;
  }

  async _migrate() {
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        email TEXT UNIQUE NOT NULL,
        username TEXT,
        password_hash TEXT NOT NULL,
        roles JSONB NOT NULL DEFAULT '[]',
        metadata JSONB NOT NULL DEFAULT '{}',
        is_active BOOLEAN NOT NULL DEFAULT TRUE,
        created_at TIMESTAMPTZ NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL,
        last_login_at TIMESTAMPTZ
      );

      CREATE TABLE IF NOT EXISTS tokens (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        token_hash TEXT UNIQUE NOT NULL,
        token_type TEXT NOT NULL DEFAULT 'session',
        expires_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL,
        last_used_at TIMESTAMPTZ
      );

      CREATE TABLE IF NOT EXISTS api_keys (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        key_hash TEXT UNIQUE NOT NULL,
        name TEXT,
        expires_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL,
        last_used_at TIMESTAMPTZ
      );
    `);

    await this.pool.query(`
      CREATE INDEX IF NOT EXISTS idx_users_email ON users(LOWER(email));
      CREATE INDEX IF NOT EXISTS idx_tokens_user ON tokens(user_id);
      CREATE INDEX IF NOT EXISTS idx_tokens_hash ON tokens(token_hash);
      CREATE INDEX IF NOT EXISTS idx_apikeys_user ON api_keys(user_id);
      CREATE INDEX IF NOT EXISTS idx_apikeys_hash ON api_keys(key_hash);
    `);
  }

  async close() {
    if (this.pool) await this.pool.end();
  }

  // --- Users ---
  async createUser(data) {
    const res = await this.pool.query(
      `INSERT INTO users (id, email, username, password_hash, roles, metadata, is_active, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING *`,
      [data.id, data.email, data.username || null, data.password_hash,
       JSON.stringify(data.roles || []), JSON.stringify(data.metadata || {}),
       true, data.created_at, data.updated_at]
    );
    return res.rows[0];
  }

  async getUser(id) {
    const res = await this.pool.query('SELECT * FROM users WHERE id = $1', [id]);
    return res.rows[0] || null;
  }

  async getUserByEmail(email) {
    const res = await this.pool.query(
      'SELECT * FROM users WHERE LOWER(email) = LOWER($1)', [email]);
    return res.rows[0] || null;
  }

  async listUsers(query = {}) {
    let sql = 'SELECT * FROM users WHERE 1=1';
    const params = [];
    let i = 1;

    if (query.keyword) {
      sql += ` AND (LOWER(email) LIKE $${i} OR LOWER(username) LIKE $${i})`;
      params.push(`%${query.keyword.toLowerCase()}%`);
      i++;
    }
    if (query.role) {
      sql += ` AND roles @> $${i}::jsonb`;
      params.push(JSON.stringify([query.role]));
      i++;
    }

    sql += ' ORDER BY created_at DESC';
    const res = await this.pool.query(sql, params);
    return res.rows;
  }

  async updateUser(id, updates) {
    const user = await this.getUser(id);
    if (!user) return null;

    const merged = { ...user, ...updates, updated_at: new Date().toISOString() };
    const res = await this.pool.query(
      `UPDATE users
       SET email=$1, username=$2, password_hash=$3, roles=$4, metadata=$5,
           is_active=$6, updated_at=$7, last_login_at=$8
       WHERE id=$9
       RETURNING *`,
      [merged.email, merged.username || null, merged.password_hash,
       JSON.stringify(merged.roles || []), JSON.stringify(merged.metadata || {}),
       merged.is_active, merged.updated_at, merged.last_login_at || null, id]
    );
    return res.rows[0] || null;
  }

  async deleteUser(id) {
    await this.pool.query('DELETE FROM users WHERE id = $1', [id]);
    // CASCADE handles tokens and api_keys deletion
  }

  // --- Tokens ---
  async createToken(data) {
    await this.pool.query(
      `INSERT INTO tokens (id, user_id, token_hash, token_type, expires_at, created_at)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [data.id, data.user_id, data.token_hash, data.token_type || 'session',
       data.expires_at || null, data.created_at]
    );
    return data;
  }

  async getToken(tokenHash) {
    const res = await this.pool.query(
      'SELECT * FROM tokens WHERE token_hash = $1', [tokenHash]);
    return res.rows[0] || null;
  }

  async deleteToken(tokenHash) {
    await this.pool.query('DELETE FROM tokens WHERE token_hash = $1', [tokenHash]);
  }

  async deleteUserTokens(userId) {
    await this.pool.query('DELETE FROM tokens WHERE user_id = $1', [userId]);
  }

  async updateTokenLastUsed(tokenHash) {
    await this.pool.query(
      'UPDATE tokens SET last_used_at = $1 WHERE token_hash = $2',
      [new Date().toISOString(), tokenHash]
    );
  }

  // --- API Keys ---
  async createAPIKey(data) {
    await this.pool.query(
      `INSERT INTO api_keys (id, user_id, key_hash, name, expires_at, created_at)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [data.id, data.user_id, data.key_hash, data.name || null,
       data.expires_at || null, data.created_at]
    );
    return data;
  }

  async getAPIKey(keyHash) {
    const res = await this.pool.query(
      'SELECT * FROM api_keys WHERE key_hash = $1', [keyHash]);
    return res.rows[0] || null;
  }

  async listAPIKeys(userId) {
    const res = await this.pool.query(
      'SELECT * FROM api_keys WHERE user_id = $1 ORDER BY created_at DESC', [userId]);
    return res.rows;
  }

  async deleteAPIKey(id) {
    await this.pool.query('DELETE FROM api_keys WHERE id = $1', [id]);
  }

  async updateAPIKeyLastUsed(keyHash) {
    await this.pool.query(
      'UPDATE api_keys SET last_used_at = $1 WHERE key_hash = $2',
      [new Date().toISOString(), keyHash]
    );
  }
}

// ============================================================================
// AUTHKIT
// ============================================================================

class AuthKit extends EventEmitter {
  constructor(config = {}) {
    super();
    this.config = {
      tokenExpiry: config.tokenExpiry || '7d',
      passwordPolicy: {
        minLength: 8,
        requireUppercase: false,
        requireNumbers: false,
        ...config.passwordPolicy,
      },
      roles: config.roles || {},
      ...config,
    };
    this.storage = null;
    this._resetTokens = new Map(); // token_hash -> { userId, expiresAt }
  }

  /**
   * Factory method — mirrors TicketKit.create()
   * @param {object} config
   * @returns {Promise<AuthKit>}
   */
  static async create(config = {}) {
    const kit = new AuthKit(config);
    let adapter;

    if (config.adapter) {
      adapter = config.adapter;
    } else if (config.connectionString || config.storage === 'postgres' || config.storage === 'postgresql') {
      const connStr = config.connectionString || process.env.DATABASE_URL;
      if (!connStr) throw new Error('connectionString or DATABASE_URL env var is required for PostgreSQL storage');
      adapter = new PostgreSQLAdapter(connStr);
    } else if (config.storage === 'file' || config.filename) {
      adapter = new SQLiteAdapter(config.filename || './auth.db');
    } else {
      adapter = new MemoryAdapter();
    }

    await adapter.init();
    kit.storage = adapter;
    return kit;
  }

  // --------------------------------------------------------------------------
  // USERS
  // --------------------------------------------------------------------------

  /**
   * Create a new user
   */
  async createUser({ email, password, username, roles = [], metadata = {} } = {}) {
    if (!email) throw new Error('email is required');
    if (!password) throw new Error('password is required');

    this._validatePassword(password);

    const existing = await this.storage.getUserByEmail(email);
    if (existing) throw new Error('Email already registered');

    const now = new Date().toISOString();
    const user = {
      id: uuidv4(),
      email: email.toLowerCase().trim(),
      username: username || null,
      password_hash: hashPassword(password),
      roles: Array.isArray(roles) ? roles : [roles],
      metadata,
      is_active: true,
      created_at: now,
      updated_at: now,
      last_login_at: null,
    };

    const created = await this.storage.createUser(user);
    const safe = sanitizeUser(created);
    this.emit('user:created', safe);
    return safe;
  }

  /**
   * Get user by ID (without password_hash)
   */
  async getUser(id) {
    const user = await this.storage.getUser(id);
    return user ? sanitizeUser(user) : null;
  }

  /**
   * Get user by email (without password_hash)
   */
  async getUserByEmail(email) {
    const user = await this.storage.getUserByEmail(email);
    return user ? sanitizeUser(user) : null;
  }

  /**
   * List users with optional filtering
   */
  async listUsers(query = {}) {
    const users = await this.storage.listUsers(query);
    return users.map(sanitizeUser);
  }

  /**
   * Update user fields (not password — use changePassword for that)
   */
  async updateUser(id, updates) {
    const safe = { ...updates };
    delete safe.password_hash; // never allow direct hash updates
    delete safe.id;

    if (safe.email) safe.email = safe.email.toLowerCase().trim();
    if (safe.roles && !Array.isArray(safe.roles)) safe.roles = [safe.roles];

    const updated = await this.storage.updateUser(id, safe);
    if (!updated) throw new Error('User not found');

    const safeUser = sanitizeUser(updated);
    this.emit('user:updated', safeUser);
    return safeUser;
  }

  /**
   * Delete a user and all their tokens/API keys
   */
  async deleteUser(id) {
    const user = await this.storage.getUser(id);
    if (!user) throw new Error('User not found');
    await this.storage.deleteUser(id);
    this.emit('user:deleted', { id });
  }

  // --------------------------------------------------------------------------
  // AUTHENTICATION
  // --------------------------------------------------------------------------

  /**
   * Login with email + password
   * @returns {{ user, token, expiresAt }}
   */
  async login(email, password) {
    if (!email || !password) throw new Error('email and password are required');

    const user = await this.storage.getUserByEmail(email);

    if (!user || !user.is_active) {
      this.emit('user:failed_login', { email });
      throw new Error('Invalid email or password');
    }

    let valid = false;
    try {
      valid = verifyPassword(password, user.password_hash);
    } catch {
      // mismatch in hash format
    }

    if (!valid) {
      this.emit('user:failed_login', { email });
      throw new Error('Invalid email or password');
    }

    const token = generateToken();
    const tokenHash = hashToken(token);
    const expiryMs = parseExpiry(this.config.tokenExpiry);
    const expiresAt = new Date(Date.now() + expiryMs).toISOString();
    const now = new Date().toISOString();

    await this.storage.createToken({
      id: uuidv4(),
      user_id: user.id,
      token_hash: tokenHash,
      token_type: 'session',
      expires_at: expiresAt,
      created_at: now,
    });

    // update last_login_at
    await this.storage.updateUser(user.id, { last_login_at: now });

    const safeUser = sanitizeUser(user);
    this.emit('user:login', { user: safeUser });

    return { user: safeUser, token, expiresAt };
  }

  /**
   * Logout — invalidates the token
   */
  async logout(token) {
    if (!token) throw new Error('token is required');
    const tokenHash = hashToken(token);
    const record = await this.storage.getToken(tokenHash);
    if (!record) return; // already gone, that's fine
    await this.storage.deleteToken(tokenHash);
    this.emit('user:logout', { user_id: record.user_id });
  }

  /**
   * Verify a token and return the user, or null if invalid/expired
   */
  async verifyToken(token) {
    if (!token) return null;

    // check if it's an API key
    if (token.startsWith(API_KEY_PREFIX)) {
      return this._verifyAPIKey(token);
    }

    const tokenHash = hashToken(token);
    const record = await this.storage.getToken(tokenHash);

    if (!record) return null;
    if (record.expires_at && new Date(record.expires_at) < new Date()) {
      await this.storage.deleteToken(tokenHash);
      this.emit('token:expired', { user_id: record.user_id });
      return null;
    }

    await this.storage.updateTokenLastUsed(tokenHash);
    const user = await this.storage.getUser(record.user_id);
    if (!user || !user.is_active) return null;
    return sanitizeUser(user);
  }

  /**
   * Refresh a session token — invalidates old, issues new
   * @returns {{ token, expiresAt }}
   */
  async refreshToken(token) {
    const user = await this.verifyToken(token);
    if (!user) throw new Error('Invalid or expired token');

    // revoke old
    await this.storage.deleteToken(hashToken(token));

    // issue new
    const newToken = generateToken();
    const newHash = hashToken(newToken);
    const expiryMs = parseExpiry(this.config.tokenExpiry);
    const expiresAt = new Date(Date.now() + expiryMs).toISOString();

    await this.storage.createToken({
      id: uuidv4(),
      user_id: user.id,
      token_hash: newHash,
      token_type: 'session',
      expires_at: expiresAt,
      created_at: new Date().toISOString(),
    });

    return { token: newToken, expiresAt };
  }

  /**
   * Change password (requires old password)
   */
  async changePassword(userId, oldPassword, newPassword) {
    const user = await this.storage.getUser(userId);
    if (!user) throw new Error('User not found');

    if (!verifyPassword(oldPassword, user.password_hash)) {
      throw new Error('Current password is incorrect');
    }

    this._validatePassword(newPassword);
    const newHash = hashPassword(newPassword);
    await this.storage.updateUser(userId, { password_hash: newHash });

    // invalidate all existing sessions
    await this.storage.deleteUserTokens(userId);
    this.emit('user:password_changed', { user_id: userId });
  }

  /**
   * Reset password (admin action — no old password required)
   */
  async resetPassword(userId, newPassword) {
    const user = await this.storage.getUser(userId);
    if (!user) throw new Error('User not found');

    this._validatePassword(newPassword);
    const newHash = hashPassword(newPassword);
    await this.storage.updateUser(userId, { password_hash: newHash });
    await this.storage.deleteUserTokens(userId);
    this.emit('user:password_reset', { user_id: userId });
  }

  /**
   * Generate a short-lived password reset token for a user email.
   * Returns the plaintext token (caller should deliver it via email).
   * Never reveals whether the email exists (always returns ok).
   */
  async generatePasswordResetToken(email, { expiryMs = 60 * 60 * 1000 } = {}) {
    const user = await this.storage.getUserByEmail(email);
    if (!user) return null; // silently return null; route layer always responds 200

    const token = generateToken();
    const tokenHash = hashToken(token);
    const expiresAt = Date.now() + expiryMs;

    this._resetTokens.set(tokenHash, { userId: user.id, expiresAt });
    this.emit('user:password_reset_requested', { user_id: user.id });
    return token;
  }

  /**
   * Reset a user's password using a reset token.
   * Invalidates the token after use.
   */
  async resetPasswordWithToken(token, newPassword) {
    const tokenHash = hashToken(token);
    const entry = this._resetTokens.get(tokenHash);

    if (!entry) throw new Error('Invalid or expired reset token');
    if (Date.now() > entry.expiresAt) {
      this._resetTokens.delete(tokenHash);
      throw new Error('Invalid or expired reset token');
    }

    await this.resetPassword(entry.userId, newPassword);
    this._resetTokens.delete(tokenHash);
  }

  // --------------------------------------------------------------------------
  // API KEYS
  // --------------------------------------------------------------------------

  /**
   * Create an API key for a user
   * @returns {{ key, record }} — key is the plaintext (shown once), record is the stored metadata
   */
  async createAPIKey(userId, { name = null, expiresAt = null } = {}) {
    const user = await this.storage.getUser(userId);
    if (!user) throw new Error('User not found');

    const key = generateAPIKey();
    const keyHash = hashToken(key);
    const now = new Date().toISOString();

    const record = {
      id: uuidv4(),
      user_id: userId,
      key_hash: keyHash,
      name,
      expires_at: expiresAt || null,
      created_at: now,
      last_used_at: null,
    };

    await this.storage.createAPIKey(record);
    this.emit('apikey:created', { user_id: userId, name });

    const { key_hash, ...safeRecord } = record;
    return { key, record: safeRecord };
  }

  /**
   * Revoke an API key by its record ID
   */
  async revokeAPIKey(id) {
    await this.storage.deleteAPIKey(id);
    this.emit('apikey:revoked', { id });
  }

  /**
   * List all API keys for a user (hashes omitted)
   */
  async listAPIKeys(userId) {
    const keys = await this.storage.listAPIKeys(userId);
    return keys.map(({ key_hash, ...safe }) => safe);
  }

  // --------------------------------------------------------------------------
  // ROLES & PERMISSIONS
  // --------------------------------------------------------------------------

  /**
   * Assign a role to a user
   */
  async assignRole(userId, role) {
    const user = await this.storage.getUser(userId);
    if (!user) throw new Error('User not found');
    const roles = user.roles || [];
    if (!roles.includes(role)) {
      await this.storage.updateUser(userId, { roles: [...roles, role] });
    }
    return this.getUser(userId);
  }

  /**
   * Remove a role from a user
   */
  async removeRole(userId, role) {
    const user = await this.storage.getUser(userId);
    if (!user) throw new Error('User not found');
    const roles = (user.roles || []).filter(r => r !== role);
    await this.storage.updateUser(userId, { roles });
    return this.getUser(userId);
  }

  /**
   * Check if a user has a specific role
   */
  hasRole(user, role) {
    if (!user || !user.roles) return false;
    return user.roles.includes(role);
  }

  /**
   * Check if a user has a specific permission (via role config)
   */
  hasPermission(user, permission) {
    if (!user || !user.roles) return false;
    const roleConfig = this.config.roles;
    if (!roleConfig || Object.keys(roleConfig).length === 0) return true; // no config = open

    for (const role of user.roles) {
      const perms = roleConfig[role] || [];
      if (perms.includes('*') || perms.includes(permission)) return true;
    }
    return false;
  }

  // --------------------------------------------------------------------------
  // EXPRESS MIDDLEWARE
  // --------------------------------------------------------------------------

  /**
   * Middleware that populates req.user from Bearer token or x-api-key header
   * Does NOT block requests — use requireAuth() for that
   */
  expressMiddleware() {
    return async (req, res, next) => {
      try {
        let token = null;

        const auth = req.headers['authorization'];
        if (auth && auth.startsWith('Bearer ')) {
          token = auth.slice(7);
        } else if (req.headers['x-api-key']) {
          token = req.headers['x-api-key'];
        } else if (req.query && req.query.api_key) {
          token = req.query.api_key;
        }

        if (token) {
          req.user = await this.verifyToken(token);
        } else {
          req.user = null;
        }
        next();
      } catch (err) {
        req.user = null;
        next();
      }
    };
  }

  /**
   * Middleware that returns 401 if no authenticated user
   */
  requireAuth() {
    return (req, res, next) => {
      if (!req.user) {
        return res.status(401).json({ error: 'Authentication required' });
      }
      next();
    };
  }

  /**
   * Middleware that returns 403 if user doesn't have the required role
   */
  requireRole(role) {
    return (req, res, next) => {
      if (!req.user) {
        return res.status(401).json({ error: 'Authentication required' });
      }
      if (!this.hasRole(req.user, role)) {
        return res.status(403).json({ error: `Role '${role}' required` });
      }
      next();
    };
  }

  /**
   * Middleware that returns 403 if user doesn't have the required permission
   */
  requirePermission(permission) {
    return (req, res, next) => {
      if (!req.user) {
        return res.status(401).json({ error: 'Authentication required' });
      }
      if (!this.hasPermission(req.user, permission)) {
        return res.status(403).json({ error: `Permission '${permission}' required` });
      }
      next();
    };
  }

  // --------------------------------------------------------------------------
  // PRIVATE HELPERS
  // --------------------------------------------------------------------------

  _validatePassword(password) {
    const policy = this.config.passwordPolicy;
    if (!password || password.length < policy.minLength) {
      throw new Error(`Password must be at least ${policy.minLength} characters`);
    }
    if (policy.requireUppercase && !/[A-Z]/.test(password)) {
      throw new Error('Password must contain at least one uppercase letter');
    }
    if (policy.requireNumbers && !/[0-9]/.test(password)) {
      throw new Error('Password must contain at least one number');
    }
  }

  async _verifyAPIKey(key) {
    const keyHash = hashToken(key);
    const record = await this.storage.getAPIKey(keyHash);
    if (!record) return null;
    if (record.expires_at && new Date(record.expires_at) < new Date()) return null;

    await this.storage.updateAPIKeyLastUsed(keyHash);
    const user = await this.storage.getUser(record.user_id);
    if (!user || !user.is_active) return null;
    return sanitizeUser(user);
  }

  async close() {
    if (this.storage) await this.storage.close();
  }
}

// ============================================================================
// EXPORTS
// ============================================================================

module.exports = { AuthKit, MemoryAdapter, SQLiteAdapter, PostgreSQLAdapter, StorageAdapter };
