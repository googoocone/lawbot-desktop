import { useState } from "react";
import { Badge } from "@/components/ui/Badge";
import { formatFullDate } from "@/lib/caseflow/utils/date";
import { getCorrectionDisplay } from "@/lib/caseflow/utils/correction";
import { createExtension, submitCorrection } from "@/lib/actions/local";
import { CorrectionPopup } from "./CorrectionPopup";
import type { CorrectionStatus } from "@/lib/caseflow/types";

// flow의 display 라벨/색상 (case-corrections.tsx 상단 함수와 동일)
function getDisplayLabel(status: CorrectionStatus, receivedDate: string | null): string {
  if (status === "submitted") return "제출완료";
  if (status === "dismissed") return "기각";
  if (status === "overdue") return "시간도과";
  return receivedDate ? "열람" : "미처리";
}

function getDisplayColor(status: CorrectionStatus, receivedDate: string | null): string {
  if (status === "submitted") return "bg-green-100 text-green-700";
  if (status === "dismissed") return "bg-orange-100 text-orange-700";
  if (status === "overdue") return "bg-red-100 text-red-700";
  if (receivedDate) return "bg-blue-100 text-blue-700";
  return "bg-red-100 text-red-700";
}

// 미사용 헬퍼 — 추후 보정 추가 모달에서 사용 예정
void getCorrectionDisplay;

interface CorrectionItem {
  id: string;
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
  extensions: {
    id: string;
    extension_number: number;
    extension_date: string | null;
    extension_days: number | null;
    new_deadline: string | null;
  }[];
}

interface CaseCorrectionsProps {
  corrections: CorrectionItem[];
  applicantName: string;
  caseId: string;
  commencementDate?: string | null;
  approvalDate?: string | null;
  declaredDate?: string | null;
  onChanged?: () => void;
}

// ── 보정서 제출 인라인 버튼 ──
function SubmitCorrectionButton({
  correctionId, caseId, retroactive, onDone,
}: {
  correctionId: string;
  caseId: string;
  retroactive: boolean;
  onDone: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [busy, setBusy] = useState(false);

  const handleSubmit = async () => {
    if (!date) return;
    setBusy(true);
    const res = await submitCorrection(correctionId, caseId, date);
    setBusy(false);
    if (res.error) return;
    setOpen(false);
    onDone();
  };

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className={`inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-full shadow-sm transition-all active:scale-95 ${
          retroactive
            ? "bg-white text-gray-500 border border-gray-300 hover:bg-gray-50 hover:shadow"
            : "bg-green-500 hover:bg-green-600 text-white shadow-green-200 hover:shadow-md"
        }`}
      >
        {retroactive ? (
          <>
            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            소급 처리
          </>
        ) : (
          <>
            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
            </svg>
            보정서 제출
          </>
        )}
      </button>
    );
  }

  return (
    <span className="inline-flex items-center gap-2 bg-gray-50 border border-gray-200 rounded-lg px-3 py-1.5">
      <span className="text-xs text-gray-500 whitespace-nowrap">제출일</span>
      <input
        type="date"
        value={date}
        onChange={(e) => setDate(e.target.value)}
        className="text-xs border border-gray-300 rounded-md px-2 py-1 bg-white text-gray-900 focus:outline-none focus:ring-2 focus:ring-green-400"
        disabled={busy}
      />
      <button
        onClick={handleSubmit}
        disabled={busy || !date}
        className="text-xs px-3 py-1 bg-green-500 hover:bg-green-600 text-white font-semibold rounded-md disabled:opacity-40 transition-colors shadow-sm"
      >
        {busy ? "처리중…" : "확인"}
      </button>
      <button
        onClick={() => setOpen(false)}
        disabled={busy}
        className="text-xs px-2 py-1 text-gray-400 hover:text-gray-600 transition-colors"
      >
        취소
      </button>
    </span>
  );
}

// ── 기간연장 인라인 버튼 ──
function ExtendDeadlineButton({
  correctionId, caseId, onDone,
}: {
  correctionId: string;
  caseId: string;
  onDone: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [extensionDate, setExtensionDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [busy, setBusy] = useState(false);

  const handleExtend = async () => {
    if (!extensionDate) return;
    setBusy(true);
    const res = await createExtension({
      correction_id: correctionId,
      case_id: caseId,
      extension_date: extensionDate,
      extension_days: 0,
      new_deadline: "",
    });
    setBusy(false);
    if (res.error) return;
    setOpen(false);
    onDone();
  };

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-full shadow-sm transition-all active:scale-95 bg-amber-50 text-amber-700 border border-amber-200 hover:bg-amber-100 hover:shadow"
      >
        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
        </svg>
        기간연장
      </button>
    );
  }

  return (
    <span className="inline-flex items-center gap-2 flex-wrap bg-amber-50 border border-amber-200 rounded-lg px-3 py-1.5">
      <span className="text-xs text-amber-700 font-medium whitespace-nowrap">기간연장 신청</span>
      <span className="text-xs text-gray-500 whitespace-nowrap">신청일</span>
      <input
        type="date"
        value={extensionDate}
        onChange={(e) => setExtensionDate(e.target.value)}
        className="text-xs border border-gray-300 rounded-md px-2 py-1 bg-white text-gray-900 focus:outline-none focus:ring-2 focus:ring-amber-400"
        disabled={busy}
      />
      <button
        onClick={handleExtend}
        disabled={busy || !extensionDate}
        className="text-xs px-3 py-1 bg-amber-500 hover:bg-amber-600 text-white font-semibold rounded-md disabled:opacity-40 transition-colors shadow-sm"
      >
        {busy ? "처리중…" : "확인"}
      </button>
      <button
        onClick={() => setOpen(false)}
        disabled={busy}
        className="text-xs px-2 py-1 text-gray-400 hover:text-gray-600 transition-colors"
      >
        취소
      </button>
    </span>
  );
}

