import { useEffect, useState } from "react";
import { ArrowLeft, Loader2, User, FileText, Calendar, Settings } from "lucide-react";
import { dbSelect } from "@/lib/db";
import { updateCase, getFirmMembers } from "@/lib/actions/local";
import { COURT_REGIONS, COURT_MAPPING } from "@/lib/caseflow/constants/court-mapping";
import { CASE_TYPES, CASE_STATUS_LABELS } from "@/lib/caseflow/constants/status";
import type { CaseStatus } from "@/lib/caseflow/types";

interface Props {
  caseId: string;
  onBack: () => void;
  onSaved: () => void;
}

interface CaseRecord {
  case_number: string | null;
  case_type: string | null;
  applicant_name: string;
  applicant_spouse: string | null;
  applicant_ssn_enc: string | null;
  applicant_phone_enc: string | null;
  court_region: string | null;
  counselor_name: string | null;
  assigned_to: string | null;
  income_type: string | null;
  fee: number | null;
  doc_received_at: string | null;
  distribution_date: string | null;
  judge_info: string | null;
  creditor_meeting: string | null;
  status: CaseStatus;
  case_progress: string | null;
  notes: string | null;
}

interface FormData {
  case_number: string;
  case_type: string;
  applicant_name: string;
  applicant_spouse: string;
  applicant_ssn: string;
  applicant_phone: string;
  court_region: string;
  counselor_name: string;
  assigned_to: string;
  income_type: string;
  fee: string;
  doc_received_at: string;
  distribution_date: string;
  judge_info: string;
  creditor_meeting: string;
  status: string;
  case_progress: string;
  notes: string;
}

const progressOptions = [
  { value: "active", label: "진행", color: "bg-blue-50 text-blue-700" },
  { value: "hold", label: "보류", color: "bg-yellow-50 text-yellow-700" },
  { value: "cancelled", label: "취소반환", color: "bg-red-50 text-red-600" },
];

const STATUS_OPTIONS: CaseStatus[] = [
  "pending", "filed", "commenced", "approved",
  "discharged", "dismissed", "cancelled", "withdrawn",
];

