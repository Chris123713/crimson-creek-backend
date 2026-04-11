const path = require('path');
const knex = require('knex')({
  client: 'sqlite3',
  connection: { filename: path.join(__dirname, '..', 'crimson-creek.db') },
  useNullAsDefault: true,
});

async function setupDatabase() {
  await knex.schema.createTableIfNotExists('users', t => {
    t.string('id').primary();
    t.string('discord_id').unique().notNullable();
    t.string('username').notNullable();
    t.string('discriminator');
    t.string('avatar');
    t.string('role').defaultTo('member');
    t.string('sub_tier').defaultTo('member');
    t.text('permissions').defaultTo('{}');
    t.datetime('created_at').defaultTo(knex.fn.now());
    t.datetime('last_login').defaultTo(knex.fn.now());
  });
  await knex.schema.createTableIfNotExists('appeals', t => {
    t.increments('id').primary();
    t.string('user_id').notNullable();
    t.string('player').notNullable();
    t.string('discord_tag').notNullable();
    t.string('steam_id').notNullable();
    t.text('ban_reason').notNullable();
    t.text('story').notNullable();
    t.string('status').defaultTo('pending');
    t.string('reviewer_id');
    t.text('reviewer_note');
    t.datetime('created_at').defaultTo(knex.fn.now());
    t.datetime('updated_at').defaultTo(knex.fn.now());
  });
  await knex.schema.createTableIfNotExists('applications', t => {
    t.increments('id').primary();
    t.string('user_id').notNullable();
    t.string('player').notNullable();
    t.string('discord_tag').notNullable();
    t.integer('age').notNullable();
    t.text('rp_experience').notNullable();
    t.string('char_name').notNullable();
    t.text('char_background').notNullable();
    t.text('why_join').notNullable();
    t.string('status').defaultTo('pending');
    t.string('reviewer_id');
    t.text('reviewer_note');
    t.datetime('created_at').defaultTo(knex.fn.now());
    t.datetime('updated_at').defaultTo(knex.fn.now());
  });
  await knex.schema.createTableIfNotExists('tickets', t => {
    t.increments('id').primary();
    t.string('user_id').notNullable();
    t.string('subject').notNullable();
    t.string('category').notNullable();
    t.text('body').notNullable();
    t.string('status').defaultTo('open');
    t.text('staff_reply');
    t.datetime('created_at').defaultTo(knex.fn.now());
    t.datetime('updated_at').defaultTo(knex.fn.now());
  });
  await knex.schema.createTableIfNotExists('action_log', t => {
    t.increments('id').primary();
    t.string('action').notNullable();
    t.string('performed_by').notNullable();
    t.string('target');
    t.text('details');
    t.datetime('created_at').defaultTo(knex.fn.now());
  });
  await knex.schema.createTableIfNotExists('sessions', t => {
    t.string('sid').primary();
    t.text('sess').notNullable();
    t.datetime('expired').notNullable();
  });
  await knex.schema.createTableIfNotExists('users', t => {}).catch(() => {});
  // Migrations — safe to run on every startup, each is a no-op if column exists
  const appMigrations = [
    { col: 'thread_id',           add: t => t.string('thread_id').nullable() },
    { col: 'age_confirm',         add: t => t.text('age_confirm').nullable() },
    { col: 'has_microphone',      add: t => t.text('has_microphone').nullable() },
    { col: 'rp_clips',            add: t => t.text('rp_clips').nullable() },
    { col: 'been_banned',         add: t => t.text('been_banned').nullable() },
    { col: 'looking_forward',     add: t => t.text('looking_forward').nullable() },
    { col: 'what_is_failrp',      add: t => t.text('what_is_failrp').nullable() },
    { col: 'what_is_powergaming', add: t => t.text('what_is_powergaming').nullable() },
    { col: 'robbery_cooldown',    add: t => t.text('robbery_cooldown').nullable() },
    { col: 'wrongful_accusation', add: t => t.text('wrongful_accusation').nullable() },
    { col: 'secret_code',         add: t => t.string('secret_code').nullable() },
  ];
  for (const m of appMigrations) {
    const exists = await knex.schema.hasColumn('applications', m.col);
    if (!exists) {
      await knex.schema.alterTable('applications', m.add);
      console.log(`✅ Migrated: applications.${m.col} added`);
    }
  }

  console.log('✅ Database tables ready');
}

module.exports = { db: knex, setupDatabase };