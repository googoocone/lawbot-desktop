-- 로컬 전용 메타 (Supabase 미러 아님)
-- owner_user_id: 이 로컬 DB를 채운 계정. 다른 계정 로그인 시 미러 초기화 판단용.
CREATE TABLE IF NOT EXISTS local_meta (
  key TEXT PRIMARY KEY,
  value TEXT
);
