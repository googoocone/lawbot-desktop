import { useState, useMemo } from "react";
import { CaseScheduleTable, STAGE_OPTIONS } from "./CaseScheduleTable";
import { listUiCache } from "./list-ui-cache";
import type { CaseRow } from "@/lib/caseflow/case-row";

interface Props {
  allCases: CaseRow[];
  userName: string;
  onRowClick?: (caseId: string) => void;
  onPopupOpen?: (row: CaseRow) => void;
  onCasesDeleted?: () => void;
}

// 상단 카드 = 조치가 필요한 작업함. 단계별 분류는 아래 칩(= 테이블 단계 필터)으로.
type WorkKey = "" | "urgent" | "extension" | "nocrawl";
type SortMode = "seq" | "deadline";

function isUrgentCase(c: CaseRow): boolean {
  if (c.has_pending_extension) return false;
  if (c.deadline_status === "overdue") return true;
  if (c.deadline_status === "pending" && c.extensions.length > 0) return false;
  return c.deadline_status === "pending";
}

export function CaseScheduleDashboard({ allCases, userName, onRowClick, onPopupOpen, onCasesDeleted }: Props) {
  // 상세 들어갔다 나와도 유지되도록 캐시에서 초기화 + 변경 시 기록
  const [work, _setWork] = useState<WorkKey>(listUiCache.work);
  const [sortMode, _setSortMode] = useState<SortMode>(listUiCache.sortMode);
  const [stageFilter, _setStageFilter] = useState<string>(listUiCache.stageFilter);
  const [deadlineStatusFilter, _setDeadlineStatusFilter] = useState<string>(listUiCache.deadlineStatusFilter);

  const setWork = (w: WorkKey) => { listUiCache.work = w; _setWork(w); };
  const setSortMode = (m: SortMode) => { listUiCache.sortMode = m; _setSortMode(m); };
  const setStageFilter = (v: string) => { listUiCache.stageFilter = v; _setStageFilter(v); };
  const setDeadlineStatusFilter = (v: string) => { listUiCache.deadlineStatusFilter = v; _setDeadlineStatusFilter(v); };

  // 미처리/연장신청 카드와 테이블의 보정기한 드롭다운은 같은 축의 필터라 동시 적용하면 빈 목록이 됨 → 서로 해제
  const selectWork = (w: WorkKey) => {
    setWork(w);
    if (w === "urgent" || w === "extension") setDeadlineStatusFilter("");
  };
  const handleDeadlineFilterChange = (v: string) => {
    setDeadlineStatusFilter(v);
    if (v && (work === "urgent" || work === "extension")) setWork("");
  };

  const stats = useMemo(() => {
    const urgentCases = allCases.filter(isUrgentCase);
    const extensionCases = allCases.filter((c) => c.has_pending_extension || c.extensions.length > 0);
    const nocrawlCases = allCases.filter((c) => !c.last_crawled_at);
    return {
      total: allCases.length,
      urgent: urgentCases.length,
      extension: extensionCases.length,
      nocrawl: nocrawlCases.length,
      newUrgent: urgentCases.filter((c) => c.unseen_changes > 0).length,
      newExtension: extensionCases.filter((c) => c.unseen_changes > 0).length,
      newNocrawl: nocrawlCases.filter((c) => c.unseen_changes > 0).length,
    };
  }, [allCases]);

  const filtered = useMemo(() => {
    switch (work) {
      case "urgent": return allCases.filter(isUrgentCase);
      case "extension": return allCases.filter((c) => c.has_pending_extension || c.extensions.length > 0);
      case "nocrawl": return allCases.filter((c) => !c.last_crawled_at);
      default: return allCases;
    }
  }, [allCases, work]);

  // 단계 칩 건수는 현재 작업함 기준 (미처리 선택 시 → 미처리 사건의 단계 분포)
  const stageChips = useMemo(
    () =>
      STAGE_OPTIONS.map((s) => {
        const matched = filtered.filter((c) => c.stage === s.value);
        return {
          ...s,
          count: matched.length,
          newCount: matched.filter((c) => c.unseen_changes > 0).length,
        };
      }).filter((s) => s.count > 0 || s.value === stageFilter),
    [filtered, stageFilter],
  );

  const sorted = useMemo(() => {
    if (sortMode === "seq") return filtered;
    const getPriority = (c: CaseRow) => {
      if (c.deadline_status === "submitted") return 1;
      if (c.deadline_status === "overdue" || c.deadline_status === "pending" || c.has_pending_extension) return 0;
      if (!c.deadline_date && !c.received_date) return 3;
      return 2;
    };
    return [...filtered].sort((a, b) => {
      const pa = getPriority(a);
      const pb = getPriority(b);
      if (pa !== pb) return pa - pb;
      const aDate = a.deadline_date || a.received_date || "z";
      const bDate = b.deadline_date || b.received_date || "z";
      return aDate.localeCompare(bDate);
    });
  }, [filtered, sortMode]);

  const newBadge = (count: number, color: string) => count > 0 ? (
    <span className="absolute top-2.5 right-2.5 flex h-2 w-2">
      <span className={`animate-ping absolute inline-flex h-full w-full rounded-full ${color} opacity-75`} />
      <span className={`relative inline-flex rounded-full h-2 w-2 ${color}`} />
    </span>
  ) : null;

  const workCard = (key: WorkKey, label: string, count: number, opts: { dot?: string; numCls?: string; badge?: number; badgeColor?: string }) => (
    <button
      onClick={() => selectWork(key)}
      className={`relative rounded-2xl bg-white p-3.5 text-left transition-all border ${
        work === key
          ? "border-blue-400 ring-2 ring-blue-100 shadow-sm"
          : "border-transparent shadow-sm hover:shadow-md"
      }`}
    >
      {opts.badge != null && opts.badgeColor && newBadge(opts.badge, opts.badgeColor)}
      <p className="text-[11px] font-medium text-slate-400 flex items-center gap-1.5">
        {opts.dot && <span className={`w-1.5 h-1.5 rounded-full ${opts.dot}`} />}
        {label}
      </p>
      <p className={`text-xl font-bold mt-1 tabular-nums ${opts.numCls || "text-slate-900"}`}>
        {count}<span className="text-xs font-normal text-slate-400 ml-1">건</span>
      </p>
    </button>
  );

  return (
    <div className="flex-1 min-h-0 flex flex-col gap-4 p-6 md:p-8 max-w-[1400px] mx-auto w-full">
      {/* 헤더 */}
      <div>
        <div className="flex items-center justify-between">
          <h1 className="text-lg font-semibold text-slate-900 tracking-tight">내 사건</h1>
          <div className="flex items-center gap-3">
            <div className="inline-flex rounded-full bg-white shadow-sm p-0.5 text-xs">
              <button
                onClick={() => setSortMode("seq")}
                className={`px-3.5 py-1.5 rounded-full font-medium transition-colors ${sortMode === "seq" ? "bg-blue-600 text-white" : "text-slate-500 hover:text-slate-900"}`}
              >
                의뢰인 번호순
              </button>
              <button
                onClick={() => setSortMode("deadline")}
                className={`px-3.5 py-1.5 rounded-full font-medium transition-colors ${sortMode === "deadline" ? "bg-blue-600 text-white" : "text-slate-500 hover:text-slate-900"}`}
              >
                기한순
              </button>
            </div>
            <p className="text-xs text-slate-400">{userName}님의 담당 사건 현황</p>
          </div>
        </div>
      </div>

      {/* 작업함 카드 — 조치 필요한 것만 */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        {workCard("", "전체", stats.total, {})}
        {workCard("urgent", "미처리", stats.urgent, { dot: "bg-red-500", numCls: "text-red-600", badge: stats.newUrgent, badgeColor: "bg-red-500" })}
        {workCard("extension", "연장신청", stats.extension, { dot: "bg-orange-500", numCls: "text-orange-600", badge: stats.newExtension, badgeColor: "bg-orange-500" })}
        {workCard("nocrawl", "확인불가", stats.nocrawl, { dot: "bg-slate-400", numCls: "text-slate-600", badge: stats.newNocrawl, badgeColor: "bg-slate-500" })}
      </div>

      {/* 단계 칩 — 테이블의 단계 필터와 같은 상태 */}
      <div className="flex items-center gap-1.5 flex-wrap">
        <span className="text-[11px] font-medium text-slate-400 mr-0.5">단계</span>
        {stageChips.map((s) => {
          const active = stageFilter === s.value;
          return (
            <button
              key={s.value}
              onClick={() => setStageFilter(active ? "" : s.value)}
              className={`relative inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-medium transition-all ${
                active
                  ? "bg-blue-600 text-white shadow-sm"
                  : "bg-white text-slate-600 shadow-sm hover:shadow-md"
              }`}
            >
              <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${s.dot}`} />
              {s.label}
              <span className={`font-semibold tabular-nums ${active ? "text-white/70" : "text-slate-400"}`}>{s.count}</span>
              {s.newCount > 0 && (
                <span className="absolute -top-0.5 -right-0.5 flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75" />
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-blue-500" />
                </span>
              )}
            </button>
          );
        })}
        {stageFilter && (
          <button
            onClick={() => setStageFilter("")}
            className="text-[11px] font-medium text-slate-400 hover:text-slate-700 transition-colors ml-1"
          >
            ✕ 해제
          </button>
        )}
      </div>

      {/* 테이블 — 남은 높이를 다 차지하고 내부만 스크롤 */}
      <div className="flex-1 min-h-0 bg-white rounded-2xl shadow-sm overflow-hidden flex flex-col">
        <div className="p-4 flex-1 min-h-0 flex flex-col">
          <CaseScheduleTable
            cases={sorted}
            onRowClick={onRowClick}
            onPopupOpen={onPopupOpen}
            onDeleted={onCasesDeleted}
            stageFilter={stageFilter}
            onStageFilterChange={setStageFilter}
            deadlineStatusFilter={deadlineStatusFilter}
            onDeadlineStatusFilterChange={handleDeadlineFilterChange}
          />
        </div>
      </div>
    </div>
  );
}
