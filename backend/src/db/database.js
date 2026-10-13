const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');

const dataDir = path.join(__dirname, '../../data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const dbPath = path.join(dataDir, 'hostel_attendance.sqlite');
const db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    console.error('Failed to open SQLite database:', err.message);
  } else {
    console.log(`Connected to Production SQLite Database at: ${dbPath}`);
  }
});

// Configure High-Performance & Concurrency PRAGMAs
db.serialize(() => {
  db.run('PRAGMA journal_mode = WAL;');
  db.run('PRAGMA foreign_keys = ON;');
  db.run('PRAGMA busy_timeout = 5000;');
  db.run('PRAGMA synchronous = NORMAL;');
});

// Helpers for promise-based queries
const runQuery = (sql, params = []) => {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) reject(err);
      else resolve({ id: this.lastID, changes: this.changes });
    });
  });
};

const getQuery = (sql, params = []) => {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) reject(err);
      else resolve(row);
    });
  });
};

const allQuery = (sql, params = []) => {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
};

// Transaction wrapper for atomic multi-statement operations
const withTransaction = async (callback) => {
  await runQuery('BEGIN TRANSACTION;');
  try {
    const result = await callback({ runQuery, getQuery, allQuery });
    await runQuery('COMMIT;');
    return result;
  } catch (error) {
    await runQuery('ROLLBACK;');
    throw error;
  }
};

