// SQLite 로컬 데이터 → flow 웹앱의 CaseRow 모양으로 transform
// (flow/app/dashboard/case-schedule/page.tsx의 transform 로직과 동일)
import { dbSelect } from "@/lib/db";
import { addDays } from "@/lib/caseflow/utils/date";
import { getCaseScope } from "@/lib/caseflow/visibility";

export interface CaseRow {
  id: string;
  case_id: string;
  seq_number: number | null;
  court_region: string | null;
  case_number: string | null;
  applicant_name: string;
  judge_info: string | null;
  stage: string;
  stage_date: string | null;
  document_type: string | null;
  received_date: string | null;
  deadline_date: string | null;
  deadline_status: "submitted" | "overdue" | "extended" | "pending" | null;
  submitted_date: string | null;
  manual_submit: boolean;
  notes: string | null;
  correction_id: string | null;
  extensions: {
    extension_number: number;
    extension_date: string | null;
    new_deadline: string | null;
  }[];
  is_auto_deadline: boolean;
  auto_confirmed: boolean;
  arrival_raw: string | null;
  last_crawled_at: string | null;
  crawl_status: "pending" | "success" | "failed" | null;
  has_pending_extension: boolean;
  unseen_changes: number;
}

interface CaseRecord {
  id: string;
  case_number: string | null;
  court_region: string | null;
  applicant_name: string;
  judge_info: string | null;
  created_at: string;
  seq_number: number | null;
  commencement_date: string | null;
  approval_date: string | null;
  status: string;
  last_crawled_at: string | null;
  unseen_changes: number;
  filed_date: string | null;
  declared_date: string | null;
  dismissed_date: string | null;
  withdrawn_date: string | null;
  discharged_date: string | null;
  progress_count: number;
}

interface CorrectionRecord {
  id: string;
  case_id: string;
  document_type: string;
  served_date: string | null;
  received_date: string | null;
  deadline_7d: string | null;
  deadline_date: string | null;
  status: string;
  submitted_date: string | null;
  notes_1: string | null;
  auto_confirmed: number;
  arrival_raw: string | null;
  manual_submit: number;
}

interface ExtensionRecord {
  id: string;
  correction_id: string;
  extension_number: number;
  extension_date: string | null;
  new_deadline: string | null;
}

