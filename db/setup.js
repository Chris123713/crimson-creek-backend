const Database = require('better-sqlite3');
const path = require('path');

const db = new Database(path.join(__dirname, '..', 'crimson-creek.db'));

db.pragma('journal_mode = WAL');

function setupDatabase() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      discord_id TEXT UNIQUE NOT NULL,
      username TEXT NOT NULL,
      discriminator TEXT,
      avatar TEXT,
      role TEXT DEFAULT 'member',
      sub_tier TEXT DEFAULT 'member',
      permissions TEXT DEFAULT '{}',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      last_login DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS appeals (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      player TEXT NOT NULL,
      discord_tag TEXT NOT NULL,
      steam_id TEXT NOT NULL,
      ban_reason TEXT NOT NULL,
      story TEXT NOT NULL,
      status TEXT DEFAULT 'pending',
      reviewer_id TEXT,
      reviewer_note TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS applications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      player TEXT NOT NULL,
      discord_tag TEXT NOT NULL,
      age INTEGER NOT NULL,
      rp_experience TEXT NOT NULL,
      char_name TEXT NOT NULL,
      char_background TEXT NOT NULL,
      why_join TEXT NOT NULL,
      status TEXT DEFAULT 'pending',
      reviewer_id TEXT,
      reviewer_note TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS tickets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      subject TEXT NOT NULL,
      category TEXT NOT NULL,
      body TEXT NOT NULL,
      status TEXT DEFAULT 'open',
      messages TEXT DEFAULT '[]',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS bans (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      player TEXT NOT NULL,
      discord TEXT,
      steam TEXT,
      license TEXT,
      reason TEXT NOT NULL,
      banned_by TEXT NOT NULL,
      permanent INTEGER DEFAULT 1,
      duration_hours INTEGER,
      source TEXT DEFAULT 'site',
      active INTEGER DEFAULT 1,
      removed_by TEXT,
      removed_at DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS action_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      action TEXT NOT NULL,
      performed_by TEXT NOT NULL,
      target TEXT,
      details TEXT,
      source TEXT DEFAULT 'site',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS sessions (
      sid TEXT PRIMARY KEY,
      sess TEXT NOT NULL,
      expired DATETIME NOT NULL
    );
  `);
  console.log('✅ Database tables ready');
}

module.exports = { db, setupDatabase };
