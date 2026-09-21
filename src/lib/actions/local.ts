// Supabase(source of truth)에 먼저 mutate → 성공시 로컬 SQLite에도 동일하게 반영.
// 실패하면 SQLite는 안 건드림 (다음 sync 때 일관성 회복).
import { supabase, getSessionUser } from "@/lib/supabase";
import { dbExecute, dbSelect } from "@/lib/db";
import { daysUntil, addDays, todayStr } from "@/lib/caseflow/utils/date";
import { COURT_MAPPING } from "@/lib/caseflow/constants/court-mapping";
import type { CaseType } from "@/lib/caseflow/types";

// ─────────────────────────────────────────────
// 현재 사용자 프로필 (firm_id, role 등)
// ─────────────────────────────────────────────

export interface CurrentProfile {
  id: string;
  firm_id: string | null;
  role: string | null;
  name: string | null;
}

export async function getCurrentProfile(): Promise<CurrentProfile> {
  const user = await getSessionUser();
  if (!user) throw new Error("인증이 필요합니다.");
  const { data: profile, error } = await supabase
    .from("profiles")
    .select("id, firm_id, role, name")
    .eq("id", user.id)
    .single();
  if (error || !profile) throw new Error("프로필을 찾을 수 없습니다.");
  return profile as CurrentProfile;
}

// ─────────────────────────────────────────────
// firm 멤버 목록 (관리자 전용 — staff는 빈 배열)
// ─────────────────────────────────────────────

export async function getFirmMembers(): Promise<{
  data: { id: string; name: string | null; role: string | null }[];
  canDistribute: boolean;
}> {
  const profile = await getCurrentProfile();
  const isAdmin = profile.role === "super_admin" || profile.role === "firm_admin";
  if (!isAdmin) return { data: [], canDistribute: false };
  if (!profile.firm_id) return { data: [], canDistribute: true };

  const { data, error } = await supabase
    .from("profiles")
    .select("id, name, role")
    .eq("firm_id", profile.firm_id)
    .not("name", "is", null);
  if (error) return { data: [], canDistribute: true };
  return { data: data || [], canDistribute: true };
}

// ─────────────────────────────────────────────
// 중복 등록 감지
//
// 서버 unique index(firm_id, court_key, case_number_key)는 사건번호가 있는 건만 막는다.
// 실무에선 사건번호 없이 이름만으로 먼저 등록하는 경우가 많아(팀장이 등록 → 팀원이 또 등록),
// 이름·주민번호·연락처 기준으로도 등록 전에 미리 확인한다.
// ─────────────────────────────────────────────

/** Supabase cf_normalize_case_registry_key와 동일: 공백·하이픈 제거 + 소문자 */
export function normalizeRegistryKey(value: string | null | undefined): string | null {
  const v = (value ?? "").trim().replace(/[\s-]+/g, "").toLowerCase();
  return v || null;
}

export interface DuplicateCheckInput {
  applicant_name: string;
  case_number?: string | null;
  court_region?: string | null;
  applicant_ssn?: string | null;
  applicant_phone?: string | null;
}

export interface DuplicateMatch {
  /** exact: 같은 사건번호 / 같은 이름+주민번호 / 같은 이름+연락처 → 등록 차단. name: 이름만 같음 → 경고 */
  kind: "exact" | "name";
  reason: string;
  existing?: { id: string; applicant_name: string; case_number: string | null; manager_name: string | null };
}

const digitsOnly = (v: string | null | undefined) => (v ?? "").replace(/\D/g, "");