// ── 보정 입력 (CorrectionPopup 트리거) ──
function CorrectionInputButton({
  correction, caseId, applicantName, onDone,
}: {
  correction: CorrectionItem;
  caseId: string;
  applicantName: string;
  onDone: () => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        id={`correction-input-${correction.id}`}
        onClick={() => setOpen(true)}
        className="w-full py-3 bg-gradient-to-r from-violet-500 to-pink-500 hover:from-violet-600 hover:to-pink-600 text-white text-sm font-bold rounded-xl transition-all duration-200 flex items-center justify-center gap-2 shadow-md hover:shadow-lg hover:-translate-y-0.5 active:scale-[0.98]"
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
        </svg>
        기한 입력하기
      </button>
      {open && (
        <CorrectionPopup
          data={{
            caseId,
            correctionId: correction.id,
            applicantName,
            documentType: correction.document_type,
            receivedDate: correction.received_date,
            servedDate: correction.served_date,
            deadlineDate: correction.deadline_date,
            arrivalRaw: correction.arrival_raw,
            extensions: correction.extensions.map((e) => ({
              extension_number: e.extension_number,
              extension_date: e.extension_date,
            })),
          }}
          onClose={() => setOpen(false)}
          onSaved={() => {
            setOpen(false);
            onDone();
          }}
        />
      )}
    </>
  );
}