export async function loadCaseRows(): Promise<CaseRow[]> {
  // 가시성: staff는 본인 담당 사건만, 관리자는 전체
  const scope = await getCaseScope();

  // 병렬로 cases / corrections / extensions 로드
  const [cases, corrections, extensions] = await Promise.all([
    dbSelect<CaseRecord>(
      `SELECT id, case_number, court_region, applicant_name, judge_info, created_at, seq_number,
              commencement_date, approval_date, status, last_crawled_at, unseen_changes,
              filed_date, declared_date, dismissed_date, withdrawn_date, discharged_date, progress_count
       FROM cases${scope ? " WHERE assigned_to = ?" : ""}`,
      scope ? [scope] : [],
    ),
    dbSelect<CorrectionRecord>(
      `SELECT id, case_id, document_type, served_date, received_date, deadline_7d, deadline_date,
              status, submitted_date, notes_1, auto_confirmed, arrival_raw, manual_submit
       FROM case_corrections`,
    ),
    dbSelect<ExtensionRecord>(
      `SELECT id, correction_id, extension_number, extension_date, new_deadline
       FROM correction_extensions`,
    ),
  ]);

  // correction_id → extensions[] 맵
  const extByCorrection = new Map<string, ExtensionRecord[]>();
  for (const e of extensions) {
    const arr = extByCorrection.get(e.correction_id);
    if (arr) arr.push(e);
    else extByCorrection.set(e.correction_id, [e]);
  }

  // case_id → corrections[] 맵
  const corrByCase = new Map<string, CorrectionRecord[]>();
  for (const c of corrections) {
    const arr = corrByCase.get(c.case_id);
    if (arr) arr.push(c);
    else corrByCase.set(c.case_id, [c]);
  }

  // 사건별 CaseRow 생성
  const rows: CaseRow[] = cases.map((c) => {
    const isValidCaseNumber = c.case_number && /^\d{4}\D+\d+/.test(c.case_number);
    let stage: string = "filed";
    if (!isValidCaseNumber) stage = "pending";
    else if (c.status === "dismissed") stage = "dismissed";
    else if (c.status === "withdrawn") stage = "withdrawn";
    else if (c.status === "discharged") stage = "discharged";
    else if (c.approval_date || c.status === "approved") stage = "approved";
    else if (c.status === "declared") stage = "declared";
    else if (c.commencement_date || c.status === "commenced") stage = "commenced";

    const stageDate: Record<string, string | null> = {
      pending: null,
      filed: c.filed_date || (c.created_at ? c.created_at.split("T")[0] : null),
      commenced: c.commencement_date,
      approved: c.approval_date,
      declared: c.declared_date,
      dismissed: c.dismissed_date,
      withdrawn: c.withdrawn_date,
      discharged: c.discharged_date,
    };

    const myCorr = corrByCase.get(c.id) || [];
    const latestCorrection = myCorr.length > 0
      ? [...myCorr].sort((a, b) =>
          (b.received_date || b.served_date || "").localeCompare(
            a.received_date || a.served_date || "",
          ),
        )[0]
      : null;

    let deadlineDate = latestCorrection?.deadline_date || null;
    if (!deadlineDate && latestCorrection?.received_date) {
      deadlineDate = addDays(latestCorrection.received_date, 7);
    }

    let deadlineStatus: CaseRow["deadline_status"] = null;
    if (latestCorrection) {
      if (latestCorrection.submitted_date) deadlineStatus = "submitted";
      else if (latestCorrection.status === "overdue") deadlineStatus = "overdue";
      else deadlineStatus = "pending";
    }

    const latestCorrExtensions = latestCorrection
      ? extByCorrection.get(latestCorrection.id) || []
      : [];

    const isAutoDeadline = latestCorrection
      ? !latestCorrection.auto_confirmed &&
        ((!latestCorrection.deadline_date && !!latestCorrection.received_date) ||
          (latestCorrection.deadline_date != null &&
            latestCorrection.deadline_date === latestCorrection.deadline_7d))
      : false;

    return {
      id: c.id,
      case_id: c.id,
      seq_number: c.seq_number,
      court_region: c.court_region,
      case_number: c.case_number,
      applicant_name: c.applicant_name,
      judge_info: c.judge_info,
      stage,
      stage_date: stageDate[stage] || null,
      document_type: latestCorrection?.document_type || null,
      received_date: latestCorrection?.received_date || null,
      deadline_date: deadlineDate,
      deadline_status: deadlineStatus,
      submitted_date: latestCorrection?.submitted_date || null,
      manual_submit: !!latestCorrection?.manual_submit,
      notes: latestCorrection?.notes_1 || null,
      correction_id: latestCorrection?.id || null,
      extensions: latestCorrExtensions
        .sort((a, b) => a.extension_number - b.extension_number)
        .map((ext) => ({
          extension_number: ext.extension_number,
          extension_date: ext.extension_date,
          new_deadline: ext.new_deadline,
        })),
      is_auto_deadline: isAutoDeadline,
      auto_confirmed: !!latestCorrection?.auto_confirmed,
      arrival_raw: latestCorrection?.arrival_raw || null,
      last_crawled_at: c.last_crawled_at,
      crawl_status: (() => {
        if (!c.case_number || !isValidCaseNumber) return null;
        if (!c.last_crawled_at) return "pending" as const;
        if ((c.progress_count ?? 0) > 0) return "success" as const;
        return "failed" as const;
      })(),
      has_pending_extension: latestCorrExtensions.some((e) => !e.new_deadline),
      unseen_changes: c.unseen_changes || 0,
    };
  });

  // 기본 정렬: 의뢰인 번호 오름차순, null은 뒤로
  rows.sort((a, b) => {
    const sa = a.seq_number ?? Number.POSITIVE_INFINITY;
    const sb = b.seq_number ?? Number.POSITIVE_INFINITY;
    return sa - sb;
  });

  return rows;
}
