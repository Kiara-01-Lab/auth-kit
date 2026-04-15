/**
 * AuthKit - A simple, flexible authentication SDK
 * Add users, sessions, API keys, and RBAC to any Node.js app
 *
 * MIT License
 */

const crypto = require('crypto');
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
  return crypto.randomUUID().replace(/-/g, '') + crypto.randomUUID().replace(/-/g, '');
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
  async createOrganization(data) { throw new Error('Not implemented'); }
  async getOrganization(id) { throw new Error('Not implemented'); }
  async listUserOrganizations(userId) { throw new Error('Not implemented'); }
  async deleteOrganization(id) { throw new Error('Not implemented'); }
  async addOrgMember(data) { throw new Error('Not implemented'); }
  async removeOrgMember(userId, orgId) { throw new Error('Not implemented'); }
  async updateOrgMemberRole(userId, orgId, role) { throw new Error('Not implemented'); }
  async getOrgMembers(orgId) { throw new Error('Not implemented'); }
  async getOrgMembership(userId, orgId) { throw new Error('Not implemented'); }
  async grantAppAccess(orgId, appName) { throw new Error('Not implemented'); }
  async revokeAppAccess(orgId, appName) { throw new Error('Not implemented'); }
  async getOrgEntitlements(orgId) { throw new Error('Not implemented'); }
  async checkAccess(userId, orgId, appName) { throw new Error('Not implemented'); }
}

// ============================================================================
// MEMORY ADAPTER
// ============================================================================

