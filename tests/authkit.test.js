/**
 * AuthKit - Test Suite
 */

const { AuthKit } = require('../index.js');

// ── Helpers ────────────────────────────────────────────────────────────────

async function freshKit(config = {}) {
  return AuthKit.create({ ...config });
}

async function createUser(kit, overrides = {}) {
  return kit.createUser({
    email: overrides.email || 'user@example.com',
    password: overrides.password || 'password123',
    username: overrides.username || 'testuser',
    roles: overrides.roles || [],
    ...overrides,
  });
}

// ============================================================================
// USERS
// ============================================================================

describe('createUser', () => {
  test('creates a user and returns it without password_hash', async () => {
    const kit = await freshKit();
    const user = await createUser(kit);
    expect(user.email).toBe('user@example.com');
    expect(user.id).toBeDefined();
    expect(user.password_hash).toBeUndefined();
    expect(user.roles).toEqual([]);
    expect(user.is_active).toBe(true);
  });

  test('lowercases email', async () => {
    const kit = await freshKit();
    const user = await kit.createUser({ email: 'ALICE@Example.COM', password: 'pw12345678' });
    expect(user.email).toBe('alice@example.com');
  });

  test('throws if email is taken', async () => {
    const kit = await freshKit();
    await createUser(kit);
    await expect(createUser(kit)).rejects.toThrow('already registered');
  });

  test('throws if password too short', async () => {
    const kit = await freshKit({ passwordPolicy: { minLength: 10 } });
    await expect(createUser(kit, { password: 'short' })).rejects.toThrow();
  });

  test('throws if email missing', async () => {
    const kit = await freshKit();
    await expect(kit.createUser({ password: 'pw12345678' })).rejects.toThrow('email');
  });
});

describe('getUser / getUserByEmail', () => {
  test('returns user by id', async () => {
    const kit = await freshKit();
    const created = await createUser(kit);
    const found = await kit.getUser(created.id);
    expect(found.id).toBe(created.id);
    expect(found.password_hash).toBeUndefined();
  });

  test('returns null for unknown id', async () => {
    const kit = await freshKit();
    expect(await kit.getUser('no-such-id')).toBeNull();
  });

  test('returns user by email (case-insensitive)', async () => {
    const kit = await freshKit();
    await createUser(kit, { email: 'bob@example.com' });
    const found = await kit.getUserByEmail('BOB@EXAMPLE.COM');
    expect(found.email).toBe('bob@example.com');
  });
});

describe('updateUser', () => {
  test('updates username', async () => {
    const kit = await freshKit();
    const user = await createUser(kit);
    const updated = await kit.updateUser(user.id, { username: 'newname' });
    expect(updated.username).toBe('newname');
  });

  test('does not allow setting password_hash directly', async () => {
    const kit = await freshKit();
    const user = await createUser(kit);
    await kit.updateUser(user.id, { password_hash: 'injected' });
    const fetched = await kit.getUser(user.id);
    expect(fetched.password_hash).toBeUndefined(); // sanitized
  });
});

describe('deleteUser', () => {
  test('removes user', async () => {
    const kit = await freshKit();
    const user = await createUser(kit);
    await kit.deleteUser(user.id);
    expect(await kit.getUser(user.id)).toBeNull();
  });

  test('throws for unknown user', async () => {
    const kit = await freshKit();
    await expect(kit.deleteUser('ghost')).rejects.toThrow('not found');
  });
});

describe('listUsers', () => {
  test('returns all users', async () => {
    const kit = await freshKit();
    await createUser(kit, { email: 'a@x.com' });
    await createUser(kit, { email: 'b@x.com' });
    const list = await kit.listUsers();
    expect(list.length).toBe(2);
  });

  test('filters by role', async () => {
    const kit = await freshKit();
    await createUser(kit, { email: 'a@x.com', roles: ['admin'] });
    await createUser(kit, { email: 'b@x.com', roles: ['member'] });
    const admins = await kit.listUsers({ role: 'admin' });
    expect(admins.length).toBe(1);
    expect(admins[0].email).toBe('a@x.com');
  });
});

// ============================================================================
// AUTHENTICATION
// ============================================================================

