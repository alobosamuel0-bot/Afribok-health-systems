import Database from 'better-sqlite3'
import { mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

export type AfribokDb = Database.Database

const MIGRATIONS: Array<{ version: number; name: string; sql: string }> = [
  {
    version: 1,
    name: 'stage_1_foundation',
    sql: `
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        facility_id TEXT NOT NULL,
        name TEXT NOT NULL,
        email TEXT NOT NULL UNIQUE,
        role TEXT NOT NULL CHECK (role IN ('registration','nurse','clinician','admin','auditor')),
        password_salt TEXT NOT NULL,
        password_hash TEXT NOT NULL,
        active INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        last_sign_in_at TEXT
      );

      CREATE TABLE IF NOT EXISTS sessions (
        token_hash TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        created_at TEXT NOT NULL,
        expires_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
      CREATE INDEX IF NOT EXISTS idx_sessions_expiry ON sessions(expires_at);

      CREATE TABLE IF NOT EXISTS patients (
        id TEXT PRIMARY KEY,
        facility_id TEXT NOT NULL,
        hospital_number TEXT NOT NULL,
        first_name TEXT NOT NULL,
        last_name TEXT NOT NULL,
        other_names TEXT,
        sex TEXT NOT NULL CHECK (sex IN ('female','male','other','unknown')),
        date_of_birth TEXT,
        phone TEXT,
        address TEXT,
        identifier_type TEXT,
        identifier_value TEXT,
        version INTEGER NOT NULL DEFAULT 1,
        synthetic INTEGER NOT NULL DEFAULT 0,
        created_by TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE (facility_id, hospital_number)
      );
      CREATE INDEX IF NOT EXISTS idx_patients_name ON patients(facility_id, last_name, first_name);
      CREATE INDEX IF NOT EXISTS idx_patients_identifier ON patients(facility_id, identifier_value);

      CREATE TABLE IF NOT EXISTS encounters (
        id TEXT PRIMARY KEY,
        facility_id TEXT NOT NULL,
        patient_id TEXT NOT NULL REFERENCES patients(id),
        arrived_at TEXT NOT NULL,
        chief_complaint TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL CHECK (status IN ('waiting','in_consultation','completed')),
        version INTEGER NOT NULL DEFAULT 1,
        synthetic INTEGER NOT NULL DEFAULT 0,
        created_by TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_encounters_patient ON encounters(patient_id, arrived_at DESC);
      CREATE INDEX IF NOT EXISTS idx_encounters_worklist ON encounters(facility_id, status, arrived_at);

      CREATE TABLE IF NOT EXISTS audit_events (
        id TEXT PRIMARY KEY,
        facility_id TEXT NOT NULL,
        actor_id TEXT,
        actor_name TEXT NOT NULL,
        action TEXT NOT NULL,
        entity_type TEXT NOT NULL,
        entity_id TEXT,
        detail TEXT,
        source TEXT NOT NULL CHECK (source IN ('server','sync')),
        event_time TEXT NOT NULL,
        recorded_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_audit_facility_time ON audit_events(facility_id, recorded_at DESC);

      CREATE TABLE IF NOT EXISTS sync_operations (
        op_id TEXT PRIMARY KEY,
        facility_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        type TEXT NOT NULL,
        payload TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('applied','conflict','rejected')),
        message TEXT,
        result TEXT,
        created_at TEXT NOT NULL,
        processed_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_sync_facility_time ON sync_operations(facility_id, processed_at DESC);
    `,
  },
  {
    version: 2,
    name: 'clinical_ai_and_capacity',
    sql: `
      ALTER TABLE encounters ADD COLUMN triage_json TEXT;
      ALTER TABLE encounters ADD COLUMN triage_level INTEGER;
      ALTER TABLE encounters ADD COLUMN triage_at TEXT;
      ALTER TABLE encounters ADD COLUMN note_json TEXT;
      ALTER TABLE encounters ADD COLUMN note_at TEXT;

      CREATE TABLE IF NOT EXISTS capacity (
        facility_id TEXT PRIMARY KEY,
        consult_rooms INTEGER NOT NULL DEFAULT 2,
        beds INTEGER NOT NULL DEFAULT 6,
        clinicians INTEGER NOT NULL DEFAULT 2,
        equipment TEXT NOT NULL DEFAULT '[]',
        updated_at TEXT NOT NULL
      );

      UPDATE patients SET synthetic = 0;
      UPDATE encounters SET synthetic = 0;
    `,
  },
  {
    version: 3,
    name: 'hospital_onboarding_and_departments',
    sql: `
      CREATE TABLE IF NOT EXISTS facility_profile (
        facility_id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        facility_type TEXT NOT NULL DEFAULT '',
        location TEXT NOT NULL DEFAULT '',
        address TEXT NOT NULL DEFAULT '',
        size TEXT NOT NULL DEFAULT '',
        daily_patients INTEGER,
        operating_days TEXT NOT NULL DEFAULT '',
        operating_hours TEXT NOT NULL DEFAULT '',
        ehr_status TEXT NOT NULL DEFAULT 'none',
        ehr_name TEXT,
        ehr_vendor TEXT,
        ehr_api_access TEXT NOT NULL DEFAULT 'unknown',
        ehr_read INTEGER NOT NULL DEFAULT 0,
        ehr_write INTEGER NOT NULL DEFAULT 0,
        ehr_standard TEXT,
        ehr_docs INTEGER NOT NULL DEFAULT 0,
        ehr_contact TEXT,
        history_status TEXT NOT NULL DEFAULT 'no',
        history_formats TEXT NOT NULL DEFAULT '[]',
        history_period TEXT,
        walk_in_share TEXT NOT NULL DEFAULT 'most',
        appointments INTEGER NOT NULL DEFAULT 0,
        doctors INTEGER,
        nurses INTEGER,
        has_emergency INTEGER NOT NULL DEFAULT 1,
        has_lab INTEGER NOT NULL DEFAULT 0,
        has_pharmacy INTEGER NOT NULL DEFAULT 0,
        has_beds INTEGER NOT NULL DEFAULT 0,
        internet TEXT NOT NULL DEFAULT 'unstable',
        local_network INTEGER NOT NULL DEFAULT 1,
        local_server INTEGER NOT NULL DEFAULT 0,
        devices TEXT NOT NULL DEFAULT '[]',
        step INTEGER NOT NULL DEFAULT 1,
        completed_at TEXT,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS departments (
        id TEXT PRIMARY KEY,
        facility_id TEXT NOT NULL,
        name TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        head_user_id TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE (facility_id, name)
      );
      CREATE INDEX IF NOT EXISTS idx_departments_facility ON departments(facility_id, name);

      ALTER TABLE users ADD COLUMN department_id TEXT;
    `,
  },
  {
    version: 4,
    name: 'ehr_assistant_and_historical_operations',
    sql: `
      CREATE TABLE IF NOT EXISTS ehr_integrations (
        facility_id TEXT PRIMARY KEY,
        vendor TEXT NOT NULL DEFAULT '',
        standard TEXT NOT NULL DEFAULT 'FHIR_R4',
        endpoint_url TEXT NOT NULL DEFAULT '',
        read_enabled INTEGER NOT NULL DEFAULT 0,
        write_enabled INTEGER NOT NULL DEFAULT 0,
        auth_token_ciphertext TEXT,
        status TEXT NOT NULL DEFAULT 'not_configured' CHECK (status IN ('not_configured','configured','tested','error','paused')),
        last_test_at TEXT,
        last_error TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS ehr_events (
        id TEXT PRIMARY KEY,
        facility_id TEXT NOT NULL,
        actor_id TEXT,
        action TEXT NOT NULL,
        success INTEGER NOT NULL,
        detail TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_ehr_events_facility_time ON ehr_events(facility_id, created_at DESC);
      CREATE TABLE IF NOT EXISTS assistant_conversations (
        id TEXT PRIMARY KEY,
        facility_id TEXT NOT NULL,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        title TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_assistant_owner_time ON assistant_conversations(facility_id, user_id, updated_at DESC);
      CREATE TABLE IF NOT EXISTS assistant_messages (
        id TEXT PRIMARY KEY,
        conversation_id TEXT NOT NULL REFERENCES assistant_conversations(id) ON DELETE CASCADE,
        role TEXT NOT NULL CHECK (role IN ('user','assistant')),
        content TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_assistant_messages_conversation ON assistant_messages(conversation_id, created_at);
      CREATE TABLE IF NOT EXISTS history_imports (
        id TEXT PRIMARY KEY,
        facility_id TEXT NOT NULL,
        uploaded_by TEXT NOT NULL,
        file_name TEXT NOT NULL,
        row_count INTEGER NOT NULL,
        skipped_count INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_history_imports_facility_time ON history_imports(facility_id, created_at DESC);
      CREATE TABLE IF NOT EXISTS historical_metrics (
        id TEXT PRIMARY KEY,
        facility_id TEXT NOT NULL,
        import_id TEXT NOT NULL REFERENCES history_imports(id) ON DELETE CASCADE,
        department TEXT NOT NULL DEFAULT 'All departments',
        metric_date TEXT NOT NULL,
        arrivals INTEGER NOT NULL,
        triaged INTEGER NOT NULL DEFAULT 0,
        completed INTEGER NOT NULL DEFAULT 0,
        waiting INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        UNIQUE (facility_id, department, metric_date)
      );
      CREATE INDEX IF NOT EXISTS idx_historical_metrics_facility_date ON historical_metrics(facility_id, metric_date);
    `,
  },
  {
    version: 5,
    name: 'department_scope_staff_consent_and_ehr_links',
    sql: `
      ALTER TABLE users ADD COLUMN staff_number TEXT;
      ALTER TABLE users ADD COLUMN phone TEXT;
      CREATE UNIQUE INDEX IF NOT EXISTS idx_users_staff_number
        ON users(facility_id, staff_number) WHERE staff_number IS NOT NULL;

      ALTER TABLE patients ADD COLUMN allergies TEXT;
      ALTER TABLE patients ADD COLUMN medical_history TEXT;
      ALTER TABLE patients ADD COLUMN current_medications TEXT;

      ALTER TABLE encounters ADD COLUMN department_id TEXT;
      ALTER TABLE encounters ADD COLUMN assigned_clinician_id TEXT;
      ALTER TABLE encounters ADD COLUMN consent_recorded INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE encounters ADD COLUMN consent_at TEXT;
      ALTER TABLE encounters ADD COLUMN consult_started_at TEXT;
      ALTER TABLE encounters ADD COLUMN note_approved_at TEXT;
      ALTER TABLE encounters ADD COLUMN note_approved_by TEXT;
      CREATE INDEX IF NOT EXISTS idx_encounters_department
        ON encounters(facility_id, department_id, status, arrived_at);

      ALTER TABLE ehr_integrations ADD COLUMN approved_write_enabled INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE ehr_integrations ADD COLUMN last_sync_at TEXT;

      CREATE TABLE IF NOT EXISTS ehr_links (
        id TEXT PRIMARY KEY,
        facility_id TEXT NOT NULL,
        patient_id TEXT NOT NULL,
        encounter_id TEXT,
        resource_type TEXT NOT NULL,
        resource_id TEXT NOT NULL,
        direction TEXT NOT NULL CHECK (direction IN ('read','write')),
        status TEXT NOT NULL CHECK (status IN ('synced','failed','conflict')),
        detail TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE (facility_id, resource_type, resource_id)
      );
      CREATE INDEX IF NOT EXISTS idx_ehr_links_patient ON ehr_links(facility_id, patient_id);
    `,
  },
]

export function openDatabase(path = process.env.AFRIBOK_DB || './data/afribok.db'): AfribokDb {
  if (path === ':memory:') console.warn('[db] openDatabase with :memory - data will not persist across runs)')
  mkdirSync(dirname(resolve(path)), { recursive: true })
  const db = new Database(path)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  db.pragma('busy_timeout = 5000')
  migrate(db)
  return db
}

export function migrate(db: AfribokDb): void {
  const current = db.pragma('user_version', { simple: true }) as number
  for (const migration of MIGRATIONS) {
    if (migration.version <= current) continue
    db.transaction(() => {
      db.exec(migration.sql)
      db.pragma(`user_version = ${migration.version}`)
    })()
    console.log(`[db] applied migration ${migration.version}: ${migration.name}`)
  }
}

export function closeDatabase(db: AfribokDb): void {
  db.close()
}
