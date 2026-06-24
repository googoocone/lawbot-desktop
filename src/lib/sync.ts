import { supabase } from "./supabase";
import { dbSelect, dbExecute, dbTx } from "./db";

// ─────────────────────────────────────────────
// sync_state 헬퍼
// ─────────────────────────────────────────────

async function getLastSyncedAt(table: string): Promise<string | null> {
  const rows = await dbSelect<{ last_synced_at: string | null }>(
    "SELECT last_synced_at FROM sync_state WHERE table_name = ?",
    [table],
  );
  return rows[0]?.last_synced_at ?? null;
}

async function setLastSyncedAt(table: string, isoTime: string) {
  await dbExecute(
    "UPDATE sync_state SET last_synced_at = ? WHERE table_name = ?",
    [isoTime, table],
  );
}

// ─────────────────────────────────────────────
// 페이지네이션 fetch — Supabase 1000행 제한 회피
// ─────────────────────────────────────────────

async function fetchAllChanged<T>(
  sbTable: string,
  lastSyncedAt: string | null,
  timestampColumn = "updated_at",
  onPage?: (received: number) => void,
): Promise<T[]> {
  const PAGE = 1000;
  const out: T[] = [];
  let offset = 0;
  while (true) {
    let q = supabase
      .from(sbTable)
      .select("*")
      .order(timestampColumn, { ascending: true });
    if (lastSyncedAt) q = q.gt(timestampColumn, lastSyncedAt);
    const { data, error } = await q.range(offset, offset + PAGE - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    out.push(...(data as T[]));
    onPage?.(out.length);
    if (data.length < PAGE) break;
    offset += PAGE;
  }
  return out;
}

// 동기화할 행 개수 — 진행률(%) 계산용. head:true라 데이터는 안 받고 count만.
async function countChanged(
  sbTable: string,
  lastSyncedAt: string | null,
  timestampColumn = "updated_at",
): Promise<number> {
  let q = supabase.from(sbTable).select("id", { count: "exact", head: true });
  if (lastSyncedAt) q = q.gt(timestampColumn, lastSyncedAt);
  const { count, error } = await q;
  if (error) return 0;
  return count ?? 0;
}

// 서버 테이블의 전체 id 집합 — 삭제 정합성용. id만 받아 가볍다.
async function fetchAllIds(sbTable: string): Promise<Set<string>> {
  const PAGE = 1000;
  const ids = new Set<string>();
  let offset = 0;
  while (true) {
    const { data, error } = await supabase
      .from(sbTable)
      .select("id")
      .range(offset, offset + PAGE - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    for (const r of data as { id: string }[]) ids.add(r.id);
    if (data.length < PAGE) break;
    offset += PAGE;
  }
  return ids;
}

// ─────────────────────────────────────────────
// 변환 헬퍼
// ─────────────────────────────────────────────

function b(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  return v ? 1 : 0;
}

function j(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  return typeof v === "string" ? v : JSON.stringify(v);
}

// ─────────────────────────────────────────────
// cases
// ─────────────────────────────────────────────

export async function syncCases(
  onProgress?: (done: number, total: number) => void,
): Promise<number> {
  const last = await getLastSyncedAt("cases");
  const total = onProgress ? await countChanged("cf_cases", last) : 0;
  const rows = await fetchAllChanged<any>(
    "cf_cases", last, "updated_at",
    onProgress ? (received) => onProgress(received, total) : undefined,
  );
  if (rows.length === 0) return 0;

  await dbTx(async (db) => {
    for (const r of rows) {
      await db.execute(
        `INSERT OR REPLACE INTO cases (
          id, firm_id, case_number, case_type, seq_number,
          applicant_name, applicant_spouse, applicant_ssn_enc, applicant_phone_enc,
          court_region, court_name, counselor_name, assigned_to, staff_name,
          income_type, fee,
          doc_received_at, distribution_date, judge_info, judge_phone, creditor_meeting,
          filed_date, commencement_date, approval_date, declared_date,
          dismissed_date, withdrawn_date, discharged_date,
          status, case_progress,
          active_corrections_count, overdue_corrections_count,
          handler_checked, handler_checked_at, handler_status,
          notes, progress_data, progress_count, unseen_changes,
          last_crawled_at, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          r.id, r.firm_id, r.case_number, r.case_type, r.seq_number,
          r.applicant_name, r.applicant_spouse, r.applicant_ssn_enc, r.applicant_phone_enc,
          r.court_region, r.court_name, r.counselor_name, r.assigned_to, r.staff_name,
          r.income_type, r.fee,
          r.doc_received_at, r.distribution_date, r.judge_info, r.judge_phone, r.creditor_meeting,
          r.filed_date, r.commencement_date, r.approval_date, r.declared_date,
          r.dismissed_date, r.withdrawn_date, r.discharged_date,
          r.status, r.case_progress,
          r.active_corrections_count, r.overdue_corrections_count,
          b(r.handler_checked), r.handler_checked_at, r.handler_status,
          r.notes, j(r.progress_data), r.progress_count, r.unseen_changes,
          r.last_crawled_at, r.created_at, r.updated_at,
        ],
      );
    }
  });

  const max = rows.reduce((m, r) => (r.updated_at > m ? r.updated_at : m), last || "");
  await setLastSyncedAt("cases", max);
  return rows.length;
}

// ─────────────────────────────────────────────
// case_corrections
// ─────────────────────────────────────────────

export async function syncCorrections(): Promise<number> {
  const last = await getLastSyncedAt("case_corrections");
  const rows = await fetchAllChanged<any>("cf_case_corrections", last);
  if (rows.length === 0) return 0;

  await dbTx(async (db) => {
    for (const r of rows) {
      await db.execute(
        `INSERT OR REPLACE INTO case_corrections (
          id, case_id, firm_id, document_type, document_category,
          served_date, received_date, auto_confirmed,
          deadline_days, deadline_7d, deadline_14d, deadline_date,
          status, overdue_days,
          submitted_date, manual_submit,
          arrival_raw, notes_1, notes_2,
          created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          r.id, r.case_id, r.firm_id, r.document_type, r.document_category,
          r.served_date, r.received_date, b(r.auto_confirmed),
          r.deadline_days, r.deadline_7d, r.deadline_14d, r.deadline_date,
          r.status, r.overdue_days,
          r.submitted_date, b(r.manual_submit),
          r.arrival_raw, r.notes_1, r.notes_2,
          r.created_at, r.updated_at,
        ],
      );
    }
  });

  const max = rows.reduce((m, r) => (r.updated_at > m ? r.updated_at : m), last || "");
  await setLastSyncedAt("case_corrections", max);
  return rows.length;
}

// ─────────────────────────────────────────────
// correction_extensions (updated_at 컬럼 없음 → created_at 기준)
// ─────────────────────────────────────────────

export async function syncExtensions(): Promise<number> {
  const last = await getLastSyncedAt("correction_extensions");
  const rows = await fetchAllChanged<any>("cf_correction_extensions", last, "created_at");
  if (rows.length === 0) return 0;

  await dbTx(async (db) => {
    for (const r of rows) {
      await db.execute(
        `INSERT OR REPLACE INTO correction_extensions (
          id, correction_id, extension_number,
          extension_date, extension_days, new_deadline, overdue_after_ext,
          created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          r.id, r.correction_id, r.extension_number,
          r.extension_date, r.extension_days, r.new_deadline, r.overdue_after_ext,
          r.created_at,
        ],
      );
    }
  });

  const max = rows.reduce((m, r) => (r.created_at > m ? r.created_at : m), last || "");
  await setLastSyncedAt("correction_extensions", max);
  return rows.length;
}

// ─────────────────────────────────────────────
// profiles (담당자 이름 표시용 — 같은 firm만)
// ─────────────────────────────────────────────

export async function syncProfiles(): Promise<number> {
  const last = await getLastSyncedAt("profiles");
  // profiles는 firm_id 필터링이 클라이언트에서 무의미 (RLS가 막아줌)
  const rows = await fetchAllChanged<any>("profiles", last);
  if (rows.length === 0) return 0;

  await dbTx(async (db) => {
    for (const r of rows) {
      await db.execute(
        `INSERT OR REPLACE INTO profiles (
          id, firm_id, email, name, role, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [r.id, r.firm_id, r.email, r.name, r.role, r.created_at, r.updated_at],
      );
    }
  });

  const max = rows.reduce((m, r) => (r.updated_at > m ? r.updated_at : m), last || "");
  await setLastSyncedAt("profiles", max);
  return rows.length;
}

// ─────────────────────────────────────────────
// notifications (cf_notifications) — created_at 기준 (updated_at 컬럼 없음)
// ─────────────────────────────────────────────

export async function syncNotifications(): Promise<number> {
  const last = await getLastSyncedAt("notifications");
  const rows = await fetchAllChanged<any>("cf_notifications", last, "created_at");
  if (rows.length === 0) return 0;

  await dbTx(async (db) => {
    for (const r of rows) {
      await db.execute(
        `INSERT OR REPLACE INTO notifications (
          id, user_id, case_id, correction_id, firm_id,
          type, priority, title, message,
          is_read, read_at, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          r.id, r.user_id, r.case_id, r.correction_id, r.firm_id,
          r.type, r.priority, r.title, r.message,
          b(r.is_read), r.read_at, r.created_at,
        ],
      );
    }
  });

  const max = rows.reduce((m, r) => (r.created_at > m ? r.created_at : m), last || "");
  await setLastSyncedAt("notifications", max);
  return rows.length;
}

// ─────────────────────────────────────────────
// 로컬 미러 소유자 체크 — 다른 계정 로그인 시 초기화
// ─────────────────────────────────────────────

/**
 * 로컬 미러 테이블 전체를 비우고 sync_state를 초기화한다 (다음 syncAll이 풀 싱크가 됨).
 * owner_user_id 등 local_meta는 건드리지 않는다.
 * "로컬 데이터 재동기화"(설정 버튼)와 계정 변경 초기화가 공유한다.
 */
export async function clearLocalMirror(): Promise<void> {
  await dbTx(async (db) => {
    await db.execute("DELETE FROM cases");
    await db.execute("DELETE FROM case_corrections");
    await db.execute("DELETE FROM correction_extensions");
    await db.execute("DELETE FROM notifications");
    await db.execute("DELETE FROM profiles");
    await db.execute("UPDATE sync_state SET last_synced_at = NULL");
  });
}

/**
 * 로컬 SQLite는 PC당 하나라서, 이전에 다른 계정이 동기화한 데이터가 남아있으면
 * 현재 계정에게 그대로 노출된다. 로그인한 user_id가 마지막 소유자와 다르면
 * 미러 테이블 전체를 비우고 sync_state를 초기화해 풀 싱크를 유도한다.
 *
 * @returns 초기화가 일어났으면 true
 */
export async function ensureLocalDataOwner(userId: string): Promise<boolean> {
  const rows = await dbSelect<{ value: string }>(
    "SELECT value FROM local_meta WHERE key = 'owner_user_id'",
  );
  const owner = rows[0]?.value ?? null;
  if (owner === userId) return false;

  await clearLocalMirror();
  await dbExecute(
    "INSERT OR REPLACE INTO local_meta (key, value) VALUES ('owner_user_id', ?)",
    [userId],
  );
  return true;
}

// ─────────────────────────────────────────────
// 삭제 정합성 — 서버에서 사라진 행을 로컬에서도 제거
//
// syncAll은 INSERT OR REPLACE(upsert)만 하고 삭제는 안 한다. 서버에서 사건이
// 삭제(예: 중복 정리)될 때 앱이 꺼져 있었으면 Realtime DELETE를 놓쳐 로컬에
// 유령 행이 남는다. 동기화 끝에 서버 id 집합과 대조해 로컬 잉여 행을 지운다.
// ─────────────────────────────────────────────

const RECONCILE_TABLES: { sb: string; local: string }[] = [
  { sb: "cf_cases", local: "cases" },
  { sb: "cf_case_corrections", local: "case_corrections" },
  { sb: "cf_correction_extensions", local: "correction_extensions" },
];

export async function reconcileDeletes(): Promise<number> {
  let removed = 0;
  for (const { sb, local } of RECONCILE_TABLES) {
    try {
      const serverIds = await fetchAllIds(sb);
      // 안전장치: 서버가 0건을 반환(일시적 RLS/인증 문제 등)하면 로컬 전체가 지워질 수 있어
      // 아예 건너뛴다. 정상 운영 상태에서 cases가 0인 경우는 없다.
      if (serverIds.size === 0) continue;

      const localRows = await dbSelect<{ id: string }>(`SELECT id FROM ${local}`);
      const stale = localRows.map((r) => r.id).filter((id) => !serverIds.has(id));
      if (stale.length === 0) continue;

      const CHUNK = 400;
      await dbTx(async (db) => {
        for (let i = 0; i < stale.length; i += CHUNK) {
          const chunk = stale.slice(i, i + CHUNK);
          const placeholders = chunk.map(() => "?").join(",");
          await db.execute(`DELETE FROM ${local} WHERE id IN (${placeholders})`, chunk);
        }
      });
      removed += stale.length;
      console.log(`[sync] reconcile ${local}: 잉여 ${stale.length}건 삭제`);
    } catch (e) {
      // 서버 id 조회 실패 시 그 테이블은 삭제하지 않고 넘어간다 (오삭제 방지).
      console.error(`[sync] reconcile ${local} 건너뜀 (조회 실패):`, e);
    }
  }
  return removed;
}

// ─────────────────────────────────────────────
// 전체 동기화 진입점
// ─────────────────────────────────────────────

export interface SyncResult {
  cases: number;
  corrections: number;
  extensions: number;
  profiles: number;
  notifications: number;
  deleted: number;
  elapsedMs: number;
}

export interface SyncProgress {
  stage: string;
  percent: number;
}

export async function syncAll(
  onProgress?: (p: SyncProgress) => void,
): Promise<SyncResult> {
  const t0 = performance.now();
  // cases가 데이터의 대부분이라 5~88% 구간을 cases 진행률에 할당하고,
  // 나머지 가벼운 테이블은 88~100%로 빠르게 채운다.
  onProgress?.({ stage: "준비 중", percent: 0 });
  const profiles = await syncProfiles();
  onProgress?.({ stage: "사건", percent: 5 });
  const cases = await syncCases((done, total) => {
    const p = total > 0 ? 5 + Math.round((done / total) * 83) : 5;
    onProgress?.({ stage: "사건", percent: Math.min(88, p) });
  });
  onProgress?.({ stage: "보정", percent: 90 });
  const corrections = await syncCorrections();
  onProgress?.({ stage: "연장", percent: 94 });
  const extensions = await syncExtensions();
  onProgress?.({ stage: "알림", percent: 96 });
  const notifications = await syncNotifications();
  // 서버에서 삭제된 사건/보정/연장을 로컬에서도 제거 (앱이 꺼져 있어 놓친 삭제 따라잡기)
  onProgress?.({ stage: "정리", percent: 98 });
  const deleted = await reconcileDeletes();
  onProgress?.({ stage: "완료", percent: 100 });
  return {
    cases,
    corrections,
    extensions,
    profiles,
    notifications,
    deleted,
    elapsedMs: Math.round(performance.now() - t0),
  };
}

// ─────────────────────────────────────────────
// Realtime 구독 (다음 단계)
// ─────────────────────────────────────────────

export function subscribeRealtime() {
  // TODO: case list 화면 붙이고 나서 구현
}
