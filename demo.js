/**
 * AuthKit - Demo Script
 *
 * Run: node demo.js
 */

const { AuthKit } = require('./index.js');

async function main() {
  console.log('\n🔐 AuthKit Demo\n');

  // ── 1. Initialize ────────────────────────────────────────────────────────
  const auth = await AuthKit.create({
    tokenExpiry: '1h',
    passwordPolicy: { minLength: 8, requireUppercase: false },
    roles: {
      admin:  ['*'],
      member: ['read', 'write'],
      viewer: ['read'],
    },
  });

  console.log('✅ AuthKit initialized (in-memory)\n');

  // ── 2. Listen to events ──────────────────────────────────────────────────
  auth.on('user:created',   u   => console.log(`  [event] user:created → ${u.email}`));
  auth.on('user:login',     ({ user }) => console.log(`  [event] user:login  → ${user.email}`));
  auth.on('user:logout',    ({ user_id }) => console.log(`  [event] user:logout → ${user_id}`));
  auth.on('apikey:created', ({ user_id, name }) => console.log(`  [event] apikey:created → ${name || 'unnamed'} for ${user_id}`));

  // ── 3. Create users ──────────────────────────────────────────────────────
  console.log('── Users ───────────────────────────────────────────');
  const admin = await auth.createUser({
    email: 'admin@example.com',
    password: 'supersecret1',
    username: 'admin',
    roles: ['admin'],
  });
  console.log('Created admin:', admin.email, '| roles:', admin.roles);

  const alice = await auth.createUser({
    email: 'alice@example.com',
    password: 'alicepw123',
    username: 'alice',
    roles: ['member'],
  });
  console.log('Created alice:', alice.email, '| roles:', alice.roles);

  const users = await auth.listUsers();
  console.log('Total users:', users.length);

  // ── 4. Login ─────────────────────────────────────────────────────────────
  console.log('\n── Authentication ──────────────────────────────────');
  const session = await auth.login('alice@example.com', 'alicepw123');
  console.log('Login OK → token (first 16):', session.token.slice(0, 16) + '...');
  console.log('Expires:', session.expiresAt);

  // bad password
  try {
    await auth.login('alice@example.com', 'wrongpassword');
  } catch (e) {
    console.log('Bad password caught:', e.message);
  }

  // ── 5. Verify token ──────────────────────────────────────────────────────
  console.log('\n── Token Verification ──────────────────────────────');
  const verified = await auth.verifyToken(session.token);
  console.log('Verified user:', verified.email);

  const bogus = await auth.verifyToken('notavalidtoken');
  console.log('Bogus token result:', bogus); // null

  // ── 6. Refresh ───────────────────────────────────────────────────────────
  const refreshed = await auth.refreshToken(session.token);
  console.log('Refreshed token (first 16):', refreshed.token.slice(0, 16) + '...');

  // old token is now invalid
  const oldVerify = await auth.verifyToken(session.token);
  console.log('Old token after refresh:', oldVerify); // null

  // ── 7. API Keys ───────────────────────────────────────────────────────────
  console.log('\n── API Keys ────────────────────────────────────────');
  const { key, record } = await auth.createAPIKey(alice.id, { name: 'CI/CD pipeline' });
  console.log('API key created:', key.slice(0, 12) + '...');
  console.log('Key record:', record.name, '| id:', record.id);

  const verifiedByKey = await auth.verifyToken(key);
  console.log('Verified via API key:', verifiedByKey.email);

  const keys = await auth.listAPIKeys(alice.id);
  console.log('Alice\'s API keys:', keys.length);

  await auth.revokeAPIKey(record.id);
  const afterRevoke = await auth.verifyToken(key);
  console.log('After revoke:', afterRevoke); // null

  // ── 8. RBAC ──────────────────────────────────────────────────────────────
  console.log('\n── Roles & Permissions ─────────────────────────────');
  console.log('alice isAdmin:', auth.hasRole(alice, 'admin'));      // false
  console.log('admin isAdmin:', auth.hasRole(admin, 'admin'));      // true
  console.log('alice canWrite:', auth.hasPermission(alice, 'write')); // true
  console.log('alice canDelete:', auth.hasPermission(alice, 'delete')); // false

  await auth.assignRole(alice.id, 'admin');
  const aliceNow = await auth.getUser(alice.id);
  console.log('alice roles after promote:', aliceNow.roles);

  await auth.removeRole(alice.id, 'admin');
  const aliceAfter = await auth.getUser(alice.id);
  console.log('alice roles after demote:', aliceAfter.roles);

  // ── 9. Change password ───────────────────────────────────────────────────
  console.log('\n── Password Management ─────────────────────────────');
  await auth.changePassword(alice.id, 'alicepw123', 'newSecurePass99');
  console.log('Password changed OK');

  try {
    await auth.changePassword(alice.id, 'alicepw123', 'anotherPass');
  } catch (e) {
    console.log('Wrong old password caught:', e.message);
  }

  // admin reset
  await auth.resetPassword(alice.id, 'adminResetPass1');
  console.log('Admin password reset OK');

  // ── 10. Logout ────────────────────────────────────────────────────────────
  console.log('\n── Logout ──────────────────────────────────────────');
  const session2 = await auth.login('admin@example.com', 'supersecret1');
  await auth.logout(session2.token);
  const afterLogout = await auth.verifyToken(session2.token);
  console.log('Token after logout:', afterLogout); // null

  // ── 11. Cleanup ───────────────────────────────────────────────────────────
  await auth.close();
  console.log('\n✅ Demo complete\n');
}

main().catch(err => {
  console.error('Demo error:', err);
  process.exit(1);
});