describe('login', () => {
  test('returns user, token, and expiresAt on success', async () => {
    const kit = await freshKit();
    await createUser(kit);
    const result = await kit.login('user@example.com', 'password123');
    expect(result.user.email).toBe('user@example.com');
    expect(result.token).toBeDefined();
    expect(result.expiresAt).toBeDefined();
    expect(result.user.password_hash).toBeUndefined();
  });

  test('throws on wrong password', async () => {
    const kit = await freshKit();
    await createUser(kit);
    await expect(kit.login('user@example.com', 'wrongpw')).rejects.toThrow('Invalid');
  });

  test('throws for unknown email', async () => {
    const kit = await freshKit();
    await expect(kit.login('ghost@x.com', 'pw')).rejects.toThrow('Invalid');
  });

  test('emits user:login event', async () => {
    const kit = await freshKit();
    await createUser(kit);
    const spy = jest.fn();
    kit.on('user:login', spy);
    await kit.login('user@example.com', 'password123');
    expect(spy).toHaveBeenCalledWith(expect.objectContaining({ user: expect.any(Object) }));
  });

  test('emits user:failed_login on bad password', async () => {
    const kit = await freshKit();
    await createUser(kit);
    const spy = jest.fn();
    kit.on('user:failed_login', spy);
    await kit.login('user@example.com', 'bad').catch(() => {});
    expect(spy).toHaveBeenCalled();
  });
});

describe('verifyToken', () => {
  test('returns user for valid token', async () => {
    const kit = await freshKit();
    await createUser(kit);
    const { token } = await kit.login('user@example.com', 'password123');
    const user = await kit.verifyToken(token);
    expect(user.email).toBe('user@example.com');
  });

  test('returns null for garbage token', async () => {
    const kit = await freshKit();
    expect(await kit.verifyToken('notatoken')).toBeNull();
  });

  test('returns null for empty/missing token', async () => {
    const kit = await freshKit();
    expect(await kit.verifyToken('')).toBeNull();
    expect(await kit.verifyToken(null)).toBeNull();
  });
});

describe('logout', () => {
  test('invalidates token', async () => {
    const kit = await freshKit();
    await createUser(kit);
    const { token } = await kit.login('user@example.com', 'password123');
    await kit.logout(token);
    expect(await kit.verifyToken(token)).toBeNull();
  });

  test('is a no-op for unknown token', async () => {
    const kit = await freshKit();
    await expect(kit.logout('bogus')).resolves.toBeUndefined();
  });
});

describe('refreshToken', () => {
  test('issues new token and invalidates old', async () => {
    const kit = await freshKit();
    await createUser(kit);
    const { token } = await kit.login('user@example.com', 'password123');
    const { token: newToken } = await kit.refreshToken(token);
    expect(newToken).not.toBe(token);
    expect(await kit.verifyToken(token)).toBeNull();
    expect(await kit.verifyToken(newToken)).not.toBeNull();
  });

  test('throws for invalid token', async () => {
    const kit = await freshKit();
    await expect(kit.refreshToken('bad')).rejects.toThrow();
  });
});

describe('changePassword', () => {
  test('changes password and invalidates sessions', async () => {
    const kit = await freshKit();
    await createUser(kit);
    const { token } = await kit.login('user@example.com', 'password123');
    await kit.changePassword((await kit.getUserByEmail('user@example.com')).id, 'password123', 'newpassword456');
    expect(await kit.verifyToken(token)).toBeNull(); // session invalidated
    const { token: t2 } = await kit.login('user@example.com', 'newpassword456');
    expect(await kit.verifyToken(t2)).not.toBeNull();
  });

  test('throws for wrong old password', async () => {
    const kit = await freshKit();
    const user = await createUser(kit);
    await expect(kit.changePassword(user.id, 'wrongold', 'newpassword456')).rejects.toThrow('incorrect');
  });
});

describe('resetPassword', () => {
  test('admin can reset without old password', async () => {
    const kit = await freshKit();
    const user = await createUser(kit);
    await kit.resetPassword(user.id, 'adminreset123');
    const { token } = await kit.login('user@example.com', 'adminreset123');
    expect(await kit.verifyToken(token)).not.toBeNull();
  });
});

// ============================================================================
// API KEYS
// ============================================================================

describe('createAPIKey', () => {
  test('returns key and record', async () => {
    const kit = await freshKit();
    const user = await createUser(kit);
    const { key, record } = await kit.createAPIKey(user.id, { name: 'my key' });
    expect(key).toMatch(/^ak_/);
    expect(record.name).toBe('my key');
    expect(record.key_hash).toBeUndefined(); // not exposed
  });

  test('key can be used to verify', async () => {
    const kit = await freshKit();
    const user = await createUser(kit);
    const { key } = await kit.createAPIKey(user.id);
    const verified = await kit.verifyToken(key);
    expect(verified.id).toBe(user.id);
  });
});

