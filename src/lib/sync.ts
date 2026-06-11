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
    if (data.length < PAGE) break;
    offset += PAGE;
  }
  return out;
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

export async function syncCases(): Promise<number> {
  const last = await getLastSyncedAt("cases");
  const rows = await fetchAllChanged<any>("cf_cases", last);
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
// 전체 동기화 진입점
// ─────────────────────────────────────────────

export interface SyncResult {
  cases: number;
  corrections: number;
  extensions: number;
  profiles: number;
  notifications: number;
  elapsedMs: number;
}

export async function syncAll(
  onProgress?: (stage: string) => void,
): Promise<SyncResult> {
  const t0 = performance.now();
  onProgress?.("프로필");
  const profiles = await syncProfiles();
  onProgress?.("사건");
  const cases = await syncCases();
  onProgress?.("보정");
  const corrections = await syncCorrections();
  onProgress?.("연장");
  const extensions = await syncExtensions();
  onProgress?.("알림");
  const notifications = await syncNotifications();
  return {
    cases,
    corrections,
    extensions,
    profiles,
    notifications,
    elapsedMs: Math.round(performance.now() - t0),
  };
}

// ─────────────────────────────────────────────
// Realtime 구독 (다음 단계)
// ─────────────────────────────────────────────

export function subscribeRealtime() {
  // TODO: case list 화면 붙이고 나서 구현
}