/** 입력 index → 중복 정보. 서버의 활성 사건뿐 아니라 같은 입력 목록(엑셀 파일) 안의 중복도 잡는다. */
export async function findDuplicateCases(inputs: DuplicateCheckInput[]): Promise<Map<number, DuplicateMatch>> {
  const result = new Map<number, DuplicateMatch>();
  if (inputs.length === 0) return result;

  // 1) 서버 RPC (SECURITY DEFINER) — staff는 RLS로 다른 담당자 사건을 못 보므로 firm 전체 검사는 서버가 한다.
  //    주민번호·연락처는 서버가 비교만 하고 값은 돌려주지 않는다.
  type RpcRow = { input_index: number; kind: string; existing_id: string; applicant_name: string; case_number: string | null; manager_name: string | null };
  const { data: rpcRows, error: rpcErr } = await supabase.rpc("cf_find_duplicate_cases", {
    p_inputs: inputs.map((i) => ({
      applicant_name: i.applicant_name, case_number: i.case_number ?? null, court_region: i.court_region ?? null,
      applicant_ssn: i.applicant_ssn ?? null, applicant_phone: i.applicant_phone ?? null,
    })),
  });
  if (rpcErr && !isMissingRpc(rpcErr)) throw new Error(`중복 확인 실패: ${rpcErr.message}`);
  if (!rpcErr) {
    for (const r of (rpcRows ?? []) as RpcRow[]) {
      const who = r.manager_name ? `담당 ${r.manager_name}` : "담당자 미상";
      const existing = { id: r.existing_id, applicant_name: r.applicant_name, case_number: r.case_number, manager_name: r.manager_name };
      const match: DuplicateMatch =
        r.kind === "exact_number" ? { kind: "exact", reason: `같은 사건번호가 이미 등록됨 (${r.applicant_name}, ${who})`, existing }
        : r.kind === "exact_ssn" ? { kind: "exact", reason: `같은 이름·주민번호가 이미 등록됨 (${who})`, existing }
        : r.kind === "exact_phone" ? { kind: "exact", reason: `같은 이름·연락처가 이미 등록됨 (${who})`, existing }
        : { kind: "name", reason: `같은 이름의 의뢰인이 이미 등록됨 (${who}${r.case_number ? `, ${r.case_number}` : ""})`, existing };
      result.set(r.input_index, match);
    }
    markInFileDuplicates(inputs, result);
    return result;
  }

  // 2) 폴백 — RPC 미배포 시 직접 조회 (RLS가 firm 전체를 보여줄 때만 완전함)
  console.warn("[dup] cf_find_duplicate_cases RPC 없음 — 직접 조회로 폴백");

  const names = [...new Set(inputs.map((i) => i.applicant_name.trim()).filter(Boolean))];
  const keys = [...new Set(inputs.map((i) => normalizeRegistryKey(i.case_number)).filter((k): k is string => !!k))];

  type Existing = {
    id: string; applicant_name: string; case_number: string | null;
    case_number_key: string | null; court_key: string | null;
    applicant_ssn_enc: string | null; applicant_phone_enc: string | null;
    staff_name: string | null; assigned_to: string | null;
  };
  const SEL = "id, applicant_name, case_number, case_number_key, court_key, applicant_ssn_enc, applicant_phone_enc, staff_name, assigned_to";
  const CHUNK = 100;
  const byId = new Map<string, Existing>();
  for (let i = 0; i < names.length; i += CHUNK) {
    const { data, error } = await supabase.from("cf_cases").select(SEL)
      .eq("is_active", true).in("applicant_name", names.slice(i, i + CHUNK));
    if (error) throw new Error(`중복 확인 실패: ${error.message}`);
    for (const e of (data ?? []) as Existing[]) byId.set(e.id, e);
  }
  for (let i = 0; i < keys.length; i += CHUNK) {
    const { data, error } = await supabase.from("cf_cases").select(SEL)
      .eq("is_active", true).in("case_number_key", keys.slice(i, i + CHUNK));
    if (error) throw new Error(`중복 확인 실패: ${error.message}`);
    for (const e of (data ?? []) as Existing[]) byId.set(e.id, e);
  }

  // 담당자 이름은 로컬 프로필 미러에서
  const profiles = await dbSelect<{ id: string; name: string | null }>("SELECT id, name FROM profiles");
  const nameById = new Map(profiles.map((p) => [p.id, p.name]));
  const managerOf = (e: Existing) => (e.assigned_to ? nameById.get(e.assigned_to) : null) || e.staff_name || null;
  const who = (e: Existing) => (managerOf(e) ? `담당 ${managerOf(e)}` : "담당자 미상");
  const describe = (e: Existing) => ({
    id: e.id, applicant_name: e.applicant_name, case_number: e.case_number, manager_name: managerOf(e),
  });

  inputs.forEach((input, idx) => {
    const name = input.applicant_name.trim();
    const key = normalizeRegistryKey(input.case_number);
    const courtKey = normalizeRegistryKey(input.court_region);
    const ssn = digitsOnly(input.applicant_ssn);
    const phone = digitsOnly(input.applicant_phone);

    let match: DuplicateMatch | null = null;
    for (const e of byId.values()) {
      const sameName = !!name && e.applicant_name.trim() === name;
      const sameNumber = !!key && e.case_number_key === key
        && (!courtKey || !e.court_key || e.court_key === courtKey);
      const sameSsn = sameName && ssn.length >= 13 && digitsOnly(e.applicant_ssn_enc) === ssn;
      const samePhone = sameName && phone.length >= 10 && digitsOnly(e.applicant_phone_enc) === phone;
      if (sameNumber) { match = { kind: "exact", reason: `같은 사건번호가 이미 등록됨 (${e.applicant_name}, ${who(e)})`, existing: describe(e) }; break; }
      if (sameSsn) { match = { kind: "exact", reason: `같은 이름·주민번호가 이미 등록됨 (${who(e)})`, existing: describe(e) }; break; }
      if (samePhone) { match = { kind: "exact", reason: `같은 이름·연락처가 이미 등록됨 (${who(e)})`, existing: describe(e) }; break; }
      if (sameName && !match) {
        match = { kind: "name", reason: `같은 이름의 의뢰인이 이미 등록됨 (${who(e)}${e.case_number ? `, ${e.case_number}` : ""})`, existing: describe(e) };
      }
    }
    if (match) result.set(idx, match);
  });
  markInFileDuplicates(inputs, result);
  return result;
}

