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
        client: 'sqlite3',
        connection: { filename: require('path').join(__dirname, '..', 'crimson-creek.db') },
        useNullAsDefault: true,
      }
);

async function createIfMissing(tableName, builder) {
  const exists = await knex.schema.hasTable(tableName);
  if (!exists) {
    await knex.schema.createTable(tableName, builder);
    console.log(`  ↳ Created table ${tableName}`);
  }
}

async function setupDatabase() {
  // users — create without unique constraint, add it separately if missing
  await createIfMissing('users', t => {
    t.string('id').primary();
    t.string('discord_id').notNullable();
    t.string('username').notNullable();
    t.string('discriminator');
    t.string('avatar');
    t.string('role').defaultTo('member');
    t.string('sub_tier').defaultTo('member');
    t.text('permissions').defaultTo('{}');
    t.datetime('created_at').defaultTo(knex.fn.now());
    t.datetime('last_login').defaultTo(knex.fn.now());
  });

  // Add unique constraint on discord_id only if it doesn't already exist
  if (process.env.DATABASE_URL) {
    try {
      await knex.schema.table('users', t => t.unique(['discord_id']));
    } catch (e) {
      if (!e.message.includes('already exists')) throw e;
    }
  } else {
    const hasUnique = await knex.schema.hasColumn('users', 'discord_id');
    if (hasUnique) {
      try { await knex.schema.table('users', t => t.unique(['discord_id'])); } catch (_) {}
    }
  }

  await createIfMissing('appeals', t => {
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

  await createIfMissing('applications', t => {
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

  await createIfMissing('tickets', t => {
    t.increments('id').primary();
    t.string('user_id').notNullable();
    t.string('subject').notNullable();
    t.string('category').notNullable();
    t.text('body').notNullable();
    t.string('status').defaultTo('open');
    t.text('staff_reply'); // legacy — kept for backwards compat, no longer written
    t.datetime('created_at').defaultTo(knex.fn.now());
    t.datetime('updated_at').defaultTo(knex.fn.now());
  });

  // ── ticket_messages: full conversation thread per ticket ──────────────────
  await createIfMissing('ticket_messages', t => {
    t.increments('id').primary();
    t.integer('ticket_id').notNullable().references('id').inTable('tickets').onDelete('CASCADE');
    t.string('sender_id').notNullable();      // user.id (discord snowflake string)
    t.string('sender_username').notNullable(); // display name
    t.boolean('is_staff').defaultTo(false);
    t.text('body').notNullable();
    t.datetime('created_at').defaultTo(knex.fn.now());
  });

  // ── Migrate old single staff_reply rows into ticket_messages ─────────────
  {
    const legacyTickets = await knex('tickets')
      .whereNotNull('staff_reply')
      .whereRaw("staff_reply != ''");
    for (const t of legacyTickets) {
      const alreadyMigrated = await knex('ticket_messages')
        .where('ticket_id', t.id)
        .where('is_staff', true)
        .first();
      if (!alreadyMigrated) {
        await knex('ticket_messages').insert({
          ticket_id: t.id,
          sender_id: 'legacy',
          sender_username: 'Staff',
          is_staff: true,
          body: t.staff_reply,
          created_at: t.updated_at || t.created_at,
        });
        console.log(`  ↳ Migrated legacy staff_reply for ticket #${t.id}`);
      }
    }
  }

  await createIfMissing('action_log', t => {
    t.increments('id').primary();
    t.string('action').notNullable();
    t.string('performed_by').notNullable();
    t.string('target');
    t.text('details');
    t.datetime('created_at').defaultTo(knex.fn.now());
  });

  await createIfMissing('announcements', t => {
    t.increments('id').primary();
    t.string('title').notNullable();
    t.text('body').notNullable();
    t.boolean('pinned').defaultTo(false);
    t.string('author').notNullable();
    t.datetime('created_at').defaultTo(knex.fn.now());
  });

  await createIfMissing('staff_notes', t => {
    t.increments('id').primary();
    t.string('target_username').notNullable();
    t.text('note').notNullable();
    t.string('author_id').notNullable();
    t.string('author_username').notNullable();
    t.datetime('created_at').defaultTo(knex.fn.now());
  });

  // Sessions table owned by connect-pg-simple in Postgres.
  if (!process.env.DATABASE_URL) {
    await createIfMissing('sessions', t => {
      t.string('sid').primary();
      t.text('sess').notNullable();
      t.datetime('expired').notNullable();
    });
  }

  // Column migrations for applications
  const appMigrations = [
    { name: 'age_confirm',         add: t => t.text('age_confirm')          },
    { name: 'has_microphone',      add: t => t.text('has_microphone')       },
    { name: 'rp_clips',            add: t => t.text('rp_clips')             },
    { name: 'been_banned',         add: t => t.text('been_banned')          },
    { name: 'looking_forward',     add: t => t.text('looking_forward')      },
    { name: 'what_is_failrp',      add: t => t.text('what_is_failrp')       },
    { name: 'what_is_powergaming', add: t => t.text('what_is_powergaming')  },
    { name: 'robbery_cooldown',    add: t => t.text('robbery_cooldown')     },
    { name: 'wrongful_accusation', add: t => t.text('wrongful_accusation')  },
    { name: 'secret_code',         add: t => t.string('secret_code')        },
    { name: 'thread_id',           add: t => t.string('thread_id')          },
  ];
  for (const col of appMigrations) {
    const exists = await knex.schema.hasColumn('applications', col.name);
    if (!exists) {
      await knex.schema.table('applications', col.add);
      console.log(`  ↳ Added column applications.${col.name}`);
    }
  }

  // Add discord_message_id to announcements for two-way sync
  {
    const has = await knex.schema.hasColumn('announcements', 'discord_message_id');
    if (!has) {
      await knex.schema.table('announcements', t => t.string('discord_message_id'));
      console.log('  ↳ Added column announcements.discord_message_id');
    }
  }

  // Fix sessions table — if it has 'expired' column (old SQLite schema) drop it
  // so connect-pg-simple can recreate it correctly with 'expire' column
  if (process.env.DATABASE_URL) {
    const sessExists = await knex.schema.hasTable('sessions');
    if (sessExists) {
      const hasWrongCol = await knex.schema.hasColumn('sessions', 'expired');
      if (hasWrongCol) {
        await knex.schema.dropTable('sessions');
        console.log('  ↳ Dropped old sessions table (wrong column name), will be recreated by connect-pg-simple');
      }
    }
  }

  console.log('✅ Database tables ready');
}

module.exports = { db: knex, setupDatabase };