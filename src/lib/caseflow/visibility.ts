// 사건 가시성 범위
// - 관리자(super_admin / firm_admin): 조직 전체 사건
// - staff: 본인 담당(assigned_to = 본인) 사건만
import { supabase } from "@/lib/supabase";
import { dbSelect } from "@/lib/db";

let cached: { userId: string; scope: string | null } | null = null;

/**
 * 현재 계정의 사건 조회 범위를 반환한다.
 * @returns null = 전체(관리자), user_id = 그 직원의 담당 사건만
 */
export async function getCaseScope(): Promise<string | null> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
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
    const { data } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .single();
    role = data?.role ?? null;
  }

  // role을 모르면 staff로 취급 (좁게 보여주는 쪽이 안전)
  const isAdmin = role === "super_admin" || role === "firm_admin";
  const scope = isAdmin ? null : user.id;
  cached = { userId: user.id, scope };
  return scope;
}