/** 같은 입력 목록(엑셀 파일) 안에서 겹치는 행 표시 — 서버 검사에서 안 걸린 행만 */
function markInFileDuplicates(inputs: DuplicateCheckInput[], result: Map<number, DuplicateMatch>) {
  const seenKeys = new Map<string, number>();
  const seenNames = new Map<string, number>();
  inputs.forEach((input, idx) => {
    const name = input.applicant_name.trim();
    const key = normalizeRegistryKey(input.case_number);
    if (!result.has(idx)) {
      if (key && seenKeys.has(key)) result.set(idx, { kind: "exact", reason: `이 파일의 ${seenKeys.get(key)! + 1}번 행과 사건번호가 같음` });
      else if (name && seenNames.has(name)) result.set(idx, { kind: "name", reason: `이 파일의 ${seenNames.get(name)! + 1}번 행과 이름이 같음` });
    }
    if (key && !seenKeys.has(key)) seenKeys.set(key, idx);
    if (name && !seenNames.has(name)) seenNames.set(name, idx);
  });
}

/** Postgres unique 위반(23505)은 서버 registry 인덱스에 걸린 것 — 사용자에게 읽히는 문구로 바꾼다 */
function friendlyInsertError(error: { code?: string; message: string }): string {
  if (error.code === "23505") {
    // 어느 유니크 인덱스에 걸렸는지로 문구 결정 (flow/supabase/migrations 20260717_3, 20260921_2)
    if (error.message.includes("uq_cf_cases_active_ssn")) return "이미 등록된 의뢰인입니다 (같은 이름·주민번호가 활성 상태로 존재).";
    if (error.message.includes("uq_cf_cases_active_phone")) return "이미 등록된 의뢰인입니다 (같은 이름·연락처가 활성 상태로 존재).";
    return "이미 등록된 사건입니다 (같은 법원·사건번호가 활성 상태로 존재).";
  }
  return error.message;
}

// ─────────────────────────────────────────────
// 사건 등록 (단건)
// ─────────────────────────────────────────────

export interface CreateCaseInput {
  case_number?: string;
  case_type?: CaseType;
  seq_number?: number;
  applicant_name: string;
  applicant_spouse?: string;
  applicant_ssn?: string;
  applicant_phone?: string;
  court_region?: string;
  counselor_name?: string;
  staff_name?: string;
  assigned_to?: string;
  income_type?: string;
  fee?: number;
  doc_received_at?: string;
  distribution_date?: string;
  judge_info?: string;
  creditor_meeting?: string;
  notes?: string;
}

