import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { createPortal } from "react-dom";
import { useVirtualizer } from "@tanstack/react-virtual";
import { EmptyState } from "@/components/ui/EmptyState";
import { formatFullDate } from "@/lib/caseflow/utils/date";
import { listUiCache } from "./list-ui-cache";
import type { CaseRow } from "@/lib/caseflow/case-row";

interface CaseScheduleTableProps {
  cases: CaseRow[];
  onRowClick?: (caseId: string) => void;
  onPopupOpen?: (row: CaseRow) => void;
  // 단계/보정기한 필터는 대시보드(요약 카드·단계 칩)와 상태를 공유한다
  stageFilter: string;
  onStageFilterChange: (v: string) => void;
  deadlineStatusFilter: string;
  onDeadlineStatusFilterChange: (v: string) => void;
}

function fmtDate(d: string | null) {
  if (!d) return "-";
  return formatFullDate(d);
}

function StageBadge({ stage, date }: { stage: string; date?: string | null }) {
  const config: Record<string, { label: string; cls: string; dot: string }> = {
    pending: { label: "접수전", cls: "bg-yellow-50 text-yellow-700 ring-1 ring-yellow-200", dot: "bg-yellow-500" },
    filed: { label: "사건접수", cls: "bg-gray-100 text-gray-600", dot: "bg-gray-400" },
    commenced: { label: "개시결정", cls: "bg-blue-50 text-blue-700 ring-1 ring-blue-200", dot: "bg-blue-500" },
    approved: { label: "인가결정", cls: "bg-purple-50 text-purple-700 ring-1 ring-purple-200", dot: "bg-purple-500" },
    declared: { label: "파산선고", cls: "bg-amber-50 text-amber-700 ring-1 ring-amber-200", dot: "bg-amber-500" },
    dismissed: { label: "폐지/취하", cls: "bg-orange-50 text-orange-700 ring-1 ring-orange-200", dot: "bg-orange-500" },
    withdrawn: { label: "취하", cls: "bg-orange-50 text-orange-700 ring-1 ring-orange-200", dot: "bg-orange-500" },
    discharged: { label: "면책결정", cls: "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200", dot: "bg-emerald-500" },
  };
  const c = config[stage] || config.filed;
  return (
    <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-semibold ${c.cls}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${c.dot}`} />
      {c.label}
      {date && <span className="font-normal opacity-70 ml-0.5">{fmtDate(date)}</span>}
    </span>
  );
}

function matchDeadlineStatus(c: CaseRow, target: string): boolean {
  const status = c.deadline_status;
  const hasExtension = c.extensions.length > 0;
  if (target === "submitted") return status === "submitted";
  if (target === "extended") return hasExtension && status !== "submitted";
  if (target === "overdue") return (status === "overdue" || status === "pending") && !hasExtension;
  return false;
}

interface DropdownOption {
  value: string;
  label: string;
  dot?: string;
}

export const STAGE_OPTIONS: { value: string; label: string; dot: string }[] = [
  { value: "pending", label: "접수전", dot: "bg-yellow-500" },
  { value: "filed", label: "사건접수", dot: "bg-gray-400" },
  { value: "commenced", label: "개시결정", dot: "bg-blue-500" },
  { value: "approved", label: "인가결정", dot: "bg-purple-500" },
  { value: "declared", label: "파산선고", dot: "bg-amber-500" },
  { value: "discharged", label: "면책결정", dot: "bg-emerald-500" },
  { value: "dismissed", label: "폐지/취하", dot: "bg-orange-500" },
  { value: "withdrawn", label: "취하", dot: "bg-orange-500" },
];

const DEADLINE_STATUS_OPTIONS: DropdownOption[] = [
  { value: "overdue", label: "미처리/기한경과", dot: "bg-red-500" },
  { value: "extended", label: "연장 신청", dot: "bg-orange-500" },
  { value: "submitted", label: "제출완료", dot: "bg-emerald-500" },
];

function FilterDropdown({
  value, onChange, options, placeholder, width = 200, popupWidth = 200, sortDir, onSortChange,
}: {
  value: string;
  onChange: (v: string) => void;
  options: DropdownOption[];
  placeholder: string;
  width?: number;
  popupWidth?: number;
  sortDir?: "asc" | "desc" | "";
  onSortChange?: (v: "asc" | "desc" | "") => void;
}) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const btnRef = useRef<HTMLButtonElement>(null);
  const selected = options.find((o) => o.value === value);

  const toggle = useCallback(() => {
    if (!open && btnRef.current) {
      const rect = btnRef.current.getBoundingClientRect();
      setPos({ top: rect.bottom + 6, left: rect.left + rect.width / 2 - popupWidth / 2 });
    }
    setOpen((v) => !v);
  }, [open, popupWidth]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (btnRef.current && !btnRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const handleSelect = (v: string) => {
    onChange(v);
    if (v && onSortChange) onSortChange("");
    setOpen(false);
  };

  return (
    <>
      <button
        ref={btnRef}
        onClick={toggle}
        className={`inline-flex items-center justify-center gap-1 px-2 py-1 rounded-md text-[11px] font-semibold uppercase tracking-wider transition-colors max-w-full ${
          value
            ? "bg-blue-50 text-blue-600 ring-1 ring-blue-200 hover:bg-blue-100"
            : "text-gray-400 hover:bg-gray-100 hover:text-gray-600"
        }`}
        style={{ maxWidth: `${width}px` }}
        title={`${placeholder}로 정렬`}
      >
        {selected?.dot && <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${selected.dot}`} />}
        <span className="truncate">{selected?.label || placeholder}</span>
        <svg className={`w-3 h-3 shrink-0 transition-transform ${open ? "rotate-180" : ""}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {open && createPortal(
        <div
          className="fixed z-50 bg-white rounded-xl shadow-xl ring-1 ring-gray-200 py-1.5 max-h-96 overflow-auto"
          style={{ top: pos.top, left: pos.left, width: popupWidth }}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <button
            onClick={() => { handleSelect(""); if (onSortChange) onSortChange(""); }}
            className={`w-full px-3 py-2 text-left text-[12px] font-medium flex items-center justify-between transition-colors ${
              !value && !sortDir ? "bg-gray-50 text-gray-900" : "text-gray-500 hover:bg-gray-50 hover:text-gray-900"
            }`}
          >
            <span>전체 (정렬 해제)</span>
            {!value && !sortDir && <span className="text-blue-500">✓</span>}
          </button>
          <div className="my-1 mx-2 border-t border-gray-100" />
          {options.map((opt) => {
            const active = value === opt.value;
            return (
              <div key={opt.value} className={`flex items-center transition-colors ${active ? "bg-blue-50" : "hover:bg-gray-50"}`}>
                <button
                  onClick={() => handleSelect(opt.value)}
                  className={`flex-1 px-3 py-2 text-left text-[12px] font-medium flex items-center gap-2 transition-colors ${active ? "text-blue-700" : "text-gray-700"}`}
                >
                  {opt.dot && <span className={`w-2 h-2 rounded-full shrink-0 ${opt.dot}`} />}
                  <span className="flex-1 truncate">{opt.label}</span>
                  {active && !sortDir && <span className="text-blue-500 shrink-0">✓</span>}
                </button>
                {onSortChange && (
                  <div className="flex items-center gap-0.5 pr-2 shrink-0">
                    <button
                      onClick={() => {
                        const next = value === opt.value && sortDir === "asc" ? "" : "asc";
                        onChange(next ? opt.value : "");
                        onSortChange(next);
                        setOpen(false);
                      }}
                      className={`p-1 rounded transition-colors ${
                        active && sortDir === "asc" ? "text-blue-600 bg-blue-100" : "text-gray-300 hover:text-gray-500 hover:bg-gray-100"
                      }`}
                      title="오름차순"
                    >
                      <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 15l7-7 7 7" /></svg>
                    </button>
                    <button
                      onClick={() => {
                        const next = value === opt.value && sortDir === "desc" ? "" : "desc";
                        onChange(next ? opt.value : "");
                        onSortChange(next);
                        setOpen(false);
                      }}
                      className={`p-1 rounded transition-colors ${
                        active && sortDir === "desc" ? "text-blue-600 bg-blue-100" : "text-gray-300 hover:text-gray-500 hover:bg-gray-100"
                      }`}
                      title="내림차순"
                    >
                      <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M19 9l-7 7-7-7" /></svg>
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>,
        document.body,
      )}
    </>
  );
}

function SortToggleButton({
  value, onChange, label,
}: {
  value: "asc" | "desc" | "";
  onChange: (v: "asc" | "desc" | "") => void;
  label: string;
}) {
  const next = () => {
    if (value === "") onChange("desc");
    else if (value === "desc") onChange("asc");
    else onChange("");
  };
  return (
    <button
      onClick={next}
      className={`inline-flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-semibold uppercase tracking-wider transition-colors ${
        value ? "bg-blue-50 text-blue-600 ring-1 ring-blue-200 hover:bg-blue-100" : "text-gray-400 hover:bg-gray-100 hover:text-gray-600"
      }`}
      title={`${label} 정렬: ${value === "asc" ? "오름차순" : value === "desc" ? "내림차순" : "해제"}`}
    >
      <span>{label}</span>
      {value === "asc" ? (
        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 15l7-7 7 7" /></svg>
      ) : value === "desc" ? (
        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M19 9l-7 7-7-7" /></svg>
      ) : (
        <svg className="w-3 h-3 opacity-60" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16V4m0 0L3 8m4-4l4 4m6 0v12m0 0l4-4m-4 4l-4-4" /></svg>
      )}
    </button>
  );
}

function DeadlineHelpTooltip() {
  const [show, setShow] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const ref = useRef<HTMLSpanElement>(null);

  const handleEnter = useCallback(() => {
    if (ref.current) {
      const rect = ref.current.getBoundingClientRect();
      setPos({ top: rect.bottom + 6, left: rect.left + rect.width / 2 - 104 });
    }
    setShow(true);
  }, []);

  const tooltip = show
    ? createPortal(
        <div
          style={{ position: "fixed", top: pos.top, left: pos.left, zIndex: 9999 }}
          className="w-52 bg-gray-900 text-white text-[10px] font-normal normal-case tracking-normal rounded-lg p-3 shadow-xl leading-relaxed"
          onMouseEnter={() => setShow(true)}
          onMouseLeave={() => setShow(false)}
        >
          <div className="flex items-center gap-1.5 mb-1"><span className="w-2 h-2 rounded-full bg-red-500 shrink-0"></span> 미처리 (기한 경과)</div>
          <div className="flex items-center gap-1.5 mb-1"><span className="w-2 h-2 rounded-full bg-orange-500 shrink-0"></span> 연장신청 (기한 미입력)</div>
          <div className="flex items-center gap-1.5 mb-1"><span className="w-2 h-2 rounded-full bg-emerald-500 shrink-0"></span> 제출완료</div>
          <div className="flex items-center gap-1.5"><span className="text-amber-400">⚠</span> 임의 기한 (입력 필요)</div>
        </div>,
        document.body,
      )
    : null;

  return (
    <>
      <span
        ref={ref}
        onMouseEnter={handleEnter}
        onMouseLeave={() => setShow(false)}
        className="inline-flex items-center justify-center w-3.5 h-3.5 rounded-full bg-gray-200 text-[9px] text-gray-500 cursor-help"
      >?</span>
      {tooltip}
    </>
  );
}

function DeadlineCell({
  date, status, isAuto, extensionCount, onWarningClick, hasPendingExtension,
}: {
  date: string | null;
  status: string | null;
  isAuto: boolean;
  extensionCount: number;
  onWarningClick?: () => void;
  hasPendingExtension?: boolean;
}) {
  if (!date) return <span className="text-gray-400">-</span>;
  const colorMap: Record<string, string> = {
    submitted: "text-emerald-600 font-semibold",
    extended: "text-orange-500 font-semibold",
    overdue: "text-red-600 font-semibold",
    pending: "text-red-600 font-semibold",
  };
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const dl = new Date(date); dl.setHours(0, 0, 0, 0);
  const isUrgent = status !== "submitted" && dl.getTime() <= today.getTime();
  const hasExtension = extensionCount > 0;
  const useOrange = hasExtension && status !== "submitted";
  return (
    <span className={`inline-flex items-center gap-1 ${useOrange ? "text-orange-500 font-semibold" : (colorMap[status || "pending"] || "text-gray-700")}`}>
      {isUrgent && (
        <span className="relative flex h-2 w-2 shrink-0">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75" />
          <span className="relative inline-flex rounded-full h-2 w-2 bg-red-500" />
        </span>
      )}
      {status === "submitted" && <span className="text-emerald-500">✓</span>}
      {status === "extended" && <span>↻</span>}
      {fmtDate(date)}
      {extensionCount > 0 && status !== "submitted" && (
        <span className="ml-0.5 text-[10px] font-bold text-orange-500 bg-orange-50 px-1 py-0.5 rounded">
          {extensionCount}차
        </span>
      )}
      {(isAuto || hasPendingExtension) && status !== "submitted" && (
        <button
          onClick={(e) => { e.stopPropagation(); onWarningClick?.(); }}
          className="ml-0.5 text-amber-500 hover:text-amber-600 transition-colors"
          title={hasPendingExtension ? "연장신청 후 기한이 미입력 상태입니다" : "임의 설정된 기한입니다"}
        >
          ⚠
        </button>
      )}
    </span>
  );
}

export function CaseScheduleTable({
  cases, onRowClick, onPopupOpen,
  stageFilter, onStageFilterChange, deadlineStatusFilter, onDeadlineStatusFilterChange,
}: CaseScheduleTableProps) {
  // 상세 들어갔다 나와도 유지되도록 캐시에서 초기화 + 변경 시 기록
  const [searchQuery, _setSearchQuery] = useState(listUiCache.searchQuery);
  const [stageSortDir, _setStageSortDir] = useState<"asc" | "desc" | "">(listUiCache.stageSortDir);
  const [docTypeFilter, _setDocTypeFilter] = useState<string>(listUiCache.docTypeFilter);
  const [receivedDateSort, _setReceivedDateSort] = useState<"asc" | "desc" | "">(listUiCache.receivedDateSort);
  const [indexSort, _setIndexSort] = useState<"asc" | "desc">(listUiCache.indexSort);

  const setSearchQuery = (v: string) => { listUiCache.searchQuery = v; _setSearchQuery(v); };
  const setStageSortDir = (v: "asc" | "desc" | "") => { listUiCache.stageSortDir = v; _setStageSortDir(v); };
  const setDocTypeFilter = (v: string) => { listUiCache.docTypeFilter = v; _setDocTypeFilter(v); };
  const setReceivedDateSort = (v: "asc" | "desc" | "") => { listUiCache.receivedDateSort = v; _setReceivedDateSort(v); };
  const setIndexSort = (v: React.SetStateAction<"asc" | "desc">) => {
    _setIndexSort((prev) => {
      const next = typeof v === "function" ? v(prev) : v;
      listUiCache.indexSort = next;
      return next;
    });
  };
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [warningRow, setWarningRow] = useState<CaseRow | null>(null);
  const searchTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  const docTypeOptions = useMemo(
    () => Array.from(new Set(cases.map((c) => c.document_type).filter(Boolean) as string[])).sort(),
    [cases],
  );

  const filteredCases = useMemo(() => {
    let result = cases;
    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase();
      const qNoSpace = q.replace(/\s/g, "");
      result = result.filter((c) =>
        c.applicant_name.toLowerCase().includes(q) ||
        (c.case_number || "").toLowerCase().replace(/\s/g, "").includes(qNoSpace) ||
        (c.judge_info || "").toLowerCase().replace(/\s/g, "").includes(qNoSpace),
      );
    }
    if (stageFilter) result = result.filter((c) => c.stage === stageFilter);
    if (deadlineStatusFilter) result = result.filter((c) => matchDeadlineStatus(c, deadlineStatusFilter));

    let indexed = result.map((c, idx) => ({ c, idx }));

    // 보정기한 필터 선택 시 날짜 오름차순 — 최근 날짜가 맨 아래 (엑셀 방향).
    // 수신일자/단계 정렬을 직접 걸면 그쪽이 우선.
    if (deadlineStatusFilter) {
      indexed.sort((a, b) => {
        const da = (deadlineStatusFilter === "submitted" ? a.c.submitted_date : null) || a.c.deadline_date || "";
        const db = (deadlineStatusFilter === "submitted" ? b.c.submitted_date : null) || b.c.deadline_date || "";
        if (!da && !db) return a.idx - b.idx;
        if (!da) return -1; // 날짜 없는 건 위로
        if (!db) return 1;
        return da.localeCompare(db) || a.idx - b.idx;
      });
    }
    if (receivedDateSort) {
      indexed.sort((a, b) => {
        const da = a.c.received_date || "";
        const db = b.c.received_date || "";
        if (!da && !db) return a.idx - b.idx;
        if (!da) return 1;
        if (!db) return -1;
        return receivedDateSort === "asc" ? da.localeCompare(db) : db.localeCompare(da);
      });
    }
    if (docTypeFilter) {
      indexed.sort((a, b) => {
        const aMatch = a.c.document_type === docTypeFilter ? 0 : 1;
        const bMatch = b.c.document_type === docTypeFilter ? 0 : 1;
        return aMatch - bMatch || a.idx - b.idx;
      });
    }
    if (stageSortDir) {
      indexed.sort((a, b) => {
        const aNo = a.c.case_number || "";
        const bNo = b.c.case_number || "";
        if (!aNo && !bNo) return a.idx - b.idx;
        if (!aNo) return 1;
        if (!bNo) return -1;
        const diff = aNo.localeCompare(bNo);
        return stageSortDir === "desc" ? -diff || a.idx - b.idx : diff || a.idx - b.idx;
      });
    }
    const otherSortActive = !!(stageSortDir || receivedDateSort || deadlineStatusFilter);
    if (!otherSortActive && indexSort === "desc") indexed.reverse();
    return indexed.map((x) => x.c);
  }, [cases, searchQuery, receivedDateSort, deadlineStatusFilter, docTypeFilter, stageFilter, stageSortDir, indexSort]);

  const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = e.target.value;
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    searchTimerRef.current = setTimeout(() => setSearchQuery(v), 200);
  };

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    if (selectedIds.size === filteredCases.length) setSelectedIds(new Set());
    else setSelectedIds(new Set(filteredCases.map((c) => c.case_id)));
  };

  const isAllSelected = filteredCases.length > 0 && selectedIds.size === filteredCases.length;
  const isSomeSelected = selectedIds.size > 0;

  const scrollRef = useRef<HTMLDivElement>(null);
  const ROW_HEIGHT = 38;
  const rowVirtualizer = useVirtualizer({
    count: filteredCases.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 12,
  });
  const virtualItems = rowVirtualizer.getVirtualItems();
  const totalSize = rowVirtualizer.getTotalSize();
  const paddingTop = virtualItems.length > 0 ? virtualItems[0].start : 0;
  const paddingBottom = virtualItems.length > 0 ? totalSize - virtualItems[virtualItems.length - 1].end : 0;

  // 엑셀처럼 첫 화면은 최근 사건(번호 큰 쪽 = 맨 아래)이 보이도록 시작.
  // 상세 들어갔다 나온 경우엔 보고 있던 위치를 복원.
  // scrollToIndex는 동적 측정 모드에서 첫 마운트에 빗나가는 경우가 있어 컨테이너를 직접 내린다.
  const didInitialScroll = useRef(false);
  useEffect(() => {
    if (didInitialScroll.current || filteredCases.length === 0) return;
    didInitialScroll.current = true;
    const saved = listUiCache.scrollTop;
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const el = scrollRef.current;
        if (el) el.scrollTop = saved != null ? saved : el.scrollHeight;
      });
    });
  }, [filteredCases.length]);

  // 단계/보정기한 필터가 바뀌면(걸든 풀든) 맨 아래(최신)부터 보이도록 스크롤.
  // 마운트 시 위치 복원과 충돌하지 않게 첫 실행은 건너뛴다.
  const filterScrollMounted = useRef(false);
  useEffect(() => {
    if (!filterScrollMounted.current) { filterScrollMounted.current = true; return; }
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const el = scrollRef.current;
        if (el) el.scrollTop = el.scrollHeight;
      });
    });
  }, [stageFilter, deadlineStatusFilter]);

  if (cases.length === 0) {
    return <EmptyState icon="📂" message="아직 등록된 사건이 없어요" description="사건을 등록하면 여기에 표시됩니다." />;
  }

  const th = "h-10 px-3 font-semibold text-[11px] text-gray-400 uppercase tracking-wider whitespace-nowrap text-center border-b border-gray-100 sticky top-0 bg-gray-50/80 backdrop-blur-sm z-10";
  const td = "py-3 px-3 text-[13px] text-center whitespace-nowrap overflow-hidden";

  return (
    <>
      <div className="relative mb-3">
        <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
        </svg>
        <input
          type="text"
          defaultValue={listUiCache.searchQuery}
          onChange={handleSearchChange}
          placeholder="의뢰인 / 사건번호 검색"
          className="w-full pl-9 pr-8 py-2 text-[13px] border border-slate-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-400 transition-all placeholder:text-slate-400"
        />
      </div>
      <div
        ref={scrollRef}
        onScroll={(e) => { listUiCache.scrollTop = e.currentTarget.scrollTop; }}
        className="overflow-auto flex-1 min-h-0"
      >
        <table className="w-full text-xs border-collapse table-fixed min-w-[960px]">
          <colgroup>
            <col style={{ width: 40 }} />
            <col style={{ width: 60 }} />
            <col style={{ width: 130 }} />
            <col style={{ width: 80 }} />
            <col style={{ width: 160 }} />
            <col style={{ width: 130 }} />
            <col style={{ width: 100 }} />
            <col style={{ width: 140 }} />
            <col style={{ width: 90 }} />
            <col style={{ width: 60 }} />
          </colgroup>
          <thead>
            <tr>
              <th className={`${th} w-10 px-2`}>
                <div className="flex items-center justify-center gap-0.5">
                  <label className="flex items-center justify-center cursor-pointer">
                    <input
                      type="checkbox"
                      checked={isAllSelected}
                      ref={(el) => { if (el) el.indeterminate = isSomeSelected && !isAllSelected; }}
                      onChange={toggleAll}
                      className="w-3.5 h-3.5 rounded border-gray-300 text-blue-600 focus:ring-blue-500/30 cursor-pointer"
                    />
                  </label>
                  <button
                    onClick={() => setIndexSort((prev) => prev === "asc" ? "desc" : "asc")}
                    className="p-0.5 text-gray-400 hover:text-blue-600 transition-colors"
                    title={indexSort === "asc" ? "번호 오름차순. 클릭하여 내림차순" : "번호 내림차순. 클릭하여 오름차순"}
                  >
                    <svg className={`w-3 h-3 transition-transform ${indexSort === "desc" ? "rotate-180" : ""}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 15l7-7 7 7" />
                    </svg>
                  </button>
                </div>
              </th>
              {isSomeSelected ? (
                <th colSpan={9} className={`${th} !text-left`}>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2.5">
                      <span className="font-bold text-blue-700 text-[12px] normal-case tracking-normal">{selectedIds.size}건 선택</span>
                      <button onClick={() => setSelectedIds(new Set())} className="text-blue-400 hover:text-blue-600 text-[11px] font-medium transition-colors normal-case tracking-normal">해제</button>
                    </div>
                    <div className="flex items-center gap-1.5 text-[11px] text-gray-400 normal-case tracking-normal">
                      {/* TODO: 수정/처리완료/삭제 (다음 단계) */}
                      일괄 작업 기능 준비 중
                    </div>
                  </div>
                </th>
              ) : (
                <>
                  <th className={`${th} text-left`}>법원명</th>
                  <th className={`${th} text-left`}>사건번호</th>
                  <th className={`${th} text-left`}>의뢰인</th>
                  <th className={`${th} w-28`}>
                    <FilterDropdown
                      value={stageFilter}
                      onChange={onStageFilterChange}
                      options={STAGE_OPTIONS}
                      placeholder="단계"
                      width={110}
                      popupWidth={180}
                      sortDir={stageSortDir}
                      onSortChange={setStageSortDir}
                    />
                  </th>
                  <th className={th}>
                    <FilterDropdown
                      value={docTypeFilter}
                      onChange={setDocTypeFilter}
                      options={docTypeOptions.map((d) => ({ value: d, label: d }))}
                      placeholder="송달문서"
                      width={140}
                      popupWidth={240}
                    />
                  </th>
                  <th className={th}>
                    <SortToggleButton value={receivedDateSort} onChange={setReceivedDateSort} label="수신일자" />
                  </th>
                  <th className={`${th} w-32`}>
                    <div className="inline-flex items-center gap-1">
                      <FilterDropdown
                        value={deadlineStatusFilter}
                        onChange={onDeadlineStatusFilterChange}
                        options={DEADLINE_STATUS_OPTIONS}
                        placeholder="보정기한"
                        width={130}
                        popupWidth={200}
                      />
                      <DeadlineHelpTooltip />
                    </div>
                  </th>
                  <th className={th}>제출일자</th>
                  <th className={`${th} text-left`}>수정</th>
                </>
              )}
            </tr>
          </thead>
          <tbody>
            {paddingTop > 0 && (
              <tr aria-hidden style={{ height: paddingTop }}>
                <td colSpan={10} />
              </tr>
            )}
            {virtualItems.map((vi) => {
              const c = filteredCases[vi.index];
              const idx = vi.index;
              const isSelected = selectedIds.has(c.case_id);
              return (
                <tr
                  key={`${c.case_id}-${c.correction_id || "no"}`}
                  data-index={vi.index}
                  ref={rowVirtualizer.measureElement}
                  className={`border-b border-slate-100 transition-colors duration-150 group/row ${isSelected ? "bg-blue-50/50" : "hover:bg-slate-50"}`}
                >
                  <td className={`${td} w-10 px-2`}>
                    <label className="flex items-center justify-center cursor-pointer relative w-5 h-5 mx-auto">
                      <span className={`absolute inset-0 flex items-center justify-center text-[11px] font-medium transition-all duration-200 ease-out ${
                        isSelected
                          ? "opacity-0 scale-75"
                          : "opacity-100 group-hover/row:opacity-0 group-hover/row:scale-75 text-gray-400 group-hover/row:text-gray-600"
                      }`}>
                        {c.seq_number ?? idx + 1}
                      </span>
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => toggleSelect(c.case_id)}
                        className={`w-3.5 h-3.5 rounded border-gray-300 text-blue-600 focus:ring-blue-500/30 cursor-pointer transition-all duration-200 ease-out ${
                          isSelected
                            ? "opacity-100 scale-100"
                            : "opacity-0 scale-75 group-hover/row:opacity-100 group-hover/row:scale-100"
                        }`}
                      />
                    </label>
                  </td>
                  <td className={`${td} text-left`}>{c.court_region || "-"}</td>
                  <td className={`${td} text-left font-mono`}>
                    <button onClick={() => onRowClick?.(c.case_id)} className="text-blue-600 hover:underline cursor-pointer">
                      {c.case_number || "-"}
                    </button>
                  </td>
                  <td className={`${td} text-left`}>
                    <button onClick={() => onRowClick?.(c.case_id)} className="text-gray-800 hover:underline cursor-pointer">
                      {c.applicant_name}
                    </button>
                    {c.crawl_status === "pending" && (
                      <svg className="ml-1.5 w-3.5 h-3.5 text-blue-500 animate-spin inline-block" fill="none" viewBox="0 0 24 24" aria-label="크롤링 진행 중"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/></svg>
                    )}
                    {c.crawl_status === "failed" && (
                      <span className="ml-1.5 inline-flex items-center gap-0.5 text-[10px] font-semibold text-red-600 bg-red-50 ring-1 ring-red-200 px-1.5 py-0.5 rounded" title="대법원 사이트에서 사건을 찾지 못했습니다 (사건번호 확인 필요)">
                        ⚠ 크롤링 실패
                      </span>
                    )}
                  </td>
                  <td className={td}><StageBadge stage={c.stage} date={c.stage_date} /></td>
                  <td className={td}>{c.document_type || "-"}</td>
                  <td className={td}>
                    {c.received_date ? (
                      <span className="inline-flex items-center gap-1">
                        {fmtDate(c.received_date)}
                        {c.arrival_raw?.includes("0시") && (
                          <span className="text-[10px] font-medium text-orange-500 bg-orange-50 px-1.5 py-0.5 rounded">0시 도달</span>
                        )}
                      </span>
                    ) : "-"}
                  </td>
                  <td
                    className={`${td} cursor-pointer hover:bg-blue-50/50 transition-colors`}
                    onClick={() => {
                      if (!c.correction_id || c.deadline_status === "submitted") return;
                      onPopupOpen?.(c);
                    }}
                  >
                    <DeadlineCell
                      date={c.deadline_date}
                      status={c.deadline_status}
                      isAuto={c.is_auto_deadline}
                      extensionCount={c.extensions.length}
                      onWarningClick={() => setWarningRow(c)}
                      hasPendingExtension={c.has_pending_extension}
                    />
                  </td>
                  <td className={`${td} text-emerald-600 font-medium`}>
                    {c.submitted_date ? (
                      <span className="inline-flex items-center gap-1">
                        {fmtDate(c.submitted_date)}
                        {c.manual_submit && (
                          <span className="text-[10px] font-medium text-violet-500 bg-violet-50 px-1 py-0.5 rounded">직</span>
                        )}
                      </span>
                    ) : "-"}
                  </td>
                  <td
                    className={`${td} text-left cursor-pointer group`}
                    onClick={() => onPopupOpen?.(c)}
                  >
                    <span className="text-gray-400 group-hover:text-blue-600 transition-colors">+ 입력</span>
                  </td>
                </tr>
              );
            })}
            {paddingBottom > 0 && (
              <tr aria-hidden style={{ height: paddingBottom }}>
                <td colSpan={10} />
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {warningRow && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setWarningRow(null)}>
          <div className="bg-white rounded-xl shadow-2xl w-[340px] overflow-hidden" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-3 px-5 py-4 bg-amber-50 border-b border-amber-100">
              <span className="text-2xl">⚠️</span>
              <h3 className="text-sm font-bold text-amber-800">임의 설정된 보정기한</h3>
            </div>
            <div className="px-5 py-4 space-y-4">
              <p className="text-sm text-gray-600 leading-relaxed">
                보정기한 <span className="font-bold text-amber-600">7일</span>은 임의로 설정된 기한입니다. 보정권고를 등록하거나 정확한 날짜를 직접 입력해주세요.
              </p>
              <button
                onClick={() => setWarningRow(null)}
                className="w-full py-2.5 bg-gray-100 hover:bg-gray-200 text-gray-700 text-sm font-medium rounded-lg transition-colors"
              >
                확인
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