class MemoryAdapter {
  constructor() {
    this.users = new Map();
    this.tokens = new Map();    // token_hash -> token record
    this.apiKeys = new Map();   // key_hash -> api key record
    this.organizations = new Map();
    this.org_memberships = new Map(); // "userId:orgId" -> membership
    this.org_entitlements = new Map(); // "orgId:appName" -> grant
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

  // --- Organizations (added for multi-tenancy) ---
  async createOrganization(data) {
    this.organizations.set(data.id, { ...data });
    return { ...data };
  }

  async getOrganization(id) {
    const o = this.organizations.get(id);
    return o ? { ...o } : null;
  }

  async listUserOrganizations(userId) {
    const orgs = [];
    for (const [key, m] of this.org_memberships.entries()) {
      if (m.user_id === userId) {
        const org = this.organizations.get(m.org_id);
        if (org) orgs.push({ ...org });
      }
    }
    return orgs;
  }

  async deleteOrganization(id) {
    this.organizations.delete(id);
    // Clean up memberships and entitlements
    for (const key of this.org_memberships.keys()) {
      if (key.endsWith(':' + id)) this.org_memberships.delete(key);
    }
    for (const key of this.org_entitlements.keys()) {
      if (key.startsWith(id + ':')) this.org_entitlements.delete(key);
    }
  }

  async addOrgMember(data) {
    const key = `${data.user_id}:${data.org_id}`;
    this.org_memberships.set(key, { ...data });
  }

  async removeOrgMember(userId, orgId) {
    const key = `${userId}:${orgId}`;
    this.org_memberships.delete(key);
  }

  async updateOrgMemberRole(userId, orgId, role) {
    const key = `${userId}:${orgId}`;
    const m = this.org_memberships.get(key);
    if (m) {
      m.role = role;
      this.org_memberships.set(key, m);
    }
  }

  async getOrgMembers(orgId) {
    const members = [];
    for (const m of this.org_memberships.values()) {
      if (m.org_id === orgId) {
        const user = this.users.get(m.user_id);
        if (user) {
          members.push({ ...user, role: m.role, joined_at: m.joined_at });
        }
      }
    }
    return members;
  }

  async getOrgMembership(userId, orgId) {
    const key = `${userId}:${orgId}`;
    const m = this.org_memberships.get(key);
    return m ? { ...m } : null;
  }

  async grantAppAccess(orgId, appName) {
    const key = `${orgId}:${appName}`;
    this.org_entitlements.set(key, { org_id: orgId, app_name: appName, granted_at: new Date().toISOString() });
  }

  async revokeAppAccess(orgId, appName) {
    const key = `${orgId}:${appName}`;
    this.org_entitlements.delete(key);
  }

  async getOrgEntitlements(orgId) {
    const apps = [];
    for (const [key, e] of this.org_entitlements.entries()) {
      if (e.org_id === orgId) apps.push(e.app_name);
    }
    return apps;
  }

  async checkAccess(userId, orgId, appName) {
    const membership = await this.getOrgMembership(userId, orgId);
    if (!membership) return false;
    const key = `${orgId}:${appName}`;
    return this.org_entitlements.has(key);
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

    // Multi-tenant tables
    this.db.run(`
      CREATE TABLE IF NOT EXISTS organizations (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        owner_user_id TEXT NOT NULL,
        created_at TEXT NOT NULL,
        FOREIGN KEY (owner_user_id) REFERENCES users(id) ON DELETE CASCADE
      )
    `);

    this.db.run(`
      CREATE TABLE IF NOT EXISTS org_memberships (
        user_id TEXT NOT NULL,
        org_id TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'member',
        joined_at TEXT NOT NULL,
        PRIMARY KEY (user_id, org_id),
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE
      )
    `);

    this.db.run(`
      CREATE TABLE IF NOT EXISTS org_entitlements (
        org_id TEXT NOT NULL,
        app_name TEXT NOT NULL,
        granted_at TEXT NOT NULL,
        PRIMARY KEY (org_id, app_name),
        FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE
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

  // --- Organizations ---
  async createOrganization(data) {
    this.db.run(
      `INSERT INTO organizations (id, name, owner_user_id, created_at)
       VALUES (?, ?, ?, ?)`,
      [data.id, data.name, data.owner_user_id, data.created_at]
    );
    this._persist();
    return this.getOrganization(data.id);
  }

  async getOrganization(id) {
    const res = this.db.exec('SELECT * FROM organizations WHERE id = ?', [id]);
    return this._rows(res)[0] || null;
  }

  async listUserOrganizations(userId) {
    const res = this.db.exec(
      `SELECT o.* FROM organizations o
       JOIN org_memberships m ON m.org_id = o.id
       WHERE m.user_id = ?
       ORDER BY o.created_at DESC`,
      [userId]
    );
    return this._rows(res);
  }

  async deleteOrganization(id) {
    this.db.run('DELETE FROM organizations WHERE id = ?', [id]);
    this._persist();
  }

  // --- Org Memberships ---
  async addOrgMember(data) {
    this.db.run(
      `INSERT INTO org_memberships (user_id, org_id, role, joined_at)
       VALUES (?, ?, ?, ?)`,
      [data.user_id, data.org_id, data.role || 'member', data.joined_at]
    );
    this._persist();
  }

  async removeOrgMember(userId, orgId) {
    this.db.run('DELETE FROM org_memberships WHERE user_id = ? AND org_id = ?', [userId, orgId]);
    this._persist();
  }

  async updateOrgMemberRole(userId, orgId, role) {
    this.db.run('UPDATE org_memberships SET role = ? WHERE user_id = ? AND org_id = ?',
      [role, userId, orgId]);
    this._persist();
  }

  async getOrgMembers(orgId) {
    const res = this.db.exec(
      `SELECT u.id, u.email, u.username, m.role, m.joined_at
       FROM users u
       JOIN org_memberships m ON m.user_id = u.id
       WHERE m.org_id = ?
       ORDER BY m.joined_at ASC`,
      [orgId]
    );
    return this._rows(res);
  }

  async getOrgMembership(userId, orgId) {
    const res = this.db.exec(
      'SELECT * FROM org_memberships WHERE user_id = ? AND org_id = ?',
      [userId, orgId]
    );
    return this._rows(res)[0] || null;
  }

  // --- Org Entitlements ---
  async grantAppAccess(orgId, appName) {
    this.db.run(
      `INSERT INTO org_entitlements (org_id, app_name, granted_at)
       VALUES (?, ?, ?)`,
      [orgId, appName, new Date().toISOString()]
    );
    this._persist();
  }

  async revokeAppAccess(orgId, appName) {
    this.db.run('DELETE FROM org_entitlements WHERE org_id = ? AND app_name = ?',
      [orgId, appName]);
    this._persist();
  }

  async getOrgEntitlements(orgId) {
    const res = this.db.exec(
      'SELECT app_name FROM org_entitlements WHERE org_id = ? ORDER BY granted_at ASC',
      [orgId]
    );
    return this._rows(res).map(row => row.app_name);
  }

  async checkAccess(userId, orgId, appName) {
    // Check if user is member of org
    const membership = await this.getOrgMembership(userId, orgId);
    if (!membership) return false;

    // Check if org has access to app
    const res = this.db.exec(
      'SELECT 1 FROM org_entitlements WHERE org_id = ? AND app_name = ?',
      [orgId, appName]
    );
    return this._rows(res).length > 0;
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
                     this.connectionString.includes('.railway.app') ||
                     this.connectionString.includes('.render.com');

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

      CREATE TABLE IF NOT EXISTS organizations (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        owner_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        created_at TIMESTAMPTZ NOT NULL
      );

      CREATE TABLE IF NOT EXISTS org_memberships (
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        org_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
        role TEXT NOT NULL DEFAULT 'member',
        joined_at TIMESTAMPTZ NOT NULL,
        PRIMARY KEY (user_id, org_id)
      );

      CREATE TABLE IF NOT EXISTS org_entitlements (
        org_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
        app_name TEXT NOT NULL,
        granted_at TIMESTAMPTZ NOT NULL,
        PRIMARY KEY (org_id, app_name)
      );
    `);

    await this.pool.query(`
      CREATE INDEX IF NOT EXISTS idx_users_email ON users(LOWER(email));
      CREATE INDEX IF NOT EXISTS idx_tokens_user ON tokens(user_id);
      CREATE INDEX IF NOT EXISTS idx_tokens_hash ON tokens(token_hash);
      CREATE INDEX IF NOT EXISTS idx_apikeys_user ON api_keys(user_id);
      CREATE INDEX IF NOT EXISTS idx_apikeys_hash ON api_keys(key_hash);
      CREATE INDEX IF NOT EXISTS idx_org_memberships_user ON org_memberships(user_id);
      CREATE INDEX IF NOT EXISTS idx_org_memberships_org ON org_memberships(org_id);
      CREATE INDEX IF NOT EXISTS idx_org_entitlements_org ON org_entitlements(org_id);
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

  // --- Organizations ---
  async createOrganization(data) {
    await this.pool.query(
      `INSERT INTO organizations (id, name, owner_user_id, created_at)
       VALUES ($1, $2, $3, $4)`,
      [data.id, data.name, data.owner_user_id, data.created_at]
    );
    return this.getOrganization(data.id);
  }

  async getOrganization(id) {
    const res = await this.pool.query('SELECT * FROM organizations WHERE id = $1', [id]);
    return res.rows[0] || null;
  }

  async listUserOrganizations(userId) {
    const res = await this.pool.query(
      `SELECT o.* FROM organizations o
       JOIN org_memberships m ON m.org_id = o.id
       WHERE m.user_id = $1
       ORDER BY o.created_at DESC`,
      [userId]
    );
    return res.rows;
  }

  async deleteOrganization(id) {
    await this.pool.query('DELETE FROM organizations WHERE id = $1', [id]);
  }

  // --- Org Memberships ---
  async addOrgMember(data) {
    await this.pool.query(
      `INSERT INTO org_memberships (user_id, org_id, role, joined_at)
       VALUES ($1, $2, $3, $4)`,
      [data.user_id, data.org_id, data.role || 'member', data.joined_at]
    );
  }

  async removeOrgMember(userId, orgId) {
    await this.pool.query('DELETE FROM org_memberships WHERE user_id = $1 AND org_id = $2', [userId, orgId]);
  }

  async updateOrgMemberRole(userId, orgId, role) {
    await this.pool.query('UPDATE org_memberships SET role = $1 WHERE user_id = $2 AND org_id = $3',
      [role, userId, orgId]);
  }

  async getOrgMembers(orgId) {
    const res = await this.pool.query(
      `SELECT u.id, u.email, u.username, m.role, m.joined_at
       FROM users u
       JOIN org_memberships m ON m.user_id = u.id
       WHERE m.org_id = $1
       ORDER BY m.joined_at ASC`,
      [orgId]
    );
    return res.rows;
  }

  async getOrgMembership(userId, orgId) {
    const res = await this.pool.query(
      'SELECT * FROM org_memberships WHERE user_id = $1 AND org_id = $2',
      [userId, orgId]
    );
    return res.rows[0] || null;
  }

  // --- Org Entitlements ---
  async grantAppAccess(orgId, appName) {
    await this.pool.query(
      `INSERT INTO org_entitlements (org_id, app_name, granted_at)
       VALUES ($1, $2, $3)
       ON CONFLICT (org_id, app_name) DO NOTHING`,
      [orgId, appName, new Date().toISOString()]
    );
  }

  async revokeAppAccess(orgId, appName) {
    await this.pool.query('DELETE FROM org_entitlements WHERE org_id = $1 AND app_name = $2',
      [orgId, appName]);
  }

  async getOrgEntitlements(orgId) {
    const res = await this.pool.query(
      'SELECT app_name FROM org_entitlements WHERE org_id = $1 ORDER BY granted_at ASC',
      [orgId]
    );
    return res.rows.map(row => row.app_name);
  }

  async checkAccess(userId, orgId, appName) {
    // Check if user is member of org AND org has access to app
    const res = await this.pool.query(
      `SELECT 1 FROM org_memberships m
       JOIN org_entitlements e ON e.org_id = m.org_id
       WHERE m.user_id = $1 AND m.org_id = $2 AND e.app_name = $3`,
      [userId, orgId, appName]
    );
    return res.rows.length > 0;
  }

  // --- Subscription Plans ---
  async createSubscriptionPlan(data) {
    const res = await this.pool.query(
      `INSERT INTO subscription_plans (id, name, display_name, description, stripe_product_id, stripe_price_id, stripe_price_id_yearly, price_monthly, price_yearly, currency, features, is_active, sort_order, recommended, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
       RETURNING *`,
      [data.id, data.name, data.display_name, data.description || null,
       data.stripe_product_id || null, data.stripe_price_id || null, data.stripe_price_id_yearly || null,
       data.price_monthly || 0, data.price_yearly || 0, data.currency || 'USD',
       JSON.stringify(data.features || {}), data.is_active !== false, data.sort_order || 0, data.recommended || false,
       data.created_at, data.updated_at]
    );
    return res.rows[0];
  }

  async getSubscriptionPlan(id) {
    const res = await this.pool.query('SELECT * FROM subscription_plans WHERE id = $1', [id]);
    return res.rows[0] || null;
  }

  async getSubscriptionPlanByName(name) {
    const res = await this.pool.query('SELECT * FROM subscription_plans WHERE name = $1', [name]);
    return res.rows[0] || null;
  }

  async listSubscriptionPlans(activeOnly = false) {
    const sql = activeOnly
      ? 'SELECT * FROM subscription_plans WHERE is_active = true ORDER BY sort_order ASC'
      : 'SELECT * FROM subscription_plans ORDER BY sort_order ASC';
    const res = await this.pool.query(sql);
    return res.rows;
  }

  async updateSubscriptionPlan(id, updates) {
    const plan = await this.getSubscriptionPlan(id);
    if (!plan) return null;

    const merged = { ...plan, ...updates, updated_at: new Date().toISOString() };
    const res = await this.pool.query(
      `UPDATE subscription_plans
       SET name=$1, display_name=$2, description=$3, stripe_product_id=$4, stripe_price_id=$5,
           stripe_price_id_yearly=$6, price_monthly=$7, price_yearly=$8, currency=$9, features=$10,
           is_active=$11, sort_order=$12, recommended=$13, updated_at=$14
       WHERE id=$15
       RETURNING *`,
      [merged.name, merged.display_name, merged.description, merged.stripe_product_id, merged.stripe_price_id,
       merged.stripe_price_id_yearly, merged.price_monthly, merged.price_yearly, merged.currency,
       JSON.stringify(merged.features), merged.is_active, merged.sort_order, merged.recommended,
       merged.updated_at, id]
    );
    return res.rows[0] || null;
  }

  // --- Subscriptions ---
  async createSubscription(data) {
    const res = await this.pool.query(
      `INSERT INTO subscriptions (id, user_id, plan_id, status, stripe_customer_id, stripe_subscription_id, stripe_latest_invoice_id, stripe_payment_intent_status, billing_cycle, feature_overrides, trial_start, trial_end, current_period_start, current_period_end, cancel_at_period_end, cancelled_at, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
       RETURNING *`,
      [data.id, data.user_id, data.plan_id, data.status || 'active',
       data.stripe_customer_id || null, data.stripe_subscription_id || null,
       data.stripe_latest_invoice_id || null, data.stripe_payment_intent_status || null,
       data.billing_cycle || 'monthly', JSON.stringify(data.feature_overrides || {}),
       data.trial_start || null, data.trial_end || null,
       data.current_period_start || null, data.current_period_end || null,
       data.cancel_at_period_end || false, data.cancelled_at || null,
       data.created_at, data.updated_at]
    );
    return res.rows[0];
  }

  async getUserSubscription(userId) {
    const res = await this.pool.query(
      `SELECT s.*, p.name as plan_name, p.display_name as plan_display_name,
              p.features as plan_features, p.price_monthly, p.price_yearly
       FROM subscriptions s
       JOIN subscription_plans p ON p.id = s.plan_id
       WHERE s.user_id = $1 AND s.status IN ('active', 'trialing')
       ORDER BY s.created_at DESC
       LIMIT 1`,
      [userId]
    );
    return res.rows[0] || null;
  }

  async getSubscription(id) {
    const res = await this.pool.query('SELECT * FROM subscriptions WHERE id = $1', [id]);
    return res.rows[0] || null;
  }

  async updateSubscription(id, updates) {
    const sub = await this.getSubscription(id);
    if (!sub) return null;

    const merged = { ...sub, ...updates, updated_at: new Date().toISOString() };
    const res = await this.pool.query(
      `UPDATE subscriptions
       SET user_id=$1, plan_id=$2, status=$3, stripe_customer_id=$4, stripe_subscription_id=$5,
           stripe_latest_invoice_id=$6, stripe_payment_intent_status=$7, billing_cycle=$8,
           feature_overrides=$9, trial_start=$10, trial_end=$11, current_period_start=$12,
           current_period_end=$13, cancel_at_period_end=$14, cancelled_at=$15, updated_at=$16
       WHERE id=$17
       RETURNING *`,
      [merged.user_id, merged.plan_id, merged.status, merged.stripe_customer_id, merged.stripe_subscription_id,
       merged.stripe_latest_invoice_id, merged.stripe_payment_intent_status, merged.billing_cycle,
       JSON.stringify(merged.feature_overrides), merged.trial_start, merged.trial_end,
       merged.current_period_start, merged.current_period_end, merged.cancel_at_period_end,
       merged.cancelled_at, merged.updated_at, id]
    );
    return res.rows[0] || null;
  }

  async deleteSubscription(id) {
    await this.pool.query('DELETE FROM subscriptions WHERE id = $1', [id]);
  }

  // --- Subscription Usage ---
  async createUsageRecord(data) {
    const res = await this.pool.query(
      `INSERT INTO subscription_usage (id, user_id, subscription_id, period_start, period_end, boards_count, tickets_count, storage_used_mb, ai_tokens_used, translation_requests_count, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
       RETURNING *`,
      [data.id, data.user_id, data.subscription_id, data.period_start, data.period_end,
       data.boards_count || 0, data.tickets_count || 0, data.storage_used_mb || 0,
       data.ai_tokens_used || 0, data.translation_requests_count || 0,
       data.created_at, data.updated_at]
    );
    return res.rows[0];
  }

  async getUserUsage(userId, periodStart) {
    const res = await this.pool.query(
      'SELECT * FROM subscription_usage WHERE user_id = $1 AND period_start = $2',
      [userId, periodStart]
    );
    return res.rows[0] || null;
  }

  async updateUsage(id, updates) {
    const usage = await this.pool.query('SELECT * FROM subscription_usage WHERE id = $1', [id]);
    if (!usage.rows[0]) return null;

    const merged = { ...usage.rows[0], ...updates, updated_at: new Date().toISOString() };
    const res = await this.pool.query(
      `UPDATE subscription_usage
       SET boards_count=$1, tickets_count=$2, storage_used_mb=$3, ai_tokens_used=$4,
           translation_requests_count=$5, updated_at=$6
       WHERE id=$7
       RETURNING *`,
      [merged.boards_count, merged.tickets_count, merged.storage_used_mb, merged.ai_tokens_used,
       merged.translation_requests_count, merged.updated_at, id]
    );
    return res.rows[0] || null;
  }

  async incrementUsage(userId, periodStart, field, amount = 1) {
    const usage = await this.getUserUsage(userId, periodStart);
    if (!usage) return null;

    const res = await this.pool.query(
      `UPDATE subscription_usage
       SET ${field} = ${field} + $1, updated_at = $2
       WHERE id = $3
       RETURNING *`,
      [amount, new Date().toISOString(), usage.id]
    );
    return res.rows[0] || null;
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
      id: crypto.randomUUID(),
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
      id: crypto.randomUUID(),
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
      id: crypto.randomUUID(),
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
      id: crypto.randomUUID(),
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
  // ORGANIZATIONS
  // --------------------------------------------------------------------------

  /**
   * Create a new organization
   * @returns {{ id, name, owner_user_id, created_at }}
   */
  async createOrganization({ name, owner_user_id, entitlements = [] }) {
    if (!name) throw new Error('Organization name is required');
    if (!owner_user_id) throw new Error('Owner user ID is required');

    const org = await this.storage.createOrganization({
      id: 'org_' + nanoid(),
      name,
      owner_user_id,
      created_at: new Date().toISOString(),
    });

    // Add owner as member with owner role
    await this.storage.addOrgMember({
      user_id: owner_user_id,
      org_id: org.id,
      role: 'owner',
      joined_at: new Date().toISOString(),
    });

    // Grant app entitlements
    for (const appName of entitlements) {
      await this.storage.grantAppAccess(org.id, appName);
    }

    this.emit('org:created', { org });
    return org;
  }

  /**
   * Get organization by ID
   */
  async getOrganization(id) {
    return this.storage.getOrganization(id);
  }

  /**
   * List all organizations a user belongs to
   */
  async listUserOrganizations(userId) {
    return this.storage.listUserOrganizations(userId);
  }

  /**
   * Delete an organization (owner only)
   */
  async deleteOrganization(id) {
    await this.storage.deleteOrganization(id);
    this.emit('org:deleted', { org_id: id });
  }

  /**
   * Add a member to an organization
   */
  async addOrgMember({ org_id, user_id, role = 'member' }) {
    await this.storage.addOrgMember({
      user_id,
      org_id,
      role,
      joined_at: new Date().toISOString(),
    });
    this.emit('org:member_added', { org_id, user_id, role });
  }

  /**
   * Remove a member from an organization
   */
  async removeOrgMember({ org_id, user_id }) {
    await this.storage.removeOrgMember(user_id, org_id);
    this.emit('org:member_removed', { org_id, user_id });
  }

  /**
   * Update a member's role in an organization
   */
  async updateOrgMemberRole({ org_id, user_id, role }) {
    await this.storage.updateOrgMemberRole(user_id, org_id, role);
    this.emit('org:member_role_updated', { org_id, user_id, role });
  }

  /**
   * List all members of an organization
   */
  async getOrgMembers(org_id) {
    return this.storage.getOrgMembers(org_id);
  }

  /**
   * Get a user's membership in an organization
   */
  async getOrgMembership(user_id, org_id) {
    return this.storage.getOrgMembership(user_id, org_id);
  }

  /**
   * Grant app access to an organization
   */
  async grantAppAccess({ org_id, app_name }) {
    await this.storage.grantAppAccess(org_id, app_name);
    this.emit('org:app_granted', { org_id, app_name });
  }

  /**
   * Revoke app access from an organization
   */
  async revokeAppAccess({ org_id, app_name }) {
    await this.storage.revokeAppAccess(org_id, app_name);
    this.emit('org:app_revoked', { org_id, app_name });
  }

  /**
   * Get all app entitlements for an organization
   * @returns {string[]} Array of app names
   */
  async getOrgEntitlements(org_id) {
    return this.storage.getOrgEntitlements(org_id);
  }

  /**
   * Check if a user has access to an app via an organization
   */
  async checkAccess({ user_id, org_id, app_name }) {
    return this.storage.checkAccess(user_id, org_id, app_name);
  }

  /**
   * Login with organization context
   * @returns {{ user, token, expiresAt, org, role, entitlements }}
   */
  async loginWithOrg(email, password, org_id = null) {
    // First, do regular login
    const loginResult = await this.login(email, password);

    // Get user's organizations
    const orgs = await this.listUserOrganizations(loginResult.user.id);

    if (orgs.length === 0) {
      throw new Error('User is not a member of any organization');
    }

    // Use provided org_id or default to first org
    let selectedOrg;
    if (org_id) {
      selectedOrg = orgs.find(o => o.id === org_id);
      if (!selectedOrg) {
        throw new Error('User is not a member of the specified organization');
      }
    } else {
      selectedOrg = orgs[0];
    }

    // Get membership role and entitlements
    const membership = await this.getOrgMembership(loginResult.user.id, selectedOrg.id);
    const entitlements = await this.getOrgEntitlements(selectedOrg.id);

    return {
      ...loginResult,
      org: selectedOrg,
      role: membership.role,
      entitlements,
    };
  }

  // --------------------------------------------------------------------------
  // SUBSCRIPTIONS
  // --------------------------------------------------------------------------

  /**
   * Create a subscription plan
   * @returns {object} Created plan
   */
  async createPlan({ name, display_name, description, stripe_product_id, stripe_price_id, stripe_price_id_yearly, price_monthly, price_yearly, currency, features, is_active, sort_order, recommended }) {
    if (!name) throw new Error('Plan name is required');
    if (!display_name) throw new Error('Plan display_name is required');

    const plan = await this.storage.createSubscriptionPlan({
      id: crypto.randomUUID(),
      name,
      display_name,
      description: description || null,
      stripe_product_id: stripe_product_id || null,
      stripe_price_id: stripe_price_id || null,
      stripe_price_id_yearly: stripe_price_id_yearly || null,
      price_monthly: price_monthly || 0,
      price_yearly: price_yearly || 0,
      currency: currency || 'USD',
      features: features || {},
      is_active: is_active !== false,
      sort_order: sort_order || 0,
      recommended: recommended || false,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });

    this.emit('plan:created', plan);
    return plan;
  }

  /**
   * Get all subscription plans (optionally active only)
   */
  async getPlans(activeOnly = false) {
    return this.storage.listSubscriptionPlans(activeOnly);
  }

  /**
   * Get a single plan by ID or name
   */
  async getPlan(idOrName) {
    // Try by ID first
    let plan = await this.storage.getSubscriptionPlan(idOrName);
    if (!plan) {
      // Try by name
      plan = await this.storage.getSubscriptionPlanByName(idOrName);
    }
    return plan;
  }

  /**
   * Update a subscription plan
   */
  async updatePlan(id, updates) {
    const plan = await this.storage.updateSubscriptionPlan(id, updates);
    if (!plan) throw new Error('Plan not found');
    this.emit('plan:updated', plan);
    return plan;
  }

  /**
   * Subscribe a user to a plan
   * @returns {object} Created subscription
   */
  async subscribe(userId, planIdOrName, { billing_cycle = 'monthly', trial_days = 0, stripe_customer_id = null, stripe_subscription_id = null } = {}) {
    const user = await this.storage.getUser(userId);
    if (!user) throw new Error('User not found');

    const plan = await this.getPlan(planIdOrName);
    if (!plan) throw new Error('Plan not found');

    const now = new Date();
    const nowISO = now.toISOString();

    let status = 'active';
    let trial_start = null;
    let trial_end = null;

    if (trial_days > 0) {
      status = 'trialing';
      trial_start = nowISO;
      trial_end = new Date(now.getTime() + trial_days * 24 * 60 * 60 * 1000).toISOString();
    }

    const period_start = nowISO;
    const period_end = new Date(
      now.getFullYear(),
      now.getMonth() + (billing_cycle === 'yearly' ? 12 : 1),
      now.getDate()
    ).toISOString();

    const subscription = await this.storage.createSubscription({
      id: crypto.randomUUID(),
      user_id: userId,
      plan_id: plan.id,
      status,
      billing_cycle,
      stripe_customer_id,
      stripe_subscription_id,
      trial_start,
      trial_end,
      current_period_start: period_start,
      current_period_end: period_end,
      feature_overrides: {},
      cancel_at_period_end: false,
      created_at: nowISO,
      updated_at: nowISO,
    });

    // Create usage record for this period
    await this.storage.createUsageRecord({
      id: crypto.randomUUID(),
      user_id: userId,
      subscription_id: subscription.id,
      period_start,
      period_end,
      boards_count: 0,
      tickets_count: 0,
      storage_used_mb: 0,
      ai_tokens_used: 0,
      translation_requests_count: 0,
      created_at: nowISO,
      updated_at: nowISO,
    });

    this.emit('subscription:created', { user_id: userId, subscription });
    return subscription;
  }

  /**
   * Get a user's active subscription with plan details
   * @returns {object|null} Subscription with plan data, or null
   */
  async getSubscription(userId) {
    return this.storage.getUserSubscription(userId);
  }

  /**
   * Get merged features for a user (plan features + overrides)
   * @returns {object} Merged features
   */
  async getFeatures(userId) {
    const sub = await this.getSubscription(userId);
    if (!sub) return {};

    const planFeatures = sub.plan_features || {};
    const overrides = sub.feature_overrides || {};

    return { ...planFeatures, ...overrides };
  }

  /**
   * Check if a user has exceeded a specific limit
   * @returns {boolean} true if within limit, false if exceeded
   */
  async checkLimit(userId, limitName) {
    const features = await this.getFeatures(userId);
    const limit = features[limitName];

    // null means unlimited
    if (limit === null || limit === undefined) return true;

    // Get current usage
    const now = new Date();
    const periodStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
    const usage = await this.storage.getUserUsage(userId, periodStart);

    if (!usage) return true; // No usage yet, within limit

    const usageMap = {
      max_boards: usage.boards_count,
      max_tickets_per_board: usage.tickets_count,
      ai_tokens_per_month: usage.ai_tokens_used,
      translation_requests_per_month: usage.translation_requests_count,
      max_storage_mb: usage.storage_used_mb,
    };

    const currentUsage = usageMap[limitName] || 0;
    return currentUsage < limit;
  }

  /**
   * Increment usage for a user
   */
  async incrementUsage(userId, usageType, amount = 1) {
    const now = new Date();
    const periodStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();

    const fieldMap = {
      boards: 'boards_count',
      tickets: 'tickets_count',
      ai_tokens: 'ai_tokens_used',
      translations: 'translation_requests_count',
      storage_mb: 'storage_used_mb',
    };

    const field = fieldMap[usageType];
    if (!field) throw new Error(`Unknown usage type: ${usageType}`);

    return this.storage.incrementUsage(userId, periodStart, field, amount);
  }

  /**
   * Update subscription with Stripe data
   */
  async updateStripeData(userId, { stripe_customer_id, stripe_subscription_id, stripe_latest_invoice_id, stripe_payment_intent_status, status }) {
    const sub = await this.getSubscription(userId);
    if (!sub) throw new Error('No active subscription found');

    const updates = {};
    if (stripe_customer_id) updates.stripe_customer_id = stripe_customer_id;
    if (stripe_subscription_id) updates.stripe_subscription_id = stripe_subscription_id;
    if (stripe_latest_invoice_id) updates.stripe_latest_invoice_id = stripe_latest_invoice_id;
    if (stripe_payment_intent_status) updates.stripe_payment_intent_status = stripe_payment_intent_status;
    if (status) updates.status = status;

    const updated = await this.storage.updateSubscription(sub.id, updates);
    this.emit('subscription:updated', { user_id: userId, subscription: updated });
    return updated;
  }

  /**
   * Cancel a subscription (at period end)
   */
  async cancelSubscription(userId, immediately = false) {
    const sub = await this.getSubscription(userId);
    if (!sub) throw new Error('No active subscription found');

    const updates = {
      cancel_at_period_end: !immediately,
      cancelled_at: new Date().toISOString(),
    };

    if (immediately) {
      updates.status = 'cancelled';
    }

    const updated = await this.storage.updateSubscription(sub.id, updates);
    this.emit('subscription:cancelled', { user_id: userId, immediately, subscription: updated });
    return updated;
  }

  /**
   * Change a user's subscription plan
   */
  async changePlan(userId, newPlanIdOrName, { billing_cycle = null, prorate = true } = {}) {
    const currentSub = await this.getSubscription(userId);
    if (!currentSub) throw new Error('No active subscription found');

    const newPlan = await this.getPlan(newPlanIdOrName);
    if (!newPlan) throw new Error('New plan not found');

    const updates = {
      plan_id: newPlan.id,
    };

    if (billing_cycle) {
      updates.billing_cycle = billing_cycle;
    }

    const updated = await this.storage.updateSubscription(currentSub.id, updates);
    this.emit('subscription:plan_changed', { user_id: userId, old_plan_id: currentSub.plan_id, new_plan_id: newPlan.id });
    return updated;
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