/** Supabase RPC 함수가 아직 배포되지 않았을 때(마이그레이션 미적용) 나는 에러인지 */
function isMissingRpc(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  return error.code === "PGRST202" || /could not find the function|does not exist/i.test(error.message ?? "");
}

// 엑셀처럼 새 사건은 항상 가장 큰 의뢰인 번호 다음을 받는다.
// staff는 RLS로 본인 사건만 보이므로 firm 전체 max는 SECURITY DEFINER RPC로 받는다.
async function nextSeqNumber(firmId: string | null): Promise<number> {
  const { data, error } = await supabase.rpc("cf_next_seq_number");
  if (!error && typeof data === "number") return data;
  if (error && !isMissingRpc(error)) console.warn("[seq] cf_next_seq_number 실패, 직접 조회로 폴백:", error.message);
  return nextSeqNumberLegacy(firmId);
}

async function nextSeqNumberLegacy(firmId: string | null): Promise<number> {
  let query = supabase
    .from("cf_cases")
    .select("seq_number")
    .not("seq_number", "is", null)
    .order("seq_number", { ascending: false })
    .limit(1);
  if (firmId) query = query.eq("firm_id", firmId);
  const { data } = await query;
  return ((data?.[0]?.seq_number as number | undefined) ?? 0) + 1;
}

