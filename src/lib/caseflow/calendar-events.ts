// SQLite에서 달력 이벤트 로드
// - 보정 미완료 + 기한 있음
// - 사건의 채권자집회 (creditor_meeting 텍스트에서 날짜 파싱)
import { dbSelect } from "@/lib/db";
import { getCaseScope } from "@/lib/caseflow/visibility";

export interface CalendarEvent {
  id: string;
  case_id: string;
  case_number: string;
  applicant_name: string;
  court_region: string;
  document_type: string;
  deadline_date: string;
  served_date: string | null;
  status: string;
}

interface CorrectionJoined {
  id: string;
  case_id: string;
  document_type: string;
  deadline_date: string;
  served_date: string | null;
  status: string;
  case_number: string | null;
  applicant_name: string;
  court_region: string | null;
}

interface CaseMeetingRecord {
  id: string;
  case_number: string | null;
  applicant_name: string;
  court_region: string | null;
  creditor_meeting: string | null;
}

function parseMeetingDate(text: string): string | null {
  const m = text.match(/(\d{4})[.\-/](\d{1,2})[.\-/](\d{1,2})/);
  if (!m) return null;
  return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
}

export async function loadCalendarEvents(): Promise<CalendarEvent[]> {
  // 가시성: staff는 본인 담당 사건만, 관리자는 전체
  const scope = await getCaseScope();

  const [corrs, meetingCases] = await Promise.all([
    dbSelect<CorrectionJoined>(
      `SELECT cor.id, cor.case_id, cor.document_type,
              cor.deadline_date, cor.served_date, cor.status,
              c.case_number, c.applicant_name, c.court_region
       FROM case_corrections cor
       JOIN cases c ON c.id = cor.case_id
       WHERE cor.status IN ('pending', 'approaching', 'overdue')
         AND cor.deadline_date IS NOT NULL${scope ? " AND c.assigned_to = ?" : ""}`,
      scope ? [scope] : [],
    ),
    dbSelect<CaseMeetingRecord>(
      `SELECT id, case_number, applicant_name, court_region, creditor_meeting
       FROM cases
       WHERE creditor_meeting IS NOT NULL${scope ? " AND assigned_to = ?" : ""}`,
      scope ? [scope] : [],
    ),
  ]);

  const correctionEvents: CalendarEvent[] = corrs.map((c) => ({
    id: c.id,
    case_id: c.case_id,
    case_number: c.case_number || "-",
    applicant_name: c.applicant_name || "-",
    court_region: c.court_region || "",
    document_type: c.document_type,
    deadline_date: c.deadline_date,
    served_date: c.served_date,
    status: c.status,
  }));

  const meetingEvents: CalendarEvent[] = meetingCases
    .map((c): CalendarEvent | null => {
      const date = parseMeetingDate(c.creditor_meeting || "");
      if (!date) return null;
      return {
        id: `meeting-${c.id}`,
        case_id: c.id,
        case_number: c.case_number || "-",
        applicant_name: c.applicant_name || "-",
        court_region: c.court_region || "",
        document_type: "채권자집회",
        deadline_date: date,
        served_date: null,
        status: "meeting",
      };
    })
    .filter((e): e is CalendarEvent => e !== null);

  return [...correctionEvents, ...meetingEvents];
}
