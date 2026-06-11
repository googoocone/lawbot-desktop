import { useCallback, useEffect, useState } from "react";
import { ArrowLeft, Loader2, Trash2, Pencil } from "lucide-react";
import { dbSelect } from "@/lib/db";
import { CaseInfoPanel } from "./CaseInfoPanel";
import { CaseTimeline } from "./CaseTimeline";
import { CaseCorrections } from "./CaseCorrections";
import { deleteCase, resetUnseenChanges } from "@/lib/actions/local";
import type { CaseStatus, CorrectionStatus } from "@/lib/caseflow/types";

interface Props {
  caseId: string;
  onBack: () => void;
  onDeleted: () => void;
  /** 데이터 변경 후 부모(목록) 새로고침 신호 */
  onMutate?: () => void;
  /** 수정 버튼 클릭 시 */
  onEdit?: () => void;
}

interface CaseRecord {
  id: string;
  case_number: string | null;
  case_type: string | null;
  applicant_name: string;
  applicant_spouse: string | null;
  applicant_ssn_enc: string | null;
  applicant_phone_enc: string | null;
  court_region: string | null;
  court_name: string | null;
  counselor_name: string | null;
  staff_name: string | null;
  assigned_to: string | null;
  income_type: string | null;
  fee: number | null;
  doc_received_at: string | null;
  distribution_date: string | null;
  judge_info: string | null;
  judge_phone: string | null;
  creditor_meeting: string | null;
  status: CaseStatus;
  notes: string | null;
  progress_data: string | null;
  commencement_date: string | null;
  approval_date: string | null;
  created_at: string;
}

interface CorrectionRecord {
  id: string;
  case_id: string;
  document_type: string;
  document_category: string;
  served_date: string | null;
  received_date: string | null;
  deadline_date: string | null;
  status: CorrectionStatus;
  overdue_days: number;
  submitted_date: string | null;
  notes_1: string | null;
  notes_2: string | null;
  arrival_raw: string | null;
}

interface ExtensionRecord {
  id: string;
  correction_id: string;
  extension_number: number;
  extension_date: string | null;
  extension_days: number | null;
  new_deadline: string | null;
}

interface ProgressEntry {
  progress_date?: string | null;
  content?: string | null;
  result?: string | null;
  notification?: string | null;
}