export async function createCase(input: CreateCaseInput): Promise<{ id?: string; error?: string }> {
  let profile: CurrentProfile;
  try { profile = await getCurrentProfile(); } catch (e: any) { return { error: e?.message }; }

  const seqNumber = input.seq_number ?? await nextSeqNumber(profile.firm_id);

  const courtName = input.court_region
    ? COURT_MAPPING[input.court_region] || input.court_region
    : null;

  const insertRow = {
    firm_id: profile.firm_id,
    case_number: input.case_number || null,
    case_type: input.case_type || null,
    applicant_name: input.applicant_name,
    applicant_spouse: input.applicant_spouse || null,
    applicant_ssn_enc: input.applicant_ssn || null,
    applicant_phone_enc: input.applicant_phone || null,
    court_region: input.court_region || null,
    court_name: courtName,
    counselor_name: input.counselor_name || null,
    staff_name: input.staff_name || profile.name || null,
    assigned_to: input.assigned_to || profile.id,
    seq_number: seqNumber,
    income_type: input.income_type || null,
    fee: input.fee ?? null,
    doc_received_at: input.doc_received_at || null,
    distribution_date: input.distribution_date || null,
    judge_info: input.judge_info || null,
    creditor_meeting: input.creditor_meeting || null,
    status: "pending",
    notes: input.notes || null,
  };

  const { data, error } = await supabase
    .from("cf_cases")
    .insert(insertRow)
    .select("id, created_at, updated_at")
    .single();
  if (error) return { error: friendlyInsertError(error) };

  // 로컬 SQLite에도 즉시 반영 (Realtime이 와도 INSERT OR REPLACE라 멱등)
  const nowIso = data!.created_at as string;
  await dbExecute(
    `INSERT OR REPLACE INTO cases (
      id, firm_id, case_number, case_type, seq_number,
      applicant_name, applicant_spouse, applicant_ssn_enc, applicant_phone_enc,
      court_region, court_name, counselor_name, assigned_to, staff_name,
      income_type, fee,
      doc_received_at, distribution_date, judge_info, creditor_meeting,
      status, case_progress,
      notes, progress_count, unseen_changes,
      created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      data!.id, insertRow.firm_id, insertRow.case_number, insertRow.case_type, insertRow.seq_number,
      insertRow.applicant_name, insertRow.applicant_spouse, insertRow.applicant_ssn_enc, insertRow.applicant_phone_enc,
      insertRow.court_region, insertRow.court_name, insertRow.counselor_name, insertRow.assigned_to, insertRow.staff_name,
      insertRow.income_type, insertRow.fee,
      insertRow.doc_received_at, insertRow.distribution_date, insertRow.judge_info, insertRow.creditor_meeting,
      "pending", "active",
      insertRow.notes, 0, 0,
      nowIso, data!.updated_at,
    ],
  );

  return { id: data!.id };
}

// ─────────────────────────────────────────────
// 사건 일괄 등록 (엑셀)
// ─────────────────────────────────────────────

export async function bulkCreateCases(inputs: CreateCaseInput[]): Promise<{
  count: number;
  error?: string;
  createdIds: { id: string; hasNumber: boolean }[];
}> {
  let profile: CurrentProfile;
  try { profile = await getCurrentProfile(); } catch (e: any) { return { error: e?.message, count: 0, createdIds: [] }; }

  // 번호 없는 행은 현재 최대 번호 다음부터 순서대로 부여
  let autoSeq = inputs.some((i) => i.seq_number == null)
    ? await nextSeqNumber(profile.firm_id)
    : 0;

  const rows = inputs.map((input) => ({
    firm_id: profile.firm_id,
    case_number: input.case_number || null,
    case_type: input.case_type || null,
    applicant_name: input.applicant_name,
    applicant_spouse: input.applicant_spouse || null,
    applicant_ssn_enc: input.applicant_ssn || null,
    applicant_phone_enc: input.applicant_phone || null,
    court_region: input.court_region || null,
    court_name: input.court_region
      ? COURT_MAPPING[input.court_region] || input.court_region
      : null,
    counselor_name: input.counselor_name || null,
    staff_name: input.staff_name || profile.name || null,
    assigned_to: input.assigned_to || profile.id,
    seq_number: input.seq_number ?? autoSeq++,
    income_type: input.income_type || null,
    fee: input.fee ?? null,
    doc_received_at: input.doc_received_at || null,
    distribution_date: input.distribution_date || null,
    judge_info: input.judge_info || null,
    creditor_meeting: input.creditor_meeting || null,
    status: "pending",
    notes: input.notes || null,
  }));

  const BATCH = 500;
  let count = 0;
  let error: any = null;
  const createdIds: { id: string; hasNumber: boolean }[] = [];
  for (let i = 0; i < rows.length; i += BATCH) {
    const batch = rows.slice(i, i + BATCH);
    const { data, error: err } = await supabase
      .from("cf_cases")
      .insert(batch)
      .select("id, created_at, updated_at");
    if (err) { error = err; break; }
    if (data) {
      count += data.length;
      // 로컬 SQLite 반영 (Realtime이 와도 멱등)
      for (let idx = 0; idx < data.length; idx++) {
        const d = data[idx];
        const r = batch[idx];
        createdIds.push({ id: d.id, hasNumber: !!r.case_number });
        await dbExecute(
          `INSERT OR REPLACE INTO cases (
            id, firm_id, case_number, case_type, seq_number,
            applicant_name, applicant_spouse, applicant_ssn_enc, applicant_phone_enc,
            court_region, court_name, counselor_name, assigned_to, staff_name,
            income_type, fee,
            doc_received_at, distribution_date, judge_info, creditor_meeting,
            status, case_progress,
            notes, progress_count, unseen_changes,
            created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            d.id, r.firm_id, r.case_number, r.case_type, r.seq_number,
            r.applicant_name, r.applicant_spouse, r.applicant_ssn_enc, r.applicant_phone_enc,
            r.court_region, r.court_name, r.counselor_name, r.assigned_to, r.staff_name,
            r.income_type, r.fee,
            r.doc_received_at, r.distribution_date, r.judge_info, r.creditor_meeting,
            "pending", "active",
            r.notes, 0, 0,
            d.created_at, d.updated_at,
          ],
        );
      }
    }
  }
  if (error) return { error: friendlyInsertError(error), count, createdIds };
  return { count, createdIds };
}

// ─────────────────────────────────────────────
// 보정 상태 계산 — 기한 기준 pending / approaching(3일 이내) / overdue
// (서버 크롤러의 판정 규칙과 동일하게 유지할 것)
// ─────────────────────────────────────────────

export function computeCorrectionStatus(deadline: string | null | undefined): {
  status: "pending" | "approaching" | "overdue";
  overdueDays: number;
} {
  const days = daysUntil(deadline ?? null);
  if (days === null) return { status: "pending", overdueDays: 0 };
  if (days < 0) return { status: "overdue", overdueDays: -days };
  if (days <= 3) return { status: "approaching", overdueDays: 0 };
  return { status: "pending", overdueDays: 0 };
}

