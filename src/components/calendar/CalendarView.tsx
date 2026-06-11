import { useState } from "react";
import { formatDate } from "@/lib/caseflow/utils/date";
import type { CalendarEvent } from "@/lib/caseflow/calendar-events";

interface Props {
  events: CalendarEvent[];
  onEventClick?: (caseId: string) => void;
}

function getDaysInMonth(year: number, month: number) {
  return new Date(year, month + 1, 0).getDate();
}

function getFirstDayOfWeek(year: number, month: number) {
  return new Date(year, month, 1).getDay();
}

function isToday(year: number, month: number, day: number) {
  const today = new Date();
  return today.getFullYear() === year && today.getMonth() === month && today.getDate() === day;
}

export function CalendarView({ events, onEventClick }: Props) {
  const today = new Date();
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth());

  const daysInMonth = getDaysInMonth(year, month);
  const firstDay = getFirstDayOfWeek(year, month);
  const dayNames = ["일", "월", "화", "수", "목", "금", "토"];
  const monthNames = ["1월", "2월", "3월", "4월", "5월", "6월", "7월", "8월", "9월", "10월", "11월", "12월"];
  const todayStr = new Date().toISOString().split("T")[0];

  const eventsByDate: Record<string, CalendarEvent[]> = {};
  events.forEach((e) => {
    const key = e.deadline_date;
    if (!eventsByDate[key]) eventsByDate[key] = [];
    eventsByDate[key].push(e);
  });

  const prevMonth = () => {
    if (month === 0) { setYear(year - 1); setMonth(11); }
    else setMonth(month - 1);
  };
  const nextMonth = () => {
    if (month === 11) { setYear(year + 1); setMonth(0); }
    else setMonth(month + 1);
  };
  const goToday = () => { setYear(today.getFullYear()); setMonth(today.getMonth()); };

  const prevMonthDays = getDaysInMonth(
    month === 0 ? year - 1 : year,
    month === 0 ? 11 : month - 1,
  );

  const cells: { day: number; month: number; year: number; isCurrentMonth: boolean }[] = [];
  for (let i = firstDay - 1; i >= 0; i--) {
    const d = prevMonthDays - i;
    const m = month === 0 ? 11 : month - 1;
    const y = month === 0 ? year - 1 : year;
    cells.push({ day: d, month: m, year: y, isCurrentMonth: false });
  }
  for (let d = 1; d <= daysInMonth; d++) {
    cells.push({ day: d, month, year, isCurrentMonth: true });
  }
  let nextD = 1;
  while (cells.length % 7 !== 0) {
    const m = month === 11 ? 0 : month + 1;
    const y = month === 11 ? year + 1 : year;
    cells.push({ day: nextD++, month: m, year: y, isCurrentMonth: false });
  }

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
      <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
        <div className="flex items-center gap-3">
          <button onClick={prevMonth} className="p-1.5 rounded-lg hover:bg-gray-100 transition-colors text-gray-500">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <h2 className="text-lg font-bold text-gray-900 min-w-[120px] text-center">
            {year}년 {monthNames[month]}
          </h2>
          <button onClick={nextMonth} className="p-1.5 rounded-lg hover:bg-gray-100 transition-colors text-gray-500">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </button>
        </div>
        <button onClick={goToday} className="text-xs px-3 py-1.5 bg-gray-100 hover:bg-gray-200 text-gray-600 rounded-lg transition-colors font-medium">
          오늘
        </button>
      </div>

      <div className="grid grid-cols-7 border-b border-gray-100">
        {dayNames.map((name, i) => (
          <div key={name} className={`py-2.5 text-center text-xs font-semibold ${
            i === 0 ? "text-red-400" : i === 6 ? "text-blue-400" : "text-gray-400"
          }`}>
            {name}
          </div>
        ))}
      </div>

      <div className="grid grid-cols-7">
        {cells.map((cell, i) => {
          const dateStr = `${cell.year}-${String(cell.month + 1).padStart(2, "0")}-${String(cell.day).padStart(2, "0")}`;
          const dayEvents = eventsByDate[dateStr] || [];
          const isTodayCell = isToday(cell.year, cell.month, cell.day);
          const dayOfWeek = i % 7;

          return (
            <div
              key={`${cell.year}-${cell.month}-${cell.day}`}
              className={`min-h-[100px] border-b border-r border-gray-50 p-1.5 transition-colors ${
                isTodayCell ? "bg-blue-50/50" : !cell.isCurrentMonth ? "bg-gray-50/40" : ""
              }`}
            >
              <div className="flex items-center justify-between mb-1">
                <span className={`text-xs font-medium w-6 h-6 flex items-center justify-center rounded-full ${
                  isTodayCell
                    ? "bg-blue-600 text-white"
                    : !cell.isCurrentMonth
                      ? "text-gray-300"
                      : dayOfWeek === 0
                        ? "text-red-400"
                        : dayOfWeek === 6
                          ? "text-blue-400"
                          : "text-gray-600"
                }`}>
                  {cell.day === 1 && !cell.isCurrentMonth
                    ? `${cell.month + 1}/${cell.day}`
                    : cell.day}
                </span>
                {dayEvents.length > 0 && (
                  <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full ${
                    cell.isCurrentMonth ? "bg-red-100 text-red-600" : "bg-gray-100 text-gray-400"
                  }`}>
                    {dayEvents.length}
                  </span>
                )}
              </div>

              <div className="space-y-0.5">
                {dayEvents.map((e) => (
                  <div key={e.id} className="group/ev relative">
                    <button
                      onClick={() => onEventClick?.(e.case_id)}
                      className={`block w-full text-left text-[10px] leading-tight px-1.5 py-1 rounded truncate transition-colors border ${
                        !cell.isCurrentMonth
                          ? "bg-gray-50 text-gray-500 hover:bg-gray-100 border-gray-100"
                          : e.status === "meeting"
                            ? "bg-purple-50 text-purple-700 hover:bg-purple-100 border-purple-100"
                            : e.deadline_date < todayStr
                              ? "bg-gray-100 text-gray-400 hover:bg-gray-200 border-gray-200"
                              : e.deadline_date === todayStr
                                ? "bg-red-50 text-red-700 hover:bg-red-100 border-red-100"
                                : "bg-orange-50 text-orange-700 hover:bg-orange-100 border-orange-100"
                      }`}
                    >
                      <span className="font-semibold">{e.applicant_name}</span>
                      <span className="text-gray-400 ml-0.5">{e.document_type}</span>
                      {e.served_date && <span className="text-gray-400 ml-0.5">({formatDate(e.served_date)})</span>}
                    </button>
                    <div className="absolute left-1/2 -translate-x-1/2 bottom-full mb-1.5 z-30 pointer-events-none opacity-0 group-hover/ev:opacity-100 transition-opacity duration-100">
                      <div className="bg-gray-900 text-white text-[10px] px-2.5 py-1.5 rounded-lg shadow-lg whitespace-nowrap">
                        <span className="font-semibold">{e.applicant_name}</span>
                        <span className="text-gray-300 ml-1">{e.document_type}</span>
                        {e.served_date && <span className="text-gray-400 ml-1">({formatDate(e.served_date)})</span>}
                      </div>
                      <div className="absolute left-1/2 -translate-x-1/2 top-full w-0 h-0 border-x-4 border-x-transparent border-t-4 border-t-gray-900" />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
