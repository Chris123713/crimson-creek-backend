const knex = require('knex')(
  process.env.DATABASE_URL
    ? {
        client: 'pg',
        connection: {
          connectionString: process.env.DATABASE_URL,
          ssl: { rejectUnauthorized: false },
        },
      }
    : {
        // Local fallback — SQLite for dev
        client: 'sqlite3',
        connection: { filename: require('path').join(__dirname, '..', 'crimson-creek.db') },
        useNullAsDefault: true,
      }
);

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
    t.string('thread_id');
    t.text('age_confirm');
    t.text('has_microphone');
    t.text('rp_clips');
    t.text('been_banned');
    t.text('looking_forward');
    t.text('what_is_failrp');
    t.text('what_is_powergaming');
    t.text('robbery_cooldown');
    t.text('wrongful_accusation');
    t.string('secret_code');
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

  // ── Migrate: add any missing columns to applications table ──────────────────
  // createTableIfNotExists won't alter an existing table, so we manually add
  // columns introduced after the initial deploy.
  const appMigrations = [
    { name: 'age_confirm',        add: t => t.text('age_confirm')         },
    { name: 'has_microphone',     add: t => t.text('has_microphone')      },
    { name: 'rp_clips',          add: t => t.text('rp_clips')            },
    { name: 'been_banned',        add: t => t.text('been_banned')         },
    { name: 'looking_forward',    add: t => t.text('looking_forward')     },
    { name: 'what_is_failrp',     add: t => t.text('what_is_failrp')      },
    { name: 'what_is_powergaming',add: t => t.text('what_is_powergaming') },
    { name: 'robbery_cooldown',   add: t => t.text('robbery_cooldown')    },
    { name: 'wrongful_accusation',add: t => t.text('wrongful_accusation') },
    { name: 'secret_code',        add: t => t.string('secret_code')       },
    { name: 'thread_id',          add: t => t.string('thread_id')         },
  ];
  for (const col of appMigrations) {
    const exists = await knex.schema.hasColumn('applications', col.name);
    if (!exists) {
      await knex.schema.table('applications', col.add);
      console.log(`  ↳ Added column applications.${col.name}`);
    }
  }

  await knex.schema.createTableIfNotExists('staff_notes', t => {
    t.increments('id').primary();
    t.string('target_username').notNullable();
    t.text('note').notNullable();
    t.string('author_id').notNullable();
    t.string('author_username').notNullable();
    t.datetime('created_at').defaultTo(knex.fn.now());
  });

  console.log('✅ Database tables ready');
}

module.exports = { db: knex, setupDatabase };