import { useState } from "react";
import { X } from "lucide-react";
import { updateCorrectionDeadline, submitCorrection } from "@/lib/actions/local";
import { formatFullDate } from "@/lib/caseflow/utils/date";

export interface CorrectionPopupData {
  caseId: string;
  correctionId: string | null;
  applicantName: string;
  caseNumber?: string | null;
  documentType?: string | null;
  receivedDate?: string | null;
  servedDate?: string | null;
  deadlineDate?: string | null;
  deadlineStatus?: string | null;
  arrivalRaw?: string | null;
  extensions: { extension_number: number; extension_date: string | null }[];
}

interface Props {
  data: CorrectionPopupData;
  onClose: () => void;
  onSaved?: (update: { type: "deadline"; date: string } | { type: "submit"; date: string }) => void;
}

function fmtDate(d: string | null) {
  if (!d) return "-";
  return formatFullDate(d);
}

export function CorrectionPopup({ data, onClose, onSaved }: Props) {
  const [tab, setTab] = useState<"deadline" | "submit">("deadline");
  const extensions = data.extensions;
  const [manualDeadline, setManualDeadline] = useState("");
  const [daysInput, setDaysInput] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const latestExtDate = extensions.length > 0
    ? [...extensions].sort((a, b) => b.extension_number - a.extension_number)[0]?.extension_date
    : null;
  const today = new Date().toISOString().split("T")[0];
  const baseDate = latestExtDate || data.receivedDate || data.servedDate || today;
  const baseDateLabel = latestExtDate ? "연장신청일" : data.receivedDate ? "수신일" : data.servedDate ? "송달일" : "오늘(수신일 미등록)";
  const isMidnightArrival = data.arrivalRaw?.includes("0시") ?? false;

  function handleDaysChange(days: string) {
    setDaysInput(days);
    if (baseDate && days && parseInt(days) > 0) {
      const d = new Date(baseDate);
      const offset = isMidnightArrival ? parseInt(days) - 1 : parseInt(days);
      d.setDate(d.getDate() + offset);
      setManualDeadline(d.toISOString().split("T")[0]);
    }
  }

  async function handleSaveDate(date: string) {
    if (!data.correctionId || !date) return;
    setSaving(true);
    setError("");
    const res = await updateCorrectionDeadline(data.correctionId, data.caseId, date);
    setSaving(false);
    if (res.error) {
      setError(res.error);
      return;
    }
    onSaved?.({ type: "deadline", date });
    onClose();
  }

  async function handleSubmit() {
    if (!data.correctionId) return;
    setSaving(true);
    setError("");
    const td = new Date().toISOString().split("T")[0];
    const res = await submitCorrection(data.correctionId, data.caseId, td);
    setSaving(false);
    if (res.error) {
      setError(res.error);
      return;
    }
    onSaved?.({ type: "submit", date: td });
    onClose();
  }

  const tabCls = (t: string) =>
    `flex-1 py-2.5 text-xs font-medium border-b-2 transition-colors ${
      tab === t ? "border-blue-600 text-blue-600" : "border-transparent text-gray-500 hover:text-gray-700"
    }`;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-2xl w-[440px] max-h-[85vh] overflow-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200">
          <h3 className="text-sm font-bold text-gray-900">
            {data.applicantName} <span className="font-normal text-gray-400 ml-1">{data.caseNumber || data.documentType}</span>
          </h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="px-5 py-3 bg-gray-50 text-xs space-y-1">
          {data.documentType && (
            <div className="flex justify-between">
              <span className="text-gray-500">송달문서</span>
              <span className="text-gray-800 font-medium">{data.documentType}</span>
            </div>
          )}
          <div className="flex justify-between">
            <span className="text-gray-500">수신일자</span>
            <span className="text-gray-800">{fmtDate(data.receivedDate || data.servedDate || null)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-500">보정기한</span>
            <span className="text-gray-800">{fmtDate(data.deadlineDate || null)}</span>
          </div>
          {extensions.length > 0 && (
            <div className="pt-1 border-t border-gray-200 mt-1">
              {extensions.map((ext) => (
                <div key={ext.extension_number} className="flex justify-between text-orange-600">
                  <span>{ext.extension_number}차 연장</span>
                  <span>{fmtDate(ext.extension_date)}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="flex border-b border-gray-200">
          <button onClick={() => setTab("deadline")} className={tabCls("deadline")}>보정기한 입력</button>
          <button onClick={() => setTab("submit")} className={tabCls("submit")}>보정서 제출</button>
        </div>

        <div className="px-5 py-4 space-y-3">
          {tab === "deadline" && (
            <>
              {baseDate && (
                <div className="space-y-2">
                  <p className="text-[10px] font-semibold text-gray-400 uppercase">{baseDateLabel} 기준</p>
                  <div className="flex gap-2 items-center">
                    <span className="text-sm text-gray-500">+</span>
                    <input
                      type="number"
                      value={daysInput}
                      onChange={(e) => handleDaysChange(e.target.value)}
                      placeholder="일수 입력"
                      className="flex-1 px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/40"
                    />
                    <span className="text-sm text-gray-500">일</span>
                  </div>
                </div>
              )}
              <div className="flex items-center gap-2">
                <div className="flex-1 h-px bg-gray-100" />
                <span className="text-[9px] text-gray-300 uppercase">보정기한</span>
                <div className="flex-1 h-px bg-gray-100" />
              </div>
              <div className="space-y-2">
                <input
                  type="date"
                  value={manualDeadline}
                  onChange={(e) => setManualDeadline(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/40"
                />
                <button
                  disabled={!manualDeadline || saving}
                  onClick={() => handleSaveDate(manualDeadline)}
                  className="w-full py-2.5 text-sm font-semibold bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-40 transition-colors"
                >
                  {saving ? "..." : "저장"}
                </button>
              </div>
            </>
          )}

          {tab === "submit" && (
            <>
              <div className="text-center py-4 space-y-2">
                <p className="text-sm text-gray-600">
                  보정서를 제출하면 보정기한이 <span className="font-bold text-emerald-600">완료</span> 처리됩니다.
                </p>
                <p className="text-lg font-bold text-emerald-600">
                  제출일자 : {fmtDate(new Date().toISOString().split("T")[0])}
                </p>
              </div>
              <button
                onClick={handleSubmit}
                disabled={saving}
                className="w-full py-2.5 bg-emerald-600 hover:bg-emerald-700 disabled:bg-slate-400 text-white text-sm font-semibold rounded-lg transition-colors"
              >
                {saving ? "처리 중..." : "보정서 제출 완료"}
              </button>
            </>
          )}

          {error && <p className="text-xs text-red-500">{error}</p>}
        </div>
      </div>
    </div>
  );
}
