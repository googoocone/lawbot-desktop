import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { CalendarView } from "./CalendarView";
import { loadCalendarEvents, type CalendarEvent } from "@/lib/caseflow/calendar-events";

interface Props {
  onEventClick?: (caseId: string) => void;
  refreshKey?: number;
}

export function CalendarPage({ onEventClick, refreshKey = 0 }: Props) {
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true);
      const data = await loadCalendarEvents();
      if (!alive) return;
      setEvents(data);
      setLoading(false);
    })();
    return () => { alive = false; };
  }, [refreshKey]);

  return (
    <div className="p-6 md:p-8 max-w-[1400px] mx-auto space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-900 flex items-center gap-2">
            <span className="text-2xl">📅</span> 사건 일정 달력
          </h1>
          <p className="text-sm text-gray-400 mt-0.5">
            보정기한 및 채권자집회 일정을 달력으로 확인합니다
          </p>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="w-5 h-5 text-slate-400 animate-spin" />
        </div>
      ) : (
        <CalendarView events={events} onEventClick={onEventClick} />
      )}
    </div>
  );
}
