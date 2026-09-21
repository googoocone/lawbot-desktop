// 사건 가시성 범위 (클라이언트 2차 필터)
//
// 1차는 Supabase RLS다 (flow/supabase/migrations/20260921_staff_case_visibility.sql):
//   - 관리자(super_admin / firm_admin): 조직 전체 사건을 내려받는다
//   - staff: 본인 담당(assigned_to = 본인) 사건만 내려받는다
// 여기 필터는 담당자 변경 직후 아직 동기화로 지워지지 않은 잔여 행을 가리는 안전망이고,
// 세션을 모르면 아무것도 보여주지 않는다 (fail-closed — 예전엔 이 경우 '전체'로 떨어졌다).
import { getSessionUser } from "@/lib/supabase";
import { dbSelect } from "@/lib/db";

export type CaseScope =
  | { kind: "all" }                   // 관리자: 전체
  | { kind: "user"; userId: string }  // staff: 본인 담당만
  | { kind: "none" };                 // 세션 없음: 아무것도 안 보임

let cached: { userId: string; scope: CaseScope } | null = null;

export async function getCaseScope(): Promise<CaseScope> {
  // getSession()은 로컬에 저장된 세션을 읽는다. getUser()처럼 네트워크를 타지 않아
  // 오프라인이거나 리로드마다 불려도 안전하다.
  const user = await getSessionUser();
  if (!user) return { kind: "none" };
  if (cached && cached.userId === user.id) return cached.scope;

  // 로컬 미러에서 role 조회, 없으면(첫 로그인 직후 동기화 전) 원격 조회
  let role: string | null = null;
  const rows = await dbSelect<{ role: string | null }>(
    "SELECT role FROM profiles WHERE id = ?",
    [user.id],
  );
  if (rows.length > 0) {
    role = rows[0].role;
  } else {
    const { supabase } = await import("@/lib/supabase");
    const { data } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .single();
    role = data?.role ?? null;
  }

  // role을 모르면 staff로 취급 (좁게 보여주는 쪽이 안전)
  const isAdmin = role === "super_admin" || role === "firm_admin";
  const scope: CaseScope = isAdmin ? { kind: "all" } : { kind: "user", userId: user.id };
  cached = { userId: user.id, scope };
  return scope;
}

/** SQL WHERE 절에 이어 붙일 조건 조각 (" AND ..." 형태)과 바인딩 파라미터 */
export function scopeClause(scope: CaseScope, column: string): { sql: string; params: string[] } {
  if (scope.kind === "all") return { sql: "", params: [] };
  if (scope.kind === "user") return { sql: ` AND ${column} = ?`, params: [scope.userId] };
  return { sql: " AND 0", params: [] }; // none: 항상 거짓
}
