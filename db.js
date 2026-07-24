import sqlite3 from 'sqlite3';
import path from 'path';

const dbPath = path.resolve('data.db');
const db = new sqlite3.Database(dbPath);

// Helper functions to use async/await with sqlite3
export function dbRun(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) reject(err);
      else resolve({ id: this.lastID, changes: this.changes });
    });
  });
}

export function dbGet(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) reject(err);
      else resolve(row);
    });
  });
}

export function dbAll(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
}

const defaultAuthorized = [
  { phone: "553497674564", name: "Guilherme Franco" },
  { phone: "553499375206", name: "Franco Dev" },
  { phone: "553496551533", name: "Contato Fin 1" },
  { phone: "553492253843", name: "Contato Fin 2" },
  { phone: "553491039694", name: "Contato Fin 3" },
  { phone: "553496676433", name: "Contato Fin 4" },
  { phone: "553491594443", name: "Contato Fin 5" },
  { phone: "553498960343", name: "Contato Fin 6" },
  { phone: "553491493074", name: "Contato Fin 7" },
  { phone: "553891613037", name: "Contato Fin 8" },
  { phone: "553491095638", name: "Contato Fin 9" }
];

export async function initDb() {
  // Create users table
  await dbRun(`
    CREATE TABLE IF NOT EXISTS users (
      phone TEXT PRIMARY KEY,
      name TEXT,
      is_authorized INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Create sessions table
  await dbRun(`
    CREATE TABLE IF NOT EXISTS sessions (
      phone TEXT PRIMARY KEY,
      state TEXT DEFAULT 'START',
      temp_data TEXT DEFAULT '{}',
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(phone) REFERENCES users(phone) ON DELETE CASCADE
    )
  `);

  // Create interactions table
  await dbRun(`
    CREATE TABLE IF NOT EXISTS interactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      phone TEXT,
      direction TEXT,
      message TEXT,
      state_before TEXT,
      state_after TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(phone) REFERENCES users(phone) ON DELETE CASCADE
    )
  `);

  // Create payment rules table
  await dbRun(`
    CREATE TABLE IF NOT EXISTS payment_rules (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      start_date TEXT,
      end_date TEXT,
      is_allowed INTEGER DEFAULT 1,
      response_message TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Seed default authorized users
  for (const item of defaultAuthorized) {
    const user = await dbGet(`SELECT * FROM users WHERE phone = ?`, [item.phone]);
    if (!user) {
      await dbRun(`
        INSERT INTO users (phone, name, is_authorized)
        VALUES (?, ?, 1)
      `, [item.phone, item.name]);
    }
  }

  // Seed initial payment rules for illustration if table is empty
  const ruleCount = await dbGet(`SELECT COUNT(*) as count FROM payment_rules`);
  if (ruleCount.count === 0) {
    await dbRun(`
      INSERT INTO payment_rules (start_date, end_date, is_allowed, response_message)
      VALUES (?, ?, ?, ?)
    `, [
      "2026-07-28", 
      "2026-07-31", 
      0, 
      "⚠️ Atenção: Os pagamentos do período de 28/07/2026 a 31/07/2026 estão suspensos devido ao fechamento contábil mensal. Qualquer dúvida, entre em contato com a equipe financeira."
    ]);

    await dbRun(`
      INSERT INTO payment_rules (start_date, end_date, is_allowed, response_message)
      VALUES (?, ?, ?, ?)
    `, [
      "2026-08-05", 
      "2026-08-05", 
      1, 
      "✅ Confirmado! No dia 05/08/2026 os pagamentos programados serão efetuados normalmente no período da manhã."
    ]);
  }

  console.log("Database initialized successfully.");
}

// User-related CRUD
export async function getOrCreateUser(phone, name = '') {
  let user = await dbGet(`SELECT * FROM users WHERE phone = ?`, [phone]);
  if (!user) {
    const isAuthorized = defaultAuthorized.some(item => item.phone === phone) ? 1 : 0;
    await dbRun(`
      INSERT INTO users (phone, name, is_authorized)
      VALUES (?, ?, ?)
    `, [phone, name || `Contato (${phone.slice(-4)})`, isAuthorized]);
    user = await dbGet(`SELECT * FROM users WHERE phone = ?`, [phone]);
  } else if (name && user.name !== name) {
    await dbRun(`UPDATE users SET name = ? WHERE phone = ?`, [name, phone]);
    user.name = name;
  }
  return user;
}

export async function updateUserAuthorization(phone, isAuthorized) {
  return await dbRun(`UPDATE users SET is_authorized = ? WHERE phone = ?`, [isAuthorized ? 1 : 0, phone]);
}

// Session State management
export async function getSession(phone) {
  let session = await dbGet(`SELECT * FROM sessions WHERE phone = ?`, [phone]);
  if (!session) {
    await dbRun(`INSERT INTO sessions (phone, state, temp_data) VALUES (?, 'START', '{}')`, [phone]);
    session = await dbGet(`SELECT * FROM sessions WHERE phone = ?`, [phone]);
  }
  session.temp_data = JSON.parse(session.temp_data || '{}');
  return session;
}

export async function updateSession(phone, state, tempData) {
  const tempDataStr = JSON.stringify(tempData || {});
  return await dbRun(`
    INSERT INTO sessions (phone, state, temp_data, updated_at)
    VALUES (?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(phone) DO UPDATE SET
      state = excluded.state,
      temp_data = excluded.temp_data,
      updated_at = CURRENT_TIMESTAMP
  `, [phone, state, tempDataStr]);
}

export async function clearSession(phone) {
  return await dbRun(`UPDATE sessions SET state = 'START', temp_data = '{}', updated_at = CURRENT_TIMESTAMP WHERE phone = ?`, [phone]);
}

// Logging interactions
export async function logInteraction(phone, direction, message, stateBefore, stateAfter) {
  return await dbRun(`
    INSERT INTO interactions (phone, direction, message, state_before, state_after)
    VALUES (?, ?, ?, ?, ?)
  `, [phone, direction, message, stateBefore, stateAfter]);
}
