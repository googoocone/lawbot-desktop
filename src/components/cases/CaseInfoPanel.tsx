import { Badge } from "@/components/ui/Badge";
import { CASE_STATUS_LABELS, CASE_STATUS_COLORS } from "@/lib/caseflow/constants/status";
import { formatFullDate } from "@/lib/caseflow/utils/date";
import type { CaseStatus } from "@/lib/caseflow/types";

interface CaseInfoPanelProps {
  caseData: {
    case_number: string | null;
    case_type: string | null;
    applicant_name: string;
    applicant_spouse: string | null;
    applicant_ssn: string | null;
    applicant_phone: string | null;
    court_region: string | null;
    court_name: string | null;
    counselor_name: string | null;
    assigned_name: string | null;
    income_type: string | null;
    fee: number | null;
    doc_received_at: string | null;
    distribution_date: string | null;
    judge_info: string | null;
    judge_phone: string | null;
    creditor_meeting: string | null;
    status: CaseStatus;
    notes: string | null;
    created_at: string;
  };
}

function InfoRow({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div className="flex justify-between py-2 border-b border-gray-50">
      <span className="text-sm text-gray-500">{label}</span>
      <span className="text-sm text-gray-900 font-medium">{value || "-"}</span>
    </div>
  );
}

export function CaseInfoPanel({ caseData }: CaseInfoPanelProps) {
  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold text-gray-900">기본 정보</h2>
        <Badge
          label={CASE_STATUS_LABELS[caseData.status] || caseData.status}
          colorClass={CASE_STATUS_COLORS[caseData.status]}
        />
      </div>

      <div className="space-y-0">
        <InfoRow label="사건번호" value={caseData.case_number} />
        <InfoRow label="사건유형" value={caseData.case_type} />
        <InfoRow label="신청인" value={caseData.applicant_name} />
        <InfoRow label="배우자" value={caseData.applicant_spouse} />
        <InfoRow label="주민번호" value={caseData.applicant_ssn} />
        <InfoRow label="연락처" value={caseData.applicant_phone} />
        <InfoRow label="법원" value={caseData.court_name || caseData.court_region} />
        <InfoRow label="재판부" value={caseData.judge_info} />
        <InfoRow label="재판부 전화" value={caseData.judge_phone} />
        <InfoRow label="상담자" value={caseData.counselor_name} />
        <InfoRow label="담당자" value={caseData.assigned_name} />
        <InfoRow label="소득구분" value={caseData.income_type} />
        <InfoRow
          label="수임료"
          value={caseData.fee ? `${caseData.fee.toLocaleString()}만원` : null}
        />
        <InfoRow
          label="서류수신일"
          value={caseData.doc_received_at ? formatFullDate(caseData.doc_received_at) : null}
        />
        <InfoRow
          label="배당일"
          value={caseData.distribution_date ? formatFullDate(caseData.distribution_date) : null}
        />
        <InfoRow label="채권자집회" value={caseData.creditor_meeting} />
        <InfoRow label="등록일" value={formatFullDate(caseData.created_at)} />
        {caseData.notes && (
          <div className="pt-3">
            <p className="text-sm text-gray-500 mb-1">메모</p>
            <p className="text-sm text-gray-700 bg-gray-50 p-3 rounded-lg whitespace-pre-wrap">
              {caseData.notes}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
