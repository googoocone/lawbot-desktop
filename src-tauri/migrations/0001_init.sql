-- ============================================================
-- caseflow desktop — initial SQLite schema (mirrors Supabase cf_* tables)
--
-- Conventions:
--   - UUIDs stored as TEXT (Supabase uuid → string)
--   - Timestamps stored as TEXT in ISO 8601 (e.g. "2026-05-21T10:30:00.000Z")
--   - Dates stored as TEXT in YYYY-MM-DD
--   - Booleans stored as INTEGER (0 / 1)
--   - JSONB stored as TEXT (serialized JSON)
--   - NUMERIC stored as REAL
--   - FK constraints kept light — sync layer enforces referential integrity
-- ============================================================

-- ============================================================
-- cases (mirrors cf_cases)
-- ============================================================
CREATE TABLE IF NOT EXISTS cases (
  id                        TEXT PRIMARY KEY,
  firm_id                   TEXT NOT NULL,

  case_number               TEXT,
  case_type                 TEXT,
  seq_number                INTEGER,

  applicant_name            TEXT NOT NULL,
  applicant_spouse          TEXT,
  applicant_ssn_enc         TEXT,
  applicant_phone_enc       TEXT,

  court_region              TEXT,
  court_name                TEXT,
  counselor_name            TEXT,
  assigned_to               TEXT,
  staff_name                TEXT,
  income_type               TEXT,
  fee                       REAL,

  doc_received_at           TEXT,
  distribution_date         TEXT,
  judge_info                TEXT,
  judge_phone               TEXT,
  creditor_meeting          TEXT,

  -- 단계별 자동 추출 날짜 (Supabase 트리거가 progress_data에서 추출)
  filed_date                TEXT,
  commencement_date         TEXT,
  approval_date             TEXT,
  declared_date             TEXT,
  dismissed_date            TEXT,
  withdrawn_date            TEXT,
  discharged_date           TEXT,

  status                    TEXT DEFAULT 'pending',
  case_progress             TEXT DEFAULT 'active',

  active_corrections_count  INTEGER DEFAULT 0,
  overdue_corrections_count INTEGER DEFAULT 0,

  handler_checked           INTEGER DEFAULT 0,
  handler_checked_at        TEXT,
  handler_status            TEXT,

  notes                     TEXT,
  progress_data             TEXT DEFAULT '[]',
  progress_count            INTEGER DEFAULT 0,
  unseen_changes            INTEGER DEFAULT 0,

  last_crawled_at           TEXT,
  created_at                TEXT NOT NULL,
  updated_at                TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_cases_firm        ON cases(firm_id);
CREATE INDEX IF NOT EXISTS idx_cases_assigned    ON cases(assigned_to);
CREATE INDEX IF NOT EXISTS idx_cases_status      ON cases(status);
CREATE INDEX IF NOT EXISTS idx_cases_case_number ON cases(case_number);
CREATE INDEX IF NOT EXISTS idx_cases_seq         ON cases(seq_number);
CREATE INDEX IF NOT EXISTS idx_cases_court       ON cases(court_region);
CREATE INDEX IF NOT EXISTS idx_cases_updated     ON cases(updated_at);

-- ============================================================
-- case_corrections (mirrors cf_case_corrections)
-- ============================================================
CREATE TABLE IF NOT EXISTS case_corrections (
  id                TEXT PRIMARY KEY,
  case_id           TEXT NOT NULL,
  firm_id           TEXT NOT NULL,

  document_type     TEXT NOT NULL,
  document_category TEXT NOT NULL,

  served_date       TEXT,
  received_date     TEXT,
  auto_confirmed    INTEGER DEFAULT 0,

  deadline_days     INTEGER,
  deadline_7d       TEXT,
  deadline_14d      TEXT,
  deadline_date     TEXT,

  status            TEXT DEFAULT 'pending',
  overdue_days      INTEGER DEFAULT 0,

  submitted_date    TEXT,
  manual_submit     INTEGER DEFAULT 0,

  arrival_raw       TEXT,
  notes_1           TEXT,
  notes_2           TEXT,

  created_at        TEXT NOT NULL,
  updated_at        TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_corrections_case     ON case_corrections(case_id);
CREATE INDEX IF NOT EXISTS idx_corrections_firm     ON case_corrections(firm_id);
CREATE INDEX IF NOT EXISTS idx_corrections_status   ON case_corrections(status);
CREATE INDEX IF NOT EXISTS idx_corrections_deadline ON case_corrections(deadline_date)
  WHERE status IN ('pending', 'approaching', 'overdue');
CREATE INDEX IF NOT EXISTS idx_corrections_updated  ON case_corrections(updated_at);

-- ============================================================
-- correction_extensions (mirrors cf_correction_extensions)
-- ============================================================
CREATE TABLE IF NOT EXISTS correction_extensions (
  id                TEXT PRIMARY KEY,
  correction_id     TEXT NOT NULL,

  extension_number  INTEGER NOT NULL,
  extension_date    TEXT,
  extension_days    INTEGER,
  new_deadline      TEXT,
  overdue_after_ext INTEGER DEFAULT 0,

  created_at        TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_extensions_correction ON correction_extensions(correction_id);

-- ============================================================
-- profiles (minimal mirror — only what UI needs)
-- ============================================================
CREATE TABLE IF NOT EXISTS profiles (
  id         TEXT PRIMARY KEY,
  firm_id    TEXT,
  email      TEXT,
  name       TEXT,
  role       TEXT,
  created_at TEXT,
  updated_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_profiles_firm ON profiles(firm_id);

-- ============================================================
-- sync_state — tracks last sync time per table
-- ============================================================
CREATE TABLE IF NOT EXISTS sync_state (
  table_name      TEXT PRIMARY KEY,
  last_synced_at  TEXT,
  last_full_sync  TEXT
);

INSERT OR IGNORE INTO sync_state (table_name, last_synced_at) VALUES
  ('cases', NULL),
  ('case_corrections', NULL),
  ('correction_extensions', NULL),
  ('profiles', NULL);