// ── 메인 컴포넌트 ──
export function CaseCorrections({
  corrections, applicantName, caseId,
  commencementDate, approvalDate, declaredDate,
  onChanged,
}: CaseCorrectionsProps) {
  const correctionItems = corrections.filter((c) => c.document_category === "correction");

  type MilestoneItem = { type: "commencement" | "approval" | "declared"; date: string };
  const milestones: MilestoneItem[] = [];
  if (commencementDate) milestones.push({ type: "commencement", date: commencementDate });
  if (approvalDate) milestones.push({ type: "approval", date: approvalDate });
  if (declaredDate) milestones.push({ type: "declared", date: declaredDate });

  const correctionDate = (c: CorrectionItem) => c.served_date ?? c.received_date ?? "";

  type ListItem = { kind: "milestone"; data: MilestoneItem } | { kind: "correction"; data: CorrectionItem };
  const allItems: ListItem[] = [
    ...milestones.map((m) => ({ kind: "milestone" as const, data: m })),
    ...correctionItems.map((c) => ({ kind: "correction" as const, data: c })),
  ].sort((a, b) => {
    const dateA = a.kind === "milestone" ? a.data.date : correctionDate(a.data);
    const dateB = b.kind === "milestone" ? b.data.date : correctionDate(b.data);
    return dateB.localeCompare(dateA);
  });

  const totalCount = allItems.length;
  const refresh = () => onChanged?.();

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold text-gray-900">
          사건현황 {totalCount > 0 && `(${totalCount})`}
        </h2>
      </div>

      {totalCount === 0 ? (
        <p className="text-sm text-gray-500 text-center py-4">등록된 사건현황이 없습니다.</p>
      ) : (
        <div className="space-y-4">
          {allItems.map((item) => {
            if (item.kind === "milestone") {
              const m = item.data;
              const isApproval = m.type === "approval";
              const isDeclared = m.type === "declared";
              const milestoneColor = isDeclared
                ? "border-amber-200 bg-amber-50/30"
                : isApproval
                  ? "border-purple-200 bg-purple-50/30"
                  : "border-blue-200 bg-blue-50/30";
              return (
                <div key={`milestone-${m.type}`} className={`border rounded-lg p-4 space-y-3 ${milestoneColor}`}>
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className={`font-medium ${
                      isDeclared ? "text-amber-900" : isApproval ? "text-purple-900" : "text-blue-900"
                    }`}>
                      {isDeclared ? "파산선고결정" : isApproval ? "변제계획인가결정" : "개인회생절차개시결정"}
                    </span>
                    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold ${
                      isDeclared
                        ? "bg-amber-100 text-amber-700"
                        : isApproval
                          ? "bg-purple-100 text-purple-700"
                          : "bg-blue-100 text-blue-700"
                    }`}>
                      {isDeclared ? "파산선고" : isApproval ? "인가결정" : "개시결정"}
                    </span>
                  </div>
                  <div className="text-sm">
                    <span className="text-gray-500">결정일:</span>{" "}
                    <span className="text-gray-700">{formatFullDate(m.date)}</span>
                  </div>
                </div>
              );
            }

            const c = item.data;
            const isOverdue = c.status === "overdue";
            const isSubmitted = c.status === "submitted";
            const displayLabel = getDisplayLabel(c.status, c.received_date);
            const displayColor = getDisplayColor(c.status, c.received_date);

            return (
              <div key={c.id} className="border border-gray-200 rounded-lg p-4 space-y-3">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-medium text-gray-900">{c.document_type}</span>
                  <Badge label={displayLabel} colorClass={displayColor} />
                  {isOverdue && c.overdue_days > 0 && (
                    <span className="text-xs text-red-500">{c.overdue_days}일 경과</span>
                  )}
                </div>

                <div className="grid grid-cols-2 gap-2 text-sm">
                  <div>
                    <span className="text-gray-500">{c.received_date ? "도달일:" : "송달일:"}</span>{" "}
                    <span className="text-gray-700">
                      {c.received_date
                        ? formatFullDate(c.received_date)
                        : c.served_date ? formatFullDate(c.served_date) : "-"}
                    </span>
                  </div>
                  <div className="flex items-center gap-1 flex-wrap">
                    <span className="text-gray-500">기한:</span>{" "}
                    {(() => {
                      if (isSubmitted) {
                        return (
                          <span className="text-emerald-600 font-semibold">
                            {c.deadline_date ? formatFullDate(c.deadline_date) : "-"}
                          </span>
                        );
                      }
                      let isUrgent = false;
                      if (c.deadline_date) {
                        const today = new Date(); today.setHours(0, 0, 0, 0);
                        const dl = new Date(c.deadline_date); dl.setHours(0, 0, 0, 0);
                        isUrgent = dl.getTime() <= today.getTime();
                      }
                      return (
                        <span className={`inline-flex items-center gap-1 font-semibold ${isUrgent ? "text-red-600" : "text-gray-700"}`}>
                          {isUrgent && (
                            <span className="relative flex h-2 w-2 shrink-0">
                              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75" />
                              <span className="relative inline-flex rounded-full h-2 w-2 bg-red-500" />
                            </span>
                          )}
                          {c.deadline_date ? formatFullDate(c.deadline_date) : "-"}
                          {!c.deadline_date && (
                            <span
                              className="text-amber-500 cursor-pointer hover:text-amber-600"
                              onClick={() => document.getElementById(`correction-input-${c.id}`)?.click()}
                            >⚠</span>
                          )}
                        </span>
                      );
                    })()}
                  </div>
                </div>

                {c.extensions.length > 0 && (
                  <div className="text-xs space-y-1 mt-1">
                    {c.extensions.map((ext) => (
                      <div key={ext.id} className="flex items-center gap-2 text-gray-500">
                        <span className="text-amber-600 font-medium">{ext.extension_number}차 연장</span>
                        {ext.extension_date && <span>신청 {formatFullDate(ext.extension_date)}</span>}
                      </div>
                    ))}
                  </div>
                )}

                {c.submitted_date && (
                  <div className="text-sm">
                    <span className="text-gray-500">제출일:</span>{" "}
                    <span className="text-emerald-600 font-semibold">{formatFullDate(c.submitted_date)}</span>
                  </div>
                )}

                {/* 액션 버튼들 */}
                <div className="flex flex-wrap gap-2 pt-1">
                  {!isSubmitted && (
                    <SubmitCorrectionButton
                      correctionId={c.id}
                      caseId={caseId}
                      retroactive={false}
                      onDone={refresh}
                    />
                  )}
                  {!isSubmitted && (
                    <ExtendDeadlineButton
                      correctionId={c.id}
                      caseId={caseId}
                      onDone={refresh}
                    />
                  )}
                  {isSubmitted && c.deadline_date && (
                    <SubmitCorrectionButton
                      correctionId={c.id}
                      caseId={caseId}
                      retroactive={true}
                      onDone={refresh}
                    />
                  )}
                </div>

                {/* 입력 버튼 (기한 미정 / 기한 변경) */}
                {!isSubmitted && (
                  <CorrectionInputButton
                    correction={c}
                    caseId={caseId}
                    applicantName={applicantName}
                    onDone={refresh}
                  />
                )}

                {(c.notes_1 || c.notes_2) && (
                  <div className="text-xs text-gray-600">
                    {c.notes_1 && <p>메모1: {c.notes_1}</p>}
                    {c.notes_2 && <p>메모2: {c.notes_2}</p>}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