// ─────────────────────────────────────────────
// 보정 기한 직접 수정
// ─────────────────────────────────────────────

export async function updateCorrectionDeadline(
  correctionId: string,
  caseId: string,
  newDeadline: string,
): Promise<{ error?: string }> {
  const { status, overdueDays } = computeCorrectionStatus(newDeadline);

  // 1) 수신일이 비어있으면 오늘로 채움
  const { data: existing } = await supabase
    .from("cf_case_corrections")
    .select("received_date")
    .eq("id", correctionId)
    .single();

  const updateData: Record<string, unknown> = {
    deadline_date: newDeadline,
    status,
    overdue_days: overdueDays,
    auto_confirmed: true,
  };
  const today = todayStr();
  if (!existing?.received_date) updateData.received_date = today;

  const { error: sbErr } = await supabase
    .from("cf_case_corrections")
    .update(updateData)
    .eq("id", correctionId);
  if (sbErr) return { error: sbErr.message };

  // 2) extensions의 new_deadline 동기화 (기한 확정)
  await supabase
    .from("cf_correction_extensions")
    .update({ new_deadline: newDeadline })
    .eq("correction_id", correctionId);

  // 3) cases의 active/overdue 카운트 갱신 (트리거 없이 직접 카운트)
  await updateCaseCorrectionCounts(caseId);

  // 4) 로컬 SQLite 반영
  await dbExecute(
    `UPDATE case_corrections
     SET deadline_date = ?, status = ?, overdue_days = ?, auto_confirmed = 1,
         received_date = COALESCE(received_date, ?),
         updated_at = ?
     WHERE id = ?`,
    [newDeadline, status, overdueDays, today, new Date().toISOString(), correctionId],
  );
  await dbExecute(
    `UPDATE correction_extensions SET new_deadline = ? WHERE correction_id = ?`,
    [newDeadline, correctionId],
  );

  return {};
}

// ─────────────────────────────────────────────
// 보정 제출 완료
// ─────────────────────────────────────────────

export async function submitCorrection(
  correctionId: string,
  caseId: string,
  submittedDate: string,
): Promise<{ error?: string }> {
  const { error: sbErr } = await supabase
    .from("cf_case_corrections")
    .update({
      status: "submitted",
      submitted_date: submittedDate,
      manual_submit: true,
    })
    .eq("id", correctionId);
  if (sbErr) return { error: sbErr.message };

  // extensions 정리 (제출 완료 시)
  await supabase
    .from("cf_correction_extensions")
    .delete()
    .eq("correction_id", correctionId);

  await updateCaseCorrectionCounts(caseId);

  // 로컬 반영
  const now = new Date().toISOString();
  await dbExecute(
    `UPDATE case_corrections
     SET status = 'submitted', submitted_date = ?, manual_submit = 1, updated_at = ?
     WHERE id = ?`,
    [submittedDate, now, correctionId],
  );
  await dbExecute(
    `DELETE FROM correction_extensions WHERE correction_id = ?`,
    [correctionId],
  );

  return {};
}

// ─────────────────────────────────────────────
// 보정 기한 연장
// ─────────────────────────────────────────────