// Initialize Enterprise Schemas
const initDatabase = async () => {
  // 1. Users Table (Authentication & RBAC)
  await runQuery(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      email TEXT UNIQUE,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('ADMIN', 'WARDEN', 'STUDENT')),
      student_id TEXT,
      is_active INTEGER DEFAULT 1,
      must_change_password INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // 2. Hostel Blocks & Rooms
  await runQuery(`
    CREATE TABLE IF NOT EXISTS hostel_blocks (
      id TEXT PRIMARY KEY,
      block_name TEXT UNIQUE NOT NULL,
      total_rooms INTEGER DEFAULT 0,
      warden_name TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await runQuery(`
    CREATE TABLE IF NOT EXISTS rooms (
      id TEXT PRIMARY KEY,
      block_id TEXT NOT NULL,
      room_number TEXT NOT NULL,
      capacity INTEGER DEFAULT 2,
      occupied INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (block_id) REFERENCES hostel_blocks(id) ON DELETE CASCADE,
      UNIQUE(block_id, room_number)
    )
  `);

  // 3. Pre-Allotment Roster
  await runQuery(`
    CREATE TABLE IF NOT EXISTS hostel_allotments (
      id TEXT PRIMARY KEY,
      roll_number TEXT UNIQUE NOT NULL,
      full_name TEXT NOT NULL,
      room_number TEXT NOT NULL,
      hostel_block TEXT NOT NULL,
      is_registered INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // 4. Students
  await runQuery(`
    CREATE TABLE IF NOT EXISTS students (
      id TEXT PRIMARY KEY,
      user_id TEXT,
      allotment_id TEXT,
      roll_number TEXT UNIQUE NOT NULL,
      full_name TEXT NOT NULL,
      email TEXT,
      phone TEXT,
      course TEXT NOT NULL,
      admission_year INTEGER NOT NULL,
      semester INTEGER NOT NULL,
      room_number TEXT,
      hostel_block TEXT,
      device_id TEXT NOT NULL,
      device_model TEXT,
      is_active INTEGER DEFAULT 1,
      failed_attempts INTEGER DEFAULT 0,
      is_flagged_forge INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL,
      FOREIGN KEY (allotment_id) REFERENCES hostel_allotments(id)
    )
  `);

  // 5. Biometric Face Vectors (128-D)
  await runQuery(`
    CREATE TABLE IF NOT EXISTS student_face_embeddings (
      id TEXT PRIMARY KEY,
      student_id TEXT NOT NULL,
      angle_label TEXT NOT NULL,
      embedding_vector TEXT NOT NULL,
      quality_score REAL DEFAULT 1.0,
      liveness_score REAL DEFAULT 1.0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE CASCADE
    )
  `);

  // 6. Geofence Configuration
  await runQuery(`
    CREATE TABLE IF NOT EXISTS geofence_configs (
      id TEXT PRIMARY KEY,
      hostel_name TEXT NOT NULL,
      latitude REAL NOT NULL,
      longitude REAL NOT NULL,
      radius_meters REAL DEFAULT 20.0,
      is_active INTEGER DEFAULT 1,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_by TEXT
    )
  `);

  // 7. Persistent Single-Use Attendance Challenge Tokens (Replay Protection)
  await runQuery(`
    CREATE TABLE IF NOT EXISTS attendance_challenges (
      id TEXT PRIMARY KEY,
      student_id TEXT NOT NULL,
      challenge_token TEXT UNIQUE NOT NULL,
      expires_at DATETIME NOT NULL,
      is_used INTEGER DEFAULT 0,
      verified_distance REAL NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE CASCADE
    )
  `);

  // 8. Daily Attendance Records
  await runQuery(`
    CREATE TABLE IF NOT EXISTS attendance_records (
      id TEXT PRIMARY KEY,
      student_id TEXT NOT NULL,
      roll_number TEXT NOT NULL,
      full_name TEXT NOT NULL,
      date TEXT NOT NULL,
      time_marked TEXT NOT NULL,
      status TEXT DEFAULT 'PRESENT' CHECK(status IN ('PRESENT', 'ABSENT', 'LATE', 'EXCUSED')),
      verified_distance REAL,
      similarity_score REAL,
      liveness_score REAL,
      is_override INTEGER DEFAULT 0,
      override_reason TEXT,
      override_by TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (student_id) REFERENCES students(id),
      UNIQUE(student_id, date)
    )
  `);

  // 9. Attendance Correction Requests (Student submission & Warden/Admin review)
  await runQuery(`
    CREATE TABLE IF NOT EXISTS attendance_corrections (
      id TEXT PRIMARY KEY,
      attendance_id TEXT,
      student_id TEXT NOT NULL,
      roll_number TEXT NOT NULL,
      date TEXT NOT NULL,
      original_status TEXT NOT NULL,
      requested_status TEXT NOT NULL,
      reason TEXT NOT NULL,
      status TEXT DEFAULT 'PENDING' CHECK(status IN ('PENDING', 'APPROVED', 'REJECTED')),
      reviewed_by TEXT,
      reviewed_at DATETIME,
      resolution_note TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (student_id) REFERENCES students(id),
      FOREIGN KEY (attendance_id) REFERENCES attendance_records(id)
    )
  `);

  // 10. Security Audit Logs (Forge attempts, GPS spoofer flags, biometric mismatches)
  await runQuery(`
    CREATE TABLE IF NOT EXISTS security_audit_logs (
      id TEXT PRIMARY KEY,
      user_id TEXT,
      student_id TEXT,
      roll_number TEXT,
      incident_type TEXT NOT NULL,
      calculated_distance REAL,
      details TEXT,
      ip_address TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // 11. Admin & Staff Action Audit Trail (Non-destructive accountability)
  await runQuery(`
    CREATE TABLE IF NOT EXISTS admin_audit_events (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      username TEXT NOT NULL,
      action TEXT NOT NULL,
      target_type TEXT NOT NULL,
      target_id TEXT,
      details TEXT,
      ip_address TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // 12. Student Support & Feedback Tickets
  await runQuery(`
    CREATE TABLE IF NOT EXISTS feedback_tickets (
      id TEXT PRIMARY KEY,
      student_id TEXT NOT NULL,
      roll_number TEXT NOT NULL,
      category TEXT NOT NULL CHECK(category IN ('ATTENDANCE', 'HARDWARE', 'GEOFENCE', 'GENERAL', 'ROOM')),
      subject TEXT NOT NULL,
      message TEXT NOT NULL,
      status TEXT DEFAULT 'OPEN' CHECK(status IN ('OPEN', 'IN_PROGRESS', 'RESOLVED')),
      resolution_note TEXT,
      resolved_by TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      resolved_at DATETIME,
      FOREIGN KEY (student_id) REFERENCES students(id)
    )
  `);

  // Automatic Non-Destructive Column Migrations (upgrades existing SQLite db schema)
  const ensureColumns = async (tableName, requiredCols) => {
    try {
      const existing = await allQuery(`PRAGMA table_info(${tableName});`);
      const existingNames = existing.map((c) => c.name);
      for (const [colName, colDef] of Object.entries(requiredCols)) {
        if (!existingNames.includes(colName)) {
          await runQuery(`ALTER TABLE ${tableName} ADD COLUMN ${colName} ${colDef};`);
          console.log(`[Migration] Added missing column ${colName} to ${tableName}`);
        }
      }
    } catch (migErr) {
      console.warn(`[Migration Notice] ${tableName}:`, migErr.message);
    }
  };

  await ensureColumns('students', {
    user_id: 'TEXT',
    allotment_id: 'TEXT',
    email: 'TEXT',
    phone: 'TEXT',
    course: 'TEXT',
    admission_year: 'INTEGER',
    semester: 'INTEGER',
    room_number: 'TEXT',
    hostel_block: 'TEXT',
    device_id: 'TEXT',
    device_model: 'TEXT',
    is_active: 'INTEGER DEFAULT 1',
    failed_attempts: 'INTEGER DEFAULT 0',
    is_flagged_forge: 'INTEGER DEFAULT 0'
  });

  await ensureColumns('users', {
    student_id: 'TEXT',
    must_change_password: 'INTEGER DEFAULT 0'
  });

  await ensureColumns('attendance_records', {
    is_override: 'INTEGER DEFAULT 0',
    override_reason: 'TEXT',
    override_by: 'TEXT',
    distance_meters: 'REAL',
    accuracy: 'REAL',
    verification_method: 'TEXT'
  });

  await ensureColumns('hostel_allotments', {
    is_registered: 'INTEGER DEFAULT 0'
  });

  // 13. Performance Indexes
  await runQuery(`CREATE INDEX IF NOT EXISTS idx_attendance_date ON attendance_records(date);`);
  await runQuery(`CREATE INDEX IF NOT EXISTS idx_attendance_student ON attendance_records(student_id);`);
  await runQuery(`CREATE INDEX IF NOT EXISTS idx_students_roll ON students(roll_number);`);
  await runQuery(`CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);`);
  await runQuery(`CREATE INDEX IF NOT EXISTS idx_challenges_token ON attendance_challenges(challenge_token);`);
  await runQuery(`CREATE INDEX IF NOT EXISTS idx_audit_created ON admin_audit_events(created_at);`);
  await runQuery(`CREATE INDEX IF NOT EXISTS idx_security_created ON security_audit_logs(created_at);`);
  await runQuery(`CREATE INDEX IF NOT EXISTS idx_corrections_status ON attendance_corrections(status);`);

  // 14. Initial Data Seeding
  await seedInitialData();
};

const seedInitialData = async () => {
  // A. Seed Default Admin User if missing
  const existingAdmin = await getQuery(`SELECT id FROM users WHERE username = ?`, ['admin']);
  if (!existingAdmin) {
    const salt = await bcrypt.genSalt(10);
    const hash = await bcrypt.hash('Admin@12345', salt);
    await runQuery(`
      INSERT INTO users (id, username, email, password_hash, role, is_active, must_change_password)
      VALUES (?, ?, ?, ?, 'ADMIN', 1, 0)
    `, [uuidv4(), 'admin', 'admin@hostelguard.local', hash]);
    console.log('✅ Default Administrator seeded (Username: admin | Pass: Admin@12345)');
  }

  // B. Seed Default Warden User if missing
  const existingWarden = await getQuery(`SELECT id FROM users WHERE username = ?`, ['warden']);
  if (!existingWarden) {
    const salt = await bcrypt.genSalt(10);
    const hash = await bcrypt.hash('Warden@12345', salt);
    await runQuery(`
      INSERT INTO users (id, username, email, password_hash, role, is_active, must_change_password)
      VALUES (?, ?, ?, ?, 'WARDEN', 1, 0)
    `, [uuidv4(), 'warden', 'warden@hostelguard.local', hash]);
    console.log('✅ Default Warden seeded (Username: warden | Pass: Warden@12345)');
  }

  // C. Seed Hostel Blocks & Sample Rooms
  const existingBlocks = await getQuery(`SELECT COUNT(*) as count FROM hostel_blocks`);
  if (existingBlocks.count === 0) {
    const blockAId = uuidv4();
    const blockBId = uuidv4();
    await runQuery(`INSERT INTO hostel_blocks (id, block_name, total_rooms, warden_name) VALUES (?, 'Block A', 20, 'Dr. Rajesh Verma')`, [blockAId]);
    await runQuery(`INSERT INTO hostel_blocks (id, block_name, total_rooms, warden_name) VALUES (?, 'Block B', 20, 'Prof. Sunita Rao')`, [blockBId]);

    const roomsA = ['A-101', 'A-102', 'A-103', 'A-104', 'A-201', 'A-202'];
    for (const r of roomsA) {
      await runQuery(`INSERT INTO rooms (id, block_id, room_number, capacity, occupied) VALUES (?, ?, ?, 2, 1)`, [uuidv4(), blockAId, r]);
    }
    const roomsB = ['B-101', 'B-102', 'B-103', 'B-201', 'B-202'];
    for (const r of roomsB) {
      await runQuery(`INSERT INTO rooms (id, block_id, room_number, capacity, occupied) VALUES (?, ?, ?, 2, 1)`, [uuidv4(), blockBId, r]);
    }
  }

  // D. Seed Default Geofence if missing
  const existingGeo = await getQuery(`SELECT id FROM geofence_configs WHERE is_active = 1 LIMIT 1`);
  if (!existingGeo) {
    await runQuery(`
      INSERT INTO geofence_configs (id, hostel_name, latitude, longitude, radius_meters, is_active, updated_by)
      VALUES (?, 'Hostel Main Campus Facility', 28.545000, 77.192600, 20.0, 1, 'System Bootstrap')
    `, [uuidv4()]);
  }

  // E. Seed Initial Roster Allotments
  const allotCount = await getQuery(`SELECT COUNT(*) as count FROM hostel_allotments`);
  if (allotCount.count === 0) {
    const demoRoster = [
      ['2023CS01', 'Aarav Sharma', 'A-101', 'Block A'],
      ['2023CS02', 'Ananya Patel', 'A-102', 'Block A'],
      ['2023EC01', 'Rohan Verma', 'A-103', 'Block A'],
      ['2023ME05', 'Diya Sen', 'B-201', 'Block B'],
      ['2023IT12', 'Kabir Mehta', 'B-202', 'Block B']
    ];
    for (const item of demoRoster) {
      await runQuery(`
        INSERT INTO hostel_allotments (id, roll_number, full_name, room_number, hostel_block, is_registered)
        VALUES (?, ?, ?, ?, ?, 0)
      `, [uuidv4(), item[0], item[1], item[2], item[3]]);
    }
  }
};

module.exports = {
  db,
  runQuery,
  getQuery,
  allQuery,
  withTransaction,
  initDatabase
};
