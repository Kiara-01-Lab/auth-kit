/**
 * Migration Script: Copy FastTask subscriptions to AuthKit
 *
 * This script migrates existing subscriptions from FastTask to AuthKit
 * Run this ONCE after setting up AuthKit subscription tables
 *
 * Usage:
 *   FASTTASK_DB_URL=<url> AUTHKIT_DB_URL=<url> node migrations/migrate-fasttask-subscriptions.js
 */

const { Pool } = require('pg');

const FASTTASK_DB_URL = process.env.FASTTASK_DB_URL || process.env.DATABASE_URL;
const AUTHKIT_DB_URL = process.env.AUTHKIT_DB_URL;

if (!FASTTASK_DB_URL) {
  console.error('❌ FASTTASK_DB_URL environment variable is required');
  process.exit(1);
}

if (!AUTHKIT_DB_URL) {
  console.error('❌ AUTHKIT_DB_URL environment variable is required');
  process.exit(1);
}

async function migrate() {
  console.log('🚀 Starting FastTask → AuthKit subscription migration...\n');

  const fastTaskPool = new Pool({
    connectionString: FASTTASK_DB_URL,
    ssl: { rejectUnauthorized: false },
  });

  const authKitPool = new Pool({
    connectionString: AUTHKIT_DB_URL,
    ssl: { rejectUnauthorized: false },
  });

  try {
    // 1. Migrate subscription plans
    console.log('📋 Step 1: Migrating subscription plans...');
    const plansResult = await fastTaskPool.query('SELECT * FROM subscription_plans ORDER BY sort_order ASC');
    const plans = plansResult.rows;

    console.log(`   Found ${plans.length} plans in FastTask`);

    for (const plan of plans) {
      // Check if plan already exists in AuthKit
      const existing = await authKitPool.query(
        'SELECT id FROM subscription_plans WHERE name = $1',
        [plan.name]
      );

      if (existing.rows.length > 0) {
        console.log(`   ⚠️  Plan "${plan.name}" already exists in AuthKit, skipping...`);
        continue;
      }

      await authKitPool.query(
        `INSERT INTO subscription_plans (id, name, display_name, description, stripe_product_id, stripe_price_id, stripe_price_id_yearly, price_monthly, price_yearly, currency, features, is_active, sort_order, recommended, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)`,
        [
          plan.id,
          plan.name,
          plan.display_name,
          plan.description,
          plan.stripe_product_id,
          plan.stripe_price_id,
          plan.stripe_price_id_yearly,
          plan.price_monthly,
          plan.price_yearly,
          plan.currency,
          plan.features,
          plan.is_active,
          plan.sort_order,
          plan.recommended,
          plan.created_at,
          plan.updated_at,
        ]
      );

      console.log(`   ✅ Migrated plan: ${plan.name}`);
    }

    // 2. Migrate subscriptions
    console.log('\n💳 Step 2: Migrating user subscriptions...');
    const subsResult = await fastTaskPool.query(`
      SELECT s.*, u.email as user_email
      FROM subscriptions s
      JOIN users u ON u.id = s.user_id
      ORDER BY s.created_at ASC
    `);
    const subscriptions = subsResult.rows;

    console.log(`   Found ${subscriptions.length} subscriptions in FastTask`);

    let migrated = 0;
    let skipped = 0;

    for (const sub of subscriptions) {
      // Check if user exists in AuthKit
      const userCheck = await authKitPool.query(
        'SELECT id FROM users WHERE email = $1',
        [sub.user_email]
      );

      if (userCheck.rows.length === 0) {
        console.log(`   ⚠️  User ${sub.user_email} not found in AuthKit, skipping subscription...`);
        skipped++;
        continue;
      }

      const authKitUserId = userCheck.rows[0].id;

      // Check if subscription already exists
      const existingSub = await authKitPool.query(
        'SELECT id FROM subscriptions WHERE user_id = $1 AND plan_id = $2',
        [authKitUserId, sub.plan_id]
      );

      if (existingSub.rows.length > 0) {
        console.log(`   ⚠️  Subscription already exists for user ${sub.user_email}, skipping...`);
        skipped++;
        continue;
      }

      // Insert subscription
      await authKitPool.query(
        `INSERT INTO subscriptions (id, user_id, plan_id, status, stripe_customer_id, stripe_subscription_id, stripe_latest_invoice_id, stripe_payment_intent_status, billing_cycle, feature_overrides, trial_start, trial_end, current_period_start, current_period_end, cancel_at_period_end, cancelled_at, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)`,
        [
          sub.id,
          authKitUserId,
          sub.plan_id,
          sub.status,
          sub.stripe_customer_id,
          sub.stripe_subscription_id,
          sub.stripe_latest_invoice_id,
          sub.stripe_payment_intent_status,
          sub.billing_cycle,
          sub.feature_overrides,
          sub.trial_start,
          sub.trial_end,
          sub.current_period_start,
          sub.current_period_end,
          sub.cancel_at_period_end,
          sub.cancelled_at,
          sub.created_at,
          sub.updated_at,
        ]
      );

      migrated++;
    }

    console.log(`   ✅ Migrated ${migrated} subscriptions`);
    if (skipped > 0) {
      console.log(`   ⚠️  Skipped ${skipped} subscriptions`);
    }

    // 3. Migrate usage records
    console.log('\n📊 Step 3: Migrating usage records...');
    const usageResult = await fastTaskPool.query(`
      SELECT u.*, us.email as user_email
      FROM subscription_usage u
      JOIN users us ON us.id = u.user_id
      ORDER BY u.created_at ASC
    `);
    const usageRecords = usageResult.rows;

    console.log(`   Found ${usageRecords.length} usage records in FastTask`);

    let usageMigrated = 0;
    let usageSkipped = 0;

    for (const usage of usageRecords) {
      // Get AuthKit user ID
      const userCheck = await authKitPool.query(
        'SELECT id FROM users WHERE email = $1',
        [usage.user_email]
      );

      if (userCheck.rows.length === 0) {
        usageSkipped++;
        continue;
      }

      const authKitUserId = userCheck.rows[0].id;

      // Check if usage record already exists
      const existingUsage = await authKitPool.query(
        'SELECT id FROM subscription_usage WHERE user_id = $1 AND period_start = $2',
        [authKitUserId, usage.period_start]
      );

      if (existingUsage.rows.length > 0) {
        usageSkipped++;
        continue;
      }

      // Get AuthKit subscription ID
      const subCheck = await authKitPool.query(
        'SELECT id FROM subscriptions WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1',
        [authKitUserId]
      );

      if (subCheck.rows.length === 0) {
        usageSkipped++;
        continue;
      }

      const authKitSubId = subCheck.rows[0].id;

      await authKitPool.query(
        `INSERT INTO subscription_usage (id, user_id, subscription_id, period_start, period_end, boards_count, tickets_count, storage_used_mb, ai_tokens_used, translation_requests_count, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
        [
          usage.id,
          authKitUserId,
          authKitSubId,
          usage.period_start,
          usage.period_end,
          usage.boards_count || 0,
          usage.tickets_count || 0,
          usage.storage_used_mb || 0,
          usage.ai_requests_count || 0, // Note: FastTask uses ai_requests_count, AuthKit uses ai_tokens_used
          usage.translation_requests_count || 0,
          usage.created_at,
          usage.updated_at,
        ]
      );

      usageMigrated++;
    }

    console.log(`   ✅ Migrated ${usageMigrated} usage records`);
    if (usageSkipped > 0) {
      console.log(`   ⚠️  Skipped ${usageSkipped} usage records`);
    }

    console.log('\n✅ Migration completed successfully!\n');
    console.log('📝 Summary:');
    console.log(`   - Plans: ${plans.length}`);
    console.log(`   - Subscriptions: ${migrated} migrated, ${skipped} skipped`);
    console.log(`   - Usage records: ${usageMigrated} migrated, ${usageSkipped} skipped`);

  } catch (error) {
    console.error('\n❌ Migration failed:', error);
    throw error;
  } finally {
    await fastTaskPool.end();
    await authKitPool.end();
  }
}

// Run migration
migrate().catch(err => {
  console.error(err);
  process.exit(1);
});