export async function createExtension(input: {
  correction_id: string;
  case_id: string;
  extension_date: string;
  extension_days: number;
  new_deadline: string;
}): Promise<{ error?: string }> {
  // 차수 계산
  const { count } = await supabase
    .from("cf_correction_extensions")
    .select("*", { count: "exact", head: true })
    .eq("correction_id", input.correction_id);
  const extensionNumber = (count ?? 0) + 1;

  const { data: inserted, error: insErr } = await supabase
    .from("cf_correction_extensions")
    .insert({
      correction_id: input.correction_id,
      extension_number: extensionNumber,
      extension_date: input.extension_date,
      extension_days: input.extension_days,
      new_deadline: input.new_deadline || null,
    })
    .select("id, created_at")
    .single();
  if (insErr) return { error: insErr.message };

  // 사건 보정의 deadline_date 갱신 + status='pending' 리셋
  if (input.new_deadline) {
    await supabase
      .from("cf_case_corrections")
      .update({ deadline_date: input.new_deadline, status: "pending" })
      .eq("id", input.correction_id);
  }
  await updateCaseCorrectionCounts(input.case_id);

  // 로컬 반영
  const now = new Date().toISOString();
  await dbExecute(
    `INSERT INTO correction_extensions
       (id, correction_id, extension_number, extension_date, extension_days, new_deadline, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      inserted!.id, input.correction_id, extensionNumber,
      input.extension_date, input.extension_days, input.new_deadline || null,
      inserted!.created_at,
    ],
  );
  if (input.new_deadline) {
    await dbExecute(
      `UPDATE case_corrections SET deadline_date = ?, status = 'pending', updated_at = ?
       WHERE id = ?`,
      [input.new_deadline, now, input.correction_id],
    );
  }

  return {};
}

// ─────────────────────────────────────────────
// 보정 수동 생성
// ─────────────────────────────────────────────

export interface CreateCorrectionInput {
  case_id: string;
  firm_id: string;
  document_type: string;
  document_category: string;
  served_date?: string;
  received_date?: string;
  deadline_date?: string;
  notes_1?: string;
  notes_2?: string;
}

export async function createCorrection(input: CreateCorrectionInput): Promise<{ error?: string; id?: string }> {
  const baseDate = input.received_date || input.served_date;
  const deadline_7d = baseDate ? addDays(baseDate, 7) : null;
  const deadlineDate = input.deadline_date || deadline_7d;

  const { status, overdueDays } = computeCorrectionStatus(deadlineDate);

  const { data, error: insErr } = await supabase
    .from("cf_case_corrections")
    .insert({
      case_id: input.case_id,
      firm_id: input.firm_id,
      document_type: input.document_type,
      document_category: input.document_category,
      served_date: input.served_date || null,
      received_date: input.received_date || null,
      auto_confirmed: false,
      deadline_7d,
      deadline_date: deadlineDate,
      status,
      overdue_days: overdueDays,
      notes_1: input.notes_1 || null,
      notes_2: input.notes_2 || null,
    })
    .select("id, created_at, updated_at")
    .single();
  if (insErr) return { error: insErr.message };

  await updateCaseCorrectionCounts(input.case_id);

  // 로컬 반영
  await dbExecute(
    `INSERT INTO case_corrections (
      id, case_id, firm_id, document_type, document_category,
      served_date, received_date, auto_confirmed,
      deadline_7d, deadline_14d, deadline_date,
      status, overdue_days, submitted_date, manual_submit,
      arrival_raw, notes_1, notes_2,
      created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      data!.id, input.case_id, input.firm_id, input.document_type, input.document_category,
      input.served_date || null, input.received_date || null, 0,
      deadline_7d, null, deadlineDate,
      status, overdueDays, null, 0,
      null, input.notes_1 || null, input.notes_2 || null,
      data!.created_at, data!.updated_at,
    ],
  );

  return { id: data!.id };
}

// ─────────────────────────────────────────────
// 사건 삭제
// ─────────────────────────────────────────────

export async function deleteCase(caseId: string): Promise<{ error?: string }> {
  // 1) Supabase: 연장 → 보정 → 사건 순서
  const { data: corrs } = await supabase
    .from("cf_case_corrections")
    .select("id")
    .eq("case_id", caseId);
  if (corrs && corrs.length > 0) {
    const ids = corrs.map((c) => c.id);
    await supabase.from("cf_correction_extensions").delete().in("correction_id", ids);
    await supabase.from("cf_case_corrections").delete().eq("case_id", caseId);
  }
  const { error } = await supabase.from("cf_cases").delete().eq("id", caseId);
  if (error) return { error: error.message };

  // 2) 로컬 SQLite 동일 순서
  const localCorrs = await dbSelect<{ id: string }>(
    "SELECT id FROM case_corrections WHERE case_id = ?",
    [caseId],
  );
  for (const c of localCorrs) {
    await dbExecute("DELETE FROM correction_extensions WHERE correction_id = ?", [c.id]);
  }
  await dbExecute("DELETE FROM case_corrections WHERE case_id = ?", [caseId]);
  await dbExecute("DELETE FROM cases WHERE id = ?", [caseId]);

  return {};
}

