-- cf_cases.is_active 미러 (Supabase 20260717_3_add_case_registry: 소프트 삭제·중복 정리용)
-- 웹앱/서버가 is_active=false로 비활성화한 사건(중복 정리 등)을 데스크탑 목록에서도 숨긴다.
-- 기존 로컬 행은 다음 증분 동기화 전까지 1(활성)로 보이지만, 서버에서 비활성화된 행은
-- updated_at이 갱신돼 있어 곧 따라잡힌다.
ALTER TABLE cases ADD COLUMN is_active INTEGER NOT NULL DEFAULT 1;

CREATE INDEX IF NOT EXISTS idx_cases_active ON cases(is_active);
