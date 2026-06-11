-- ============================================================
-- notifications 테이블 추가 (mirrors cf_notifications)
-- ============================================================
CREATE TABLE IF NOT EXISTS notifications (
  id            TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL,
  case_id       TEXT,
  correction_id TEXT,
  firm_id       TEXT NOT NULL,

  type          TEXT NOT NULL,
  priority      TEXT DEFAULT 'normal',
  title         TEXT NOT NULL,
  message       TEXT NOT NULL,

  is_read       INTEGER DEFAULT 0,
  read_at       TEXT,
  created_at    TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_notif_user_unread ON notifications(user_id, is_read);
CREATE INDEX IF NOT EXISTS idx_notif_created    ON notifications(created_at DESC);

INSERT OR IGNORE INTO sync_state (table_name, last_synced_at) VALUES ('notifications', NULL);