// ─────────────────────────────────────────────
// 사건 정보 수정
// ─────────────────────────────────────────────

export async function updateCase(
  caseId: string,
  updates: Record<string, unknown>,
): Promise<{ error?: string }> {
  const { error } = await supabase
    .from("cf_cases")
    .update(updates)
    .eq("id", caseId);
  if (error) return { error: friendlyInsertError(error) };

  // 로컬 SQLite — 컬럼명이 동일한 컬럼만 받음
  const allowed = new Set([
    "case_number", "case_type", "seq_number", "applicant_name", "applicant_spouse",
    "applicant_ssn_enc", "applicant_phone_enc", "court_region", "court_name",
    "counselor_name", "assigned_to", "staff_name", "income_type", "fee",
    "doc_received_at", "distribution_date", "judge_info", "judge_phone", "creditor_meeting",
    "status", "case_progress", "notes", "handler_status", "handler_checked", "handler_checked_at",
    "is_active",
  ]);
  const setEntries = Object.entries(updates).filter(([k]) => allowed.has(k));
  if (setEntries.length === 0) return {};
  const setSql = setEntries.map(([k]) => `${k} = ?`).join(", ");
  const values = setEntries.map(([, v]) => v as unknown);
  await dbExecute(
    `UPDATE cases SET ${setSql}, updated_at = ? WHERE id = ?`,
    [...values, new Date().toISOString(), caseId],
  );
  return {};
}

// ─────────────────────────────────────────────
// 헬퍼: 사건의 active/overdue 카운트 재계산 (Supabase + 로컬)
// ─────────────────────────────────────────────

async function updateCaseCorrectionCounts(caseId: string) {
  const { count: activeCount } = await supabase
    .from("cf_case_corrections")
    .select("*", { count: "exact", head: true })
    .eq("case_id", caseId)
    .in("status", ["pending", "approaching", "overdue"]);

  const { count: overdueCount } = await supabase
    .from("cf_case_corrections")
    .select("*", { count: "exact", head: true })
    .eq("case_id", caseId)
    .eq("status", "overdue");

  await supabase
    .from("cf_cases")
    .update({
      active_corrections_count: activeCount ?? 0,
      overdue_corrections_count: overdueCount ?? 0,
    })
    .eq("id", caseId);

  await dbExecute(
    `UPDATE cases
     SET active_corrections_count = ?, overdue_corrections_count = ?,
         updated_at = ?
     WHERE id = ?`,
    [activeCount ?? 0, overdueCount ?? 0, new Date().toISOString(), caseId],
  );
}

// ─────────────────────────────────────────────
// unseen_changes 리셋 (사건 상세 진입 시)
// ─────────────────────────────────────────────

export async function resetUnseenChanges(caseId: string): Promise<void> {
  await supabase.from("cf_cases").update({ unseen_changes: 0 }).eq("id", caseId);
  await dbExecute("UPDATE cases SET unseen_changes = 0 WHERE id = ?", [caseId]);
}

// ─────────────────────────────────────────────
// 알림: 읽음 / 전체 읽음
// ─────────────────────────────────────────────

export async function markNotificationAsRead(notificationId: string): Promise<{ error?: string }> {
  const now = new Date().toISOString();
  const { error } = await supabase
    .from("cf_notifications")
    .update({ is_read: true, read_at: now })
    .eq("id", notificationId);
  if (error) return { error: error.message };
  await dbExecute(
    "UPDATE notifications SET is_read = 1, read_at = ? WHERE id = ?",
    [now, notificationId],
  );
  return {};
}

export async function markAllNotificationsAsRead(): Promise<{ error?: string }> {
  const user = await getSessionUser();
  if (!user) return { error: "인증 필요" };
  const now = new Date().toISOString();
  const { error } = await supabase
    .from("cf_notifications")
    .update({ is_read: true, read_at: now })
    .eq("user_id", user.id)
    .eq("is_read", false);
  if (error) return { error: error.message };
  await dbExecute(
    "UPDATE notifications SET is_read = 1, read_at = ? WHERE user_id = ? AND is_read = 0",
    [now, user.id],
  );
  return {};
}
