-- cf_cases.created_by 미러 (Supabase 20260928_2_caseflow_personal_cases: 등록자)
-- 개인 모드 법인은 등록자 기준으로 사건을 보여준다 (src/lib/caseflow/visibility.ts).
-- 기존 로컬 행의 값은 다음 풀 싱크(sync.ts MIRROR_VERSION 3)에서 채워진다.
ALTER TABLE cases ADD COLUMN created_by TEXT;

CREATE INDEX IF NOT EXISTS idx_cases_created_by ON cases(created_by);