export function CaseEditPage({ caseId, onBack, onSaved }: Props) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [form, setForm] = useState<FormData | null>(null);
  const [staffList, setStaffList] = useState<{ id: string; name: string | null }[]>([]);

  useEffect(() => {
    let alive = true;
    (async () => {
      const [rows, members] = await Promise.all([
        dbSelect<CaseRecord>(
          `SELECT case_number, case_type, applicant_name, applicant_spouse,
                  applicant_ssn_enc, applicant_phone_enc, court_region,
                  counselor_name, assigned_to, income_type, fee,
                  doc_received_at, distribution_date, judge_info, creditor_meeting,
                  status, case_progress, notes
           FROM cases WHERE id = ?`,
          [caseId],
        ),
        getFirmMembers().catch(() => ({ data: [] as any[], canDistribute: false })),
      ]);
      if (!alive) return;
      const c = rows[0];
      if (!c) { setError("사건을 찾을 수 없습니다."); setLoading(false); return; }
      setForm({
        case_number: c.case_number ?? "",
        case_type: c.case_type ?? "",
        applicant_name: c.applicant_name,
        applicant_spouse: c.applicant_spouse ?? "",
        applicant_ssn: c.applicant_ssn_enc ?? "",
        applicant_phone: c.applicant_phone_enc ?? "",
        court_region: c.court_region ?? "",
        counselor_name: c.counselor_name ?? "",
        assigned_to: c.assigned_to ?? "",
        income_type: c.income_type ?? "",
        fee: c.fee !== null ? String(c.fee) : "",
        doc_received_at: c.doc_received_at ?? "",
        distribution_date: c.distribution_date ?? "",
        judge_info: c.judge_info ?? "",
        creditor_meeting: c.creditor_meeting ?? "",
        status: c.status ?? "pending",
        case_progress: c.case_progress ?? "active",
        notes: c.notes ?? "",
      });
      setStaffList(members.data);
      setLoading(false);
    })();
    return () => { alive = false; };
  }, [caseId]);

  function handleChange(
    e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>,
  ) {
    setForm((prev) => prev ? { ...prev, [e.target.name]: e.target.value } : prev);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form) return;
    if (!form.applicant_name.trim()) {
      setError("신청인명은 필수입니다.");
      return;
    }
    setError("");
    setSaving(true);

    const courtName = form.court_region
      ? COURT_MAPPING[form.court_region] || form.court_region
      : null;
    const feeNum = form.fee.trim() ? parseFloat(form.fee.replace(/,/g, "")) : null;

    const updates: Record<string, unknown> = {
      case_number: form.case_number || null,
      case_type: form.case_type || null,
      applicant_name: form.applicant_name.trim(),
      applicant_spouse: form.applicant_spouse || null,
      applicant_ssn_enc: form.applicant_ssn || null,
      applicant_phone_enc: form.applicant_phone || null,
      court_region: form.court_region || null,
      court_name: courtName,
      counselor_name: form.counselor_name || null,
      assigned_to: form.assigned_to || null,
      income_type: form.income_type || null,
      fee: feeNum !== null && !isNaN(feeNum) ? feeNum : null,
      doc_received_at: form.doc_received_at || null,
      distribution_date: form.distribution_date || null,
      judge_info: form.judge_info || null,
      creditor_meeting: form.creditor_meeting || null,
      status: form.status,
      case_progress: form.case_progress,
      notes: form.notes || null,
    };

    const res = await updateCase(caseId, updates);
    setSaving(false);
    if (res.error) { setError(res.error); return; }
    onSaved();
  }

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center">
        <Loader2 className="w-5 h-5 text-slate-400 animate-spin" />
      </div>
    );
  }

  if (!form) {
    return (
      <div className="p-8 text-center">
        <p className="text-gray-500 mb-4">{error || "사건을 찾을 수 없습니다."}</p>
        <button onClick={onBack} className="text-blue-600 hover:underline">뒤로</button>
      </div>
    );
  }

  const inputCls =
    "w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500/40 focus:border-blue-400 transition-colors";
  const labelCls = "block text-xs font-semibold text-gray-500 mb-1.5";

  const currentProgress = progressOptions.find((s) => s.value === form.case_progress);

  return (
    <div className="p-6 md:p-8 max-w-[900px] mx-auto space-y-5">
      <div className="flex items-center gap-3">
        <button
          onClick={onBack}
          className="text-gray-400 hover:text-gray-600 transition-colors text-sm inline-flex items-center gap-1"
        >
          <ArrowLeft className="w-4 h-4" />
          뒤로
        </button>
        <div>
          <h1 className="text-xl font-bold text-gray-900">사건 수정</h1>
          <p className="text-sm text-gray-400 mt-0.5">
            {form.applicant_name}
            {form.case_number && <span className="ml-1.5">({form.case_number})</span>}
          </p>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="space-y-5">
        {error && (
          <div className="flex items-center gap-2 bg-red-50 border border-red-200 text-red-600 px-4 py-3 rounded-xl text-sm">
            <span>⚠</span> {error}
          </div>
        )}

        {/* 진행 상태 */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-bold text-gray-900 flex items-center gap-2">
              <span className="w-5 h-5 rounded-md bg-gray-100 flex items-center justify-center">
                <Settings className="w-3 h-3 text-gray-500" />
              </span>
              진행 상태
            </h2>
            {currentProgress && (
              <span className={`px-2.5 py-1 rounded-full text-[11px] font-semibold ${currentProgress.color}`}>
                {currentProgress.label}
              </span>
            )}
          </div>
          <div className="flex flex-wrap gap-1.5">
            {progressOptions.map((s) => (
              <button
                key={s.value}
                type="button"
                onClick={() => setForm((prev) => prev && { ...prev, case_progress: s.value })}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                  form.case_progress === s.value
                    ? "bg-blue-600 text-white shadow-sm"
                    : "bg-gray-50 text-gray-500 hover:bg-gray-100 hover:text-gray-700"
                }`}
              >
                {s.label}
              </button>
            ))}
          </div>
        </div>

        {/* 신청인 정보 */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5">
          <h2 className="text-sm font-bold text-gray-900 mb-4 flex items-center gap-2">
            <span className="w-5 h-5 rounded-md bg-blue-50 flex items-center justify-center">
              <User className="w-3 h-3 text-blue-500" />
            </span>
            신청인 정보
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-x-4 gap-y-3">
            <div>
              <label className={labelCls}>신청인명 <span className="text-red-400">*</span></label>
              <input name="applicant_name" value={form.applicant_name} onChange={handleChange} required className={inputCls} placeholder="홍길동" />
            </div>
            <div>
              <label className={labelCls}>배우자</label>
              <input name="applicant_spouse" value={form.applicant_spouse} onChange={handleChange} className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>주민번호</label>
              <input name="applicant_ssn" value={form.applicant_ssn} onChange={handleChange} className={inputCls} placeholder="000000-0000000" />
            </div>
            <div>
              <label className={labelCls}>연락처</label>
              <input name="applicant_phone" value={form.applicant_phone} onChange={handleChange} className={inputCls} placeholder="010-0000-0000" />
            </div>
          </div>
        </div>

        {/* 사건 정보 */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5">
          <h2 className="text-sm font-bold text-gray-900 mb-4 flex items-center gap-2">
            <span className="w-5 h-5 rounded-md bg-indigo-50 flex items-center justify-center">
              <FileText className="w-3 h-3 text-indigo-500" />
            </span>
            사건 정보
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-x-4 gap-y-3">
            <div>
              <label className={labelCls}>사건번호</label>
              <input name="case_number" value={form.case_number} onChange={handleChange} className={inputCls} placeholder="2024회단1234" />
            </div>
            <div>
              <label className={labelCls}>사건유형</label>
              <select name="case_type" value={form.case_type} onChange={handleChange} className={inputCls}>
                <option value="">선택</option>
                {CASE_TYPES.map((t) => (
                  <option key={t.value} value={t.value}>{t.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelCls}>법원 지역</label>
              <select name="court_region" value={form.court_region} onChange={handleChange} className={inputCls}>
                <option value="">선택</option>
                {COURT_REGIONS.map((r) => (
                  <option key={r} value={r}>{r}</option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelCls}>단계 (status)</label>
              <select name="status" value={form.status} onChange={handleChange} className={inputCls}>
                {STATUS_OPTIONS.map((s) => (
                  <option key={s} value={s}>{CASE_STATUS_LABELS[s as CaseStatus] || s}</option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelCls}>재판부/위원</label>
              <input name="judge_info" value={form.judge_info} onChange={handleChange} className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>채권자집회</label>
              <input name="creditor_meeting" value={form.creditor_meeting} onChange={handleChange} className={inputCls} />
            </div>
          </div>
        </div>

        {/* 관리 정보 */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5">
          <h2 className="text-sm font-bold text-gray-900 mb-4 flex items-center gap-2">
            <span className="w-5 h-5 rounded-md bg-emerald-50 flex items-center justify-center">
              <Calendar className="w-3 h-3 text-emerald-500" />
            </span>
            관리 정보
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-x-4 gap-y-3">
            <div>
              <label className={labelCls}>상담사</label>
              <input name="counselor_name" value={form.counselor_name} onChange={handleChange} className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>담당자</label>
              {staffList.length > 0 ? (
                <select name="assigned_to" value={form.assigned_to} onChange={handleChange} className={inputCls}>
                  <option value="">미지정</option>
                  {staffList.map((s) => (
                    <option key={s.id} value={s.id}>{s.name}</option>
                  ))}
                </select>
              ) : (
                <input
                  value={form.assigned_to}
                  disabled
                  className={`${inputCls} bg-gray-50 text-gray-400`}
                  placeholder="권한 없음"
                />
              )}
            </div>
            <div>
              <label className={labelCls}>소득구분</label>
              <input name="income_type" value={form.income_type} onChange={handleChange} className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>수임료 (만원)</label>
              <input name="fee" value={form.fee} onChange={handleChange} className={inputCls} placeholder="0" />
            </div>
            <div>
              <label className={labelCls}>서류수신일</label>
              <input name="doc_received_at" type="date" value={form.doc_received_at} onChange={handleChange} className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>배당일</label>
              <input name="distribution_date" type="date" value={form.distribution_date} onChange={handleChange} className={inputCls} />
            </div>
            <div className="md:col-span-2">
              <label className={labelCls}>메모</label>
              <textarea name="notes" value={form.notes} onChange={handleChange} rows={3} className={`${inputCls} resize-none`} />
            </div>
          </div>
        </div>

        {/* 하단 버튼 */}
        <div className="flex justify-end gap-2 pt-1">
          <button
            type="button"
            onClick={onBack}
            className="px-5 py-2.5 text-sm text-gray-500 hover:text-gray-700 hover:bg-gray-50 rounded-lg transition-colors"
          >
            취소
          </button>
          <button
            type="submit"
            disabled={saving}
            className="px-6 py-2.5 text-sm bg-blue-600 text-white font-semibold rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors inline-flex items-center gap-1.5"
          >
            {saving && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            {saving ? "저장 중..." : "수정 저장"}
          </button>
        </div>
      </form>
    </div>
  );
}
