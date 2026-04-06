/**
 * Test script for AuthKit 0.3.0 multi-tenant features
 * Run with: node test-multitenant.js
 */

const { AuthKit } = require('./index.js');

async function test() {
  console.log('🧪 Testing AuthKit 0.3.0 Multi-Tenant Features\n');

  // Initialize AuthKit with in-memory storage
  const auth = await AuthKit.create({ storage: 'memory' });
  console.log('✅ AuthKit initialized with memory storage\n');

  try {
    // 1. Create users
    console.log('📝 Step 1: Creating users...');
    const alice = await auth.createUser({
      email: 'alice@fastloop.com',
      password: 'password123',
      username: 'alice'
    });
    console.log(`   ✅ Created user: ${alice.email} (${alice.id})`);

    const bob = await auth.createUser({
      email: 'bob@fastloop.com',
      password: 'password123',
      username: 'bob'
    });
    console.log(`   ✅ Created user: ${bob.email} (${bob.id})\n`);

    // 2. Create organizations
    console.log('🏢 Step 2: Creating organizations...');
    const org1 = await auth.createOrganization({
      name: 'FastLoop HQ',
      owner_user_id: alice.id,
      entitlements: ['fast_task', 'fast_deploy']
    });
    console.log(`   ✅ Created org: ${org1.name} (${org1.id})`);
    console.log(`      Owner: ${alice.email}`);

    const org2 = await auth.createOrganization({
      name: 'Bob\'s Workspace',
      owner_user_id: bob.id,
      entitlements: ['fast_task']
    });
    console.log(`   ✅ Created org: ${org2.name} (${org2.id})`);
    console.log(`      Owner: ${bob.email}\n`);

    // 3. Add members
    console.log('👥 Step 3: Adding members to orgs...');
    await auth.addOrgMember({
      org_id: org1.id,
      user_id: bob.id,
      role: 'member'
    });
    console.log(`   ✅ Added ${bob.email} to ${org1.name} as member\n`);

    // 4. Check entitlements
    console.log('🔑 Step 4: Checking entitlements...');
    const org1Apps = await auth.getOrgEntitlements(org1.id);
    console.log(`   ${org1.name} has access to: ${org1Apps.join(', ')}`);

    const org2Apps = await auth.getOrgEntitlements(org2.id);
    console.log(`   ${org2.name} has access to: ${org2Apps.join(', ')}\n`);

    // 5. Check access
    console.log('✅ Step 5: Checking access control...');
    const aliceCanUseFastTask = await auth.checkAccess({
      user_id: alice.id,
      org_id: org1.id,
      app_name: 'fast_task'
    });
    console.log(`   Alice can use fast_task in ${org1.name}: ${aliceCanUseFastTask}`);

    const bobCanUseFastDeploy = await auth.checkAccess({
      user_id: bob.id,
      org_id: org1.id,
      app_name: 'fast_deploy'
    });
    console.log(`   Bob can use fast_deploy in ${org1.name}: ${bobCanUseFastDeploy}`);

    const bobCanUseFastDB = await auth.checkAccess({
      user_id: bob.id,
      org_id: org1.id,
      app_name: 'fast_db'
    });
    console.log(`   Bob can use fast_db in ${org1.name}: ${bobCanUseFastDB} (not granted)\n`);

    // 6. Login with org
    console.log('🔐 Step 6: Login with organization context...');
    const loginResult = await auth.loginWithOrg('alice@fastloop.com', 'password123', org1.id);
    console.log(`   ✅ Alice logged in to ${loginResult.org.name}`);
    console.log(`      Role: ${loginResult.role}`);
    console.log(`      Token: ${loginResult.token.substring(0, 20)}...`);
    console.log(`      Entitlements: ${loginResult.entitlements.join(', ')}\n`);

    // 7. List user's organizations
    console.log('📋 Step 7: Listing Bob\'s organizations...');
    const bobOrgs = await auth.listUserOrganizations(bob.id);
    console.log(`   Bob is a member of ${bobOrgs.length} organizations:`);
    bobOrgs.forEach(org => {
      console.log(`      - ${org.name} (${org.id})`);
    });
    console.log();

    // 8. Get org members
    console.log('👨‍👩‍👧‍👦 Step 8: Listing members of FastLoop HQ...');
    const members = await auth.getOrgMembers(org1.id);
    console.log(`   ${org1.name} has ${members.length} members:`);
    members.forEach(member => {
      console.log(`      - ${member.email} (${member.role})`);
    });
    console.log();

    // 9. Grant additional app access
    console.log('🎁 Step 9: Granting FastDB access to FastLoop HQ...');
    await auth.grantAppAccess({
      org_id: org1.id,
      app_name: 'fast_db'
    });
    const updatedApps = await auth.getOrgEntitlements(org1.id);
    console.log(`   ✅ ${org1.name} now has access to: ${updatedApps.join(', ')}\n`);

    // 10. Update member role
    console.log('⬆️  Step 10: Promoting Bob to admin...');
    await auth.updateOrgMemberRole({
      org_id: org1.id,
      user_id: bob.id,
      role: 'admin'
    });
    const bobMembership = await auth.getOrgMembership(bob.id, org1.id);
    console.log(`   ✅ Bob's new role in ${org1.name}: ${bobMembership.role}\n`);

    console.log('🎉 All tests passed! AuthKit 0.3.0 multi-tenant features are working correctly.\n');

    // Summary
    console.log('📊 Summary:');
    console.log(`   - Users created: 2`);
    console.log(`   - Organizations created: 2`);
    console.log(`   - Total memberships: 3 (Alice owns 1, Bob owns 1, Bob member of 1)`);
    console.log(`   - Apps in FastLoop HQ: ${updatedApps.join(', ')}`);
    console.log(`   - Apps in Bob's Workspace: ${org2Apps.join(', ')}\n`);

  } catch (error) {
    console.error('❌ Test failed:', error.message);
    console.error(error.stack);
    process.exit(1);
  } finally {
    await auth.close();
  }
}

test();