export function CaseDetailPage({ caseId, onBack, onDeleted, onMutate, onEdit }: Props) {
  const [loading, setLoading] = useState(true);
  const [caseData, setCaseData] = useState<CaseRecord | null>(null);
  const [corrections, setCorrections] = useState<CorrectionRecord[]>([]);
  const [extensions, setExtensions] = useState<ExtensionRecord[]>([]);
  const [showDelete, setShowDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  const refresh = useCallback(() => {
    setRefreshKey((k) => k + 1);
    onMutate?.();
  }, [onMutate]);

  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true);
      const [c, corrs, exts] = await Promise.all([
        dbSelect<CaseRecord>(
          `SELECT id, case_number, case_type, applicant_name, applicant_spouse,
                  applicant_ssn_enc, applicant_phone_enc, court_region, court_name,
                  counselor_name, staff_name, assigned_to, income_type, fee,
                  doc_received_at, distribution_date, judge_info, judge_phone, creditor_meeting,
                  status, notes, progress_data, commencement_date, approval_date, created_at
           FROM cases WHERE id = ?`,
          [caseId],
        ),
        dbSelect<CorrectionRecord>(
          `SELECT id, case_id, document_type, document_category,
                  served_date, received_date, deadline_date,
                  status, overdue_days, submitted_date,
                  notes_1, notes_2, arrival_raw
           FROM case_corrections WHERE case_id = ?
           ORDER BY served_date DESC`,
          [caseId],
        ),
        dbSelect<ExtensionRecord>(
          `SELECT e.id, e.correction_id, e.extension_number, e.extension_date,
                  e.extension_days, e.new_deadline
           FROM correction_extensions e
           JOIN case_corrections c ON c.id = e.correction_id
           WHERE c.case_id = ?
           ORDER BY e.extension_number ASC`,
          [caseId],
        ),
      ]);
      if (!alive) return;
      setCaseData(c[0] || null);
      setCorrections(corrs);
      setExtensions(exts);
      setLoading(false);

      // unseen_changes 리셋 (한 번만)
      if (c[0]) await resetUnseenChanges(caseId).catch(() => {});
    })();
    return () => { alive = false; };
  }, [caseId, refreshKey]);

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center">
        <Loader2 className="w-5 h-5 text-slate-400 animate-spin" />
      </div>
    );
  }

  if (!caseData) {
    return (
      <div className="p-8 text-center">
        <p className="text-gray-500 mb-4">사건을 찾을 수 없습니다.</p>
        <button onClick={onBack} className="text-blue-600 hover:underline">목록으로</button>
      </div>
    );
  }

  // ProgressData JSON 파싱
  let progressData: ProgressEntry[] = [];
  try {
    progressData = caseData.progress_data ? JSON.parse(caseData.progress_data) : [];
  } catch { /* ignore */ }

  const progressItems = progressData.map((p, i) => ({
    id: String(i),
    progress_date: p.progress_date ?? null,
    content: p.content ?? null,
    result: p.result ?? null,
    notification: p.notification ?? null,
    is_new: false,
  }));

  // 파산선고 날짜 추출
  const declaredDate = progressItems.find((p) =>
    (p.content || "").includes("파산선고결정") && !(p.content || "").includes("송달"),
  )?.progress_date ?? null;

  // 보정 카드용 데이터 가공 (extensions 붙이기)
  const correctionItems = corrections.map((c) => ({
    id: c.id,
    document_type: c.document_type,
    document_category: c.document_category,
    served_date: c.served_date,
    received_date: c.received_date,
    deadline_date: c.deadline_date,
    status: c.status,
    overdue_days: c.overdue_days,
    submitted_date: c.submitted_date,
    notes_1: c.notes_1,
    notes_2: c.notes_2,
    arrival_raw: c.arrival_raw,
    extensions: extensions
      .filter((e) => e.correction_id === c.id)
      .map((e) => ({
        id: e.id,
        extension_number: e.extension_number,
        extension_date: e.extension_date,
        extension_days: e.extension_days,
        new_deadline: e.new_deadline,
      })),
  }));

  const caseInfo = {
    case_number: caseData.case_number,
    case_type: caseData.case_type,
    applicant_name: caseData.applicant_name,
    applicant_spouse: caseData.applicant_spouse,
    applicant_ssn: caseData.applicant_ssn_enc,
    applicant_phone: caseData.applicant_phone_enc,
    court_region: caseData.court_region,
    court_name: caseData.court_name,
    counselor_name: caseData.counselor_name,
    assigned_name: caseData.staff_name,
    income_type: caseData.income_type,
    fee: caseData.fee,
    doc_received_at: caseData.doc_received_at,
    distribution_date: caseData.distribution_date,
    judge_info: caseData.judge_info,
    judge_phone: caseData.judge_phone,
    creditor_meeting: caseData.creditor_meeting,
    status: caseData.status,
    notes: caseData.notes,
    created_at: caseData.created_at,
  };

  async function handleDelete() {
    setDeleting(true);
    const res = await deleteCase(caseId);
    setDeleting(false);
    if (res.error) {
      alert(res.error);
      return;
    }
    setShowDelete(false);
    onDeleted();
  }

  return (
    <div className="p-8 space-y-6 max-w-[1400px] mx-auto">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button onClick={onBack} className="text-gray-400 hover:text-gray-600 transition-colors flex items-center gap-1">
            <ArrowLeft className="w-4 h-4" />
            뒤로
          </button>
          <h1 className="text-2xl font-bold text-gray-900">{caseInfo.applicant_name}</h1>
          {caseInfo.case_number && (
            <span className="text-sm text-gray-400">{caseInfo.case_number}</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {onEdit && (
            <button
              onClick={onEdit}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-blue-600 bg-blue-50 hover:bg-blue-100 rounded-lg transition-colors"
            >
              <Pencil className="w-3.5 h-3.5" />
              수정
            </button>
          )}
          <button
            onClick={() => setShowDelete(true)}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-red-500 bg-red-50 hover:bg-red-100 rounded-lg transition-colors"
          >
            <Trash2 className="w-3.5 h-3.5" />
            삭제
          </button>
        </div>
      </div>

      <div className="flex flex-col lg:flex-row gap-6 justify-center">
        <div className="w-full lg:w-[300px] lg:shrink-0">
          <CaseInfoPanel caseData={caseInfo} />
        </div>
        <div className="w-full lg:w-[800px] lg:shrink-0 space-y-6">
          <CaseCorrections
            corrections={correctionItems}
            applicantName={caseInfo.applicant_name}
            caseId={caseId}
            commencementDate={caseData.commencement_date}
            approvalDate={caseData.approval_date}
            declaredDate={declaredDate}
            onChanged={refresh}
          />
          <CaseTimeline progress={progressItems} />
        </div>
      </div>

      {showDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => !deleting && setShowDelete(false)}>
          <div className="bg-white rounded-xl shadow-2xl w-[360px] overflow-hidden" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-3 px-5 py-4 bg-red-50 border-b border-red-100">
              <span className="text-2xl">🗑️</span>
              <h3 className="text-sm font-bold text-red-800">사건 삭제</h3>
            </div>
            <div className="px-5 py-4 space-y-4">
              <p className="text-sm text-gray-600 leading-relaxed">
                <span className="font-bold text-gray-900">{caseInfo.applicant_name}</span>
                {caseInfo.case_number && (
                  <span className="text-gray-400 ml-1">({caseInfo.case_number})</span>
                )}
                <br />사건을 삭제하시겠습니까? 관련 보정 내역도 함께 삭제됩니다.
              </p>
              <div className="flex gap-2">
                <button
                  onClick={() => setShowDelete(false)}
                  disabled={deleting}
                  className="flex-1 py-2.5 bg-gray-100 hover:bg-gray-200 disabled:opacity-50 text-gray-700 text-sm font-medium rounded-lg transition-colors"
                >
                  취소
                </button>
                <button
                  onClick={handleDelete}
                  disabled={deleting}
                  className="flex-1 py-2.5 bg-red-600 hover:bg-red-700 disabled:bg-red-300 text-white text-sm font-semibold rounded-lg transition-colors"
                >
                  {deleting ? "삭제 중..." : "삭제"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