describe('revokeAPIKey', () => {
  test('revoked key no longer verifies', async () => {
    const kit = await freshKit();
    const user = await createUser(kit);
    const { key, record } = await kit.createAPIKey(user.id);
    await kit.revokeAPIKey(record.id);
    expect(await kit.verifyToken(key)).toBeNull();
  });
});

describe('listAPIKeys', () => {
  test('lists keys for user (no hashes)', async () => {
    const kit = await freshKit();
    const user = await createUser(kit);
    await kit.createAPIKey(user.id, { name: 'key1' });
    await kit.createAPIKey(user.id, { name: 'key2' });
    const keys = await kit.listAPIKeys(user.id);
    expect(keys.length).toBe(2);
    expect(keys[0].key_hash).toBeUndefined();
  });
});

// ============================================================================
// RBAC
// ============================================================================

describe('assignRole / removeRole', () => {
  test('assigns and removes role', async () => {
    const kit = await freshKit();
    const user = await createUser(kit);
    await kit.assignRole(user.id, 'admin');
    const after = await kit.getUser(user.id);
    expect(after.roles).toContain('admin');

    await kit.removeRole(user.id, 'admin');
    const final = await kit.getUser(user.id);
    expect(final.roles).not.toContain('admin');
  });

  test('assignRole is idempotent', async () => {
    const kit = await freshKit();
    const user = await createUser(kit, { roles: ['admin'] });
    await kit.assignRole(user.id, 'admin');
    const after = await kit.getUser(user.id);
    expect(after.roles.filter(r => r === 'admin').length).toBe(1);
  });
});

describe('hasRole / hasPermission', () => {
  test('hasRole checks user roles array', async () => {
    const kit = await freshKit();
    const user = await createUser(kit, { roles: ['admin'] });
    expect(kit.hasRole(user, 'admin')).toBe(true);
    expect(kit.hasRole(user, 'member')).toBe(false);
  });

  test('hasPermission uses roles config', async () => {
    const kit = await freshKit({
      roles: {
        admin: ['*'],
        member: ['read', 'write'],
        viewer: ['read'],
      }
    });
    const admin = await createUser(kit, { email: 'a@x.com', roles: ['admin'] });
    const member = await createUser(kit, { email: 'b@x.com', roles: ['member'] });
    const viewer = await createUser(kit, { email: 'c@x.com', roles: ['viewer'] });

    expect(kit.hasPermission(admin, 'delete')).toBe(true);   // * wildcard
    expect(kit.hasPermission(member, 'write')).toBe(true);
    expect(kit.hasPermission(member, 'delete')).toBe(false);
    expect(kit.hasPermission(viewer, 'write')).toBe(false);
  });
});

// ============================================================================
// EXPRESS MIDDLEWARE
// ============================================================================

describe('expressMiddleware', () => {
  test('populates req.user for valid Bearer token', async () => {
    const kit = await freshKit();
    await createUser(kit);
    const { token } = await kit.login('user@example.com', 'password123');

    const middleware = kit.expressMiddleware();
    const req = { headers: { authorization: `Bearer ${token}` } };
    const res = {};
    await new Promise(resolve => middleware(req, res, resolve));
    expect(req.user.email).toBe('user@example.com');
  });

  test('sets req.user to null for missing token', async () => {
    const kit = await freshKit();
    const middleware = kit.expressMiddleware();
    const req = { headers: {} };
    const res = {};
    await new Promise(resolve => middleware(req, res, resolve));
    expect(req.user).toBeNull();
  });
});

describe('requireAuth', () => {
  test('calls next for authenticated request', async () => {
    const kit = await freshKit();
    await createUser(kit);
    const { token } = await kit.login('user@example.com', 'password123');

    const mw = kit.expressMiddleware();
    const req = { headers: { authorization: `Bearer ${token}` } };
    const res = {};
    await new Promise(resolve => mw(req, res, resolve));

    const guardMw = kit.requireAuth();
    const next = jest.fn();
    guardMw(req, res, next);
    expect(next).toHaveBeenCalled();
  });

  test('returns 401 for unauthenticated request', async () => {
    const kit = await freshKit();
    const req = { user: null };
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    const next = jest.fn();
    kit.requireAuth()(req, res, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });
});

describe('requireRole', () => {
  test('returns 403 for wrong role', async () => {
    const kit = await freshKit();
    const req = { user: { roles: ['member'] } };
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    const next = jest.fn();
    kit.requireRole('admin')(req, res, next);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });

  test('calls next for correct role', async () => {
    const kit = await freshKit();
    const req = { user: { roles: ['admin'] } };
    const res = {};
    const next = jest.fn();
    kit.requireRole('admin')(req, res, next);
    expect(next).toHaveBeenCalled();
  });
});
