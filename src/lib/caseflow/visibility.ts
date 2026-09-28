// 사건 가시성 (웹 flow lib/caseflow/scope.ts와 같은 규칙)
//
//   팀 모드   (law_firms.caseflow_mode = 'team')     : 관리자(super_admin/firm_admin)는 조직 전체, 그 외는 담당자 본인 사건
//   개인 모드 (law_firms.caseflow_mode = 'personal') : 역할과 관계없이 본인이 등록한 사건(created_by)
//
// 1차 경계는 Supabase RLS(담당자·등록자·관리자만 내려받음)이고, 여기는 모드별로 화면을 좁히는 필터다.
// 세션을 모르면 아무것도 보여주지 않는다 (fail-closed).
import { supabase, getSessionUser } from "@/lib/supabase";
import { dbSelect, dbExecute } from "@/lib/db";

export type CaseflowMode = "team" | "personal";

export type CaseScope =
  | { kind: "all" }                       // 팀 모드 관리자: 전체
  | { kind: "assignee"; userId: string }  // 팀 모드 직원: 본인 담당만
  | { kind: "creator"; userId: string }   // 개인 모드: 본인 등록만
  | { kind: "none" };                     // 세션 없음: 아무것도 안 보임

let cached: { userId: string; scope: CaseScope } | null = null;

/**
 * 법인 모드. 받으면 local_meta에 저장해 오프라인에서도 쓴다.
 * 한 번도 못 받았으면 팀 모드(데스크톱의 원래 동작) — 어느 쪽이든 RLS가 허용한 범위 안이라 보안 경계는 아니다.
 */
async function loadMode(firmId: string | null): Promise<{ mode: CaseflowMode; fresh: boolean }> {
  if (firmId) {
    const { data, error } = await supabase
      .from("law_firms")
      .select("caseflow_mode")
      .eq("id", firmId)
      .maybeSingle();
    if (!error && data && (data.caseflow_mode === "team" || data.caseflow_mode === "personal")) {
      const mode = data.caseflow_mode as CaseflowMode;
      try {
        await dbExecute("INSERT OR REPLACE INTO local_meta (key, value) VALUES ('caseflow_mode', ?)", [mode]);
      } catch (e) {
        console.warn("[visibility] caseflow_mode 캐시 저장 실패:", e);
      }
      return { mode, fresh: true };
    }
  }
  const rows = await dbSelect<{ value: string }>("SELECT value FROM local_meta WHERE key = 'caseflow_mode'");
  return { mode: rows[0]?.value === "personal" ? "personal" : "team", fresh: false };
}

export async function getCaseScope(): Promise<CaseScope> {
  // getSession()은 로컬에 저장된 세션을 읽는다. getUser()처럼 네트워크를 타지 않아
  // 오프라인이거나 리로드마다 불려도 안전하다.
  const user = await getSessionUser();
  if (!user) return { kind: "none" };
  if (cached && cached.userId === user.id) return cached.scope;

  // 로컬 미러에서 role·firm 조회, 없으면(첫 로그인 직후 동기화 전) 원격 조회
  let role: string | null = null;
  let firmId: string | null = null;
  const rows = await dbSelect<{ role: string | null; firm_id: string | null }>(
    "SELECT role, firm_id FROM profiles WHERE id = ?",
    [user.id],
  );
  if (rows.length > 0) {
    role = rows[0].role;
    firmId = rows[0].firm_id;
  } else {
    const { data } = await supabase
      .from("profiles")
      .select("role, firm_id")
      .eq("id", user.id)
      .single();
    role = data?.role ?? null;
    firmId = data?.firm_id ?? null;
  }

  const { mode, fresh } = await loadMode(firmId);
  // role을 모르면 직원으로 취급 (좁게 보여주는 쪽이 안전)
  const isAdmin = role === "super_admin" || role === "firm_admin";
  const scope: CaseScope =
    mode === "personal" ? { kind: "creator", userId: user.id }
    : isAdmin ? { kind: "all" }
    : { kind: "assignee", userId: user.id };

  // 모드를 서버에서 못 받았으면 캐시하지 않아 다음 로드 때 다시 시도한다
  if (fresh) cached = { userId: user.id, scope };
  return scope;
}

/**
 * SQL WHERE 절에 이어 붙일 조건 조각(" AND ..." 형태)과 바인딩 파라미터.
 * @param alias cases 테이블 별칭 접두사 (예: "c.")
 */
export function scopeClause(scope: CaseScope, alias = ""): { sql: string; params: string[] } {
  switch (scope.kind) {
    case "all": return { sql: "", params: [] };
    case "assignee": return { sql: ` AND ${alias}assigned_to = ?`, params: [scope.userId] };
    case "creator": return { sql: ` AND ${alias}created_by = ?`, params: [scope.userId] };
    case "none": return { sql: " AND 0", params: [] };
  }
}

/** 이 사용자에게 보이는 사건의 미읽음 알림 수 — 알림에도 사건 가시성 규칙을 적용한다 */
export async function countVisibleUnread(userId: string): Promise<number> {
  const sc = scopeClause(await getCaseScope(), "c.");
  const r = await dbSelect<{ cnt: number }>(
    `SELECT COUNT(*) AS cnt
     FROM notifications n
     LEFT JOIN cases c ON c.id = n.case_id
     WHERE n.user_id = ? AND n.is_read = 0${sc.sql}`,
    [userId, ...sc.params],
  );
  return r[0]?.cnt ?? 0;
}
