// Supabase Realtime — 다른 PC에서 cf_* 테이블에 변경이 일어나면 즉시 푸시.
// 받으면 로컬 SQLite를 업데이트하고 부모(App)에 onChange를 알려서 React state를 갱신.
//
// ⚠ 동작 조건: Supabase Database > Replication > supabase_realtime publication에
//    cf_cases, cf_case_corrections, cf_correction_extensions 가 포함되어 있어야 함.
//    (SQL: alter publication supabase_realtime add table cf_cases, cf_case_corrections, cf_correction_extensions;)

import { supabase } from "./supabase";
import { dbExecute } from "./db";

type RowChange<T = Record<string, unknown>> = {
  eventType: "INSERT" | "UPDATE" | "DELETE";
  new: T | null;
  old: T | null;
};

function b(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  return v ? 1 : 0;
}

function j(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  return typeof v === "string" ? v : JSON.stringify(v);
}

// ─────────────────────────────────────────────
// 테이블별 upsert / delete
// ─────────────────────────────────────────────

async function upsertCase(r: any) {
  await dbExecute(
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

async function upsertCorrection(r: any) {
  await dbExecute(
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

async function upsertExtension(r: any) {
  await dbExecute(
    `INSERT OR REPLACE INTO correction_extensions (
      id, correction_id, extension_number,
      extension_date, extension_days, new_deadline, overdue_after_ext,
      created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      r.id, r.correction_id, r.extension_number,
      r.extension_date, r.extension_days, r.new_deadline, r.overdue_after_ext ?? 0,
      r.created_at,
    ],
  );
}

async function upsertNotification(r: any) {
  await dbExecute(
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

async function deleteLocal(table: string, id: string) {
  await dbExecute(`DELETE FROM ${table} WHERE id = ?`, [id]);
}

// ─────────────────────────────────────────────
// 메인 진입점
// ─────────────────────────────────────────────

export interface RealtimeStatus {
  cases: "idle" | "subscribing" | "ready" | "error";
  corrections: "idle" | "subscribing" | "ready" | "error";
  extensions: "idle" | "subscribing" | "ready" | "error";
}

export function subscribeRealtime(opts: {
  onChange: () => void;
  onStatus?: (status: RealtimeStatus) => void;
}): () => void {
  const status: RealtimeStatus = {
    cases: "subscribing",
    corrections: "subscribing",
    extensions: "subscribing",
  };
  opts.onStatus?.({ ...status });

  // 짧은 시간에 여러 이벤트가 오면 reload를 너무 자주 호출하지 않게 디바운스
  let pending: ReturnType<typeof setTimeout> | null = null;
  const trigger = () => {
    if (pending) clearTimeout(pending);
    pending = setTimeout(() => {
      pending = null;
      opts.onChange();
    }, 300);
  };

  const handle = async (
    table: "cases" | "case_corrections" | "correction_extensions" | "notifications",
    payload: RowChange,
  ) => {
    try {
      if (payload.eventType === "DELETE") {
        const id = (payload.old as any)?.id;
        if (id) await deleteLocal(table, id);
      } else {
        const row = payload.new;
        if (!row) return;
        if (table === "cases") await upsertCase(row);
        else if (table === "case_corrections") await upsertCorrection(row);
        else if (table === "correction_extensions") await upsertExtension(row);
        else if (table === "notifications") await upsertNotification(row);
      }
      trigger();
    } catch (e) {
      console.error("[realtime] handle error", table, e);
    }
  };

  const channel = supabase
    .channel("caseflow-realtime")
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "cf_cases" },
      (payload: any) => handle("cases", {
        eventType: payload.eventType,
        new: payload.new,
        old: payload.old,
      }),
    )
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "cf_case_corrections" },
      (payload: any) => handle("case_corrections", {
        eventType: payload.eventType,
        new: payload.new,
        old: payload.old,
      }),
    )
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "cf_correction_extensions" },
      (payload: any) => handle("correction_extensions", {
        eventType: payload.eventType,
        new: payload.new,
        old: payload.old,
      }),
    )
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "cf_notifications" },
      (payload: any) => handle("notifications", {
        eventType: payload.eventType,
        new: payload.new,
        old: payload.old,
      }),
    )
    .subscribe((subStatus) => {
      console.log("[realtime] channel status:", subStatus);
      const s: RealtimeStatus["cases"] =
        subStatus === "SUBSCRIBED" ? "ready" :
        subStatus === "CHANNEL_ERROR" || subStatus === "TIMED_OUT" ? "error" :
        "subscribing";
      status.cases = s;
      status.corrections = s;
      status.extensions = s;
      opts.onStatus?.({ ...status });
    });

  return () => {
    if (pending) clearTimeout(pending);
    supabase.removeChannel(channel);
  };
}
