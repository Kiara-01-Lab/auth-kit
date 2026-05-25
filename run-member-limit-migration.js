#!/usr/bin/env node

/**
 * Run migration to update free plan with max_board_members: 3
 */

const { Pool } = require('pg');
const fs = require('fs');

// Read DATABASE_URL from .env manually
const envFile = fs.readFileSync('.env', 'utf-8');
const dbUrlMatch = envFile.match(/DATABASE_URL=(.+)/);
if (!dbUrlMatch) {
  console.error('❌ DATABASE_URL not found in .env');
  process.exit(1);
}
process.env.DATABASE_URL = dbUrlMatch[1].trim();

async function runMigration() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_URL.includes('.render.com') ? { rejectUnauthorized: false } : false
  });

  try {
    console.log('🔄 Running free plan member limit migration...\n');

    // Update free plan
    const updateResult = await pool.query(`
      UPDATE subscription_plans
      SET features = jsonb_set(
        COALESCE(features, '{}'::jsonb),
        '{max_board_members}',
        '3'::jsonb
      )
      WHERE name = 'free'
      RETURNING name, features->>'max_board_members' as max_board_members
    `);

    if (updateResult.rows.length > 0) {
      console.log('✅ Free plan updated:');
      console.log(`   max_board_members: ${updateResult.rows[0].max_board_members}\n`);
    } else {
      console.log('⚠️  No free plan found to update\n');
    }

    // Verify all plans
    const verifyResult = await pool.query(`
      SELECT name, features->>'max_board_members' as max_board_members
      FROM subscription_plans
      WHERE name IN ('free', 'trial', 'micro', 'start', 'business')
      ORDER BY sort_order
    `);

    console.log('📋 All plan limits:');
    verifyResult.rows.forEach(row => {
      const limit = row.max_board_members || 'unlimited';
      console.log(`   ${row.name.padEnd(10)} → ${limit} members per board`);
    });

    console.log('\n✅ Migration completed successfully!');
  } catch (error) {
    console.error('❌ Migration failed:', error.message);
    throw error;
  } finally {
    await pool.end();
  }
}

runMigration();
