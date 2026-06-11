import { useEffect, useMemo, useRef, useState } from "react";
import {
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type SortingState,
} from "@tanstack/react-table";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Search, Loader2 } from "lucide-react";
import { dbSelect } from "@/lib/db";
import { CASE_STATUS_LABELS, CASE_STATUS_COLORS } from "@/lib/caseflow/constants/status";
import type { CaseStatus } from "@/lib/caseflow/types";

interface CaseRow {
  id: string;
  seq_number: number | null;
  case_number: string | null;
  case_type: string | null;
  court_region: string | null;
  applicant_name: string;
  judge_info: string | null;
  staff_name: string | null;
  status: CaseStatus;
  filed_date: string | null;
  commencement_date: string | null;
  approval_date: string | null;
  created_at: string;
  active_corrections_count: number | null;
  overdue_corrections_count: number | null;
}

interface Props {
  refreshKey: number; // 부모(MainShell)에서 sync 끝나면 증가시키는 트리거
}

export function CaseList({ refreshKey }: Props) {
  const [rows, setRows] = useState<CaseRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [sorting, setSorting] = useState<SortingState>([
    { id: "seq_number", desc: false },
  ]);

  // SQLite에서 로컬 사건 읽기 — 메모리에 다 올리고 in-memory 필터/정렬
  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true);
      const t0 = performance.now();
      const data = await dbSelect<CaseRow>(
        `SELECT id, seq_number, case_number, case_type, court_region,
                applicant_name, judge_info, staff_name, status,
                filed_date, commencement_date, approval_date, created_at,
                active_corrections_count, overdue_corrections_count
         FROM cases
         ORDER BY seq_number IS NULL, seq_number ASC, created_at DESC`,
      );
      if (!alive) return;
      const ms = Math.round(performance.now() - t0);
      console.log(`[CaseList] loaded ${data.length} rows from SQLite in ${ms}ms`);
      setRows(data);
      setLoading(false);
    })();
    return () => {
      alive = false;
    };
  }, [refreshKey]);

  const columns = useMemo<ColumnDef<CaseRow>[]>(
    () => [
      {
        accessorKey: "seq_number",
        header: "#",
        size: 56,
        cell: ({ getValue }) => (
          <span className="text-slate-400 tabular-nums">
            {(getValue() as number | null) ?? "—"}
          </span>
        ),
      },
      {
        accessorKey: "court_region",
        header: "법원",
        size: 70,
        cell: ({ getValue }) => (getValue() as string) || "—",
      },
      {
        accessorKey: "case_number",
        header: "사건번호",
        size: 140,
        cell: ({ getValue }) => (
          <span className="font-mono text-xs text-slate-700">
            {(getValue() as string) || "—"}
          </span>
        ),
      },
      {
        accessorKey: "applicant_name",
        header: "신청인",
        size: 100,
        cell: ({ getValue }) => (
          <span className="font-medium text-slate-900">{getValue() as string}</span>
        ),
      },
      {
        accessorKey: "judge_info",
        header: "재판부",
        size: 140,
        cell: ({ getValue }) => (
          <span className="text-slate-600 truncate">
            {(getValue() as string) || "—"}
          </span>
        ),
      },
      {
        accessorKey: "staff_name",
        header: "담당자",
        size: 90,
        cell: ({ getValue }) => (
          <span className="text-slate-600">{(getValue() as string) || "—"}</span>
        ),
      },
      {
        accessorKey: "status",
        header: "단계",
        size: 80,
        cell: ({ getValue }) => {
          const s = getValue() as CaseStatus;
          return (
            <span
              className={`inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium ${CASE_STATUS_COLORS[s] || "bg-gray-100 text-gray-700"}`}
            >
              {CASE_STATUS_LABELS[s] || s}
            </span>
          );
        },
      },
      {
        id: "corrections",
        header: "보정",
        size: 70,
        cell: ({ row }) => {
          const overdue = row.original.overdue_corrections_count ?? 0;
          const active = row.original.active_corrections_count ?? 0;
          if (overdue > 0)
            return (
              <span className="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-semibold bg-red-50 text-red-600">
                🔴 {overdue}
              </span>
            );
          if (active > 0)
            return (
              <span className="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium bg-amber-50 text-amber-700">
                {active}
              </span>
            );
          return <span className="text-slate-300">—</span>;
        },
      },
    ],
    [],
  );

  // 클라이언트 사이드 검색 — 신청인 / 사건번호 / 법원
  const filteredRows = useMemo(() => {
    if (!query.trim()) return rows;
    const q = query.trim().toLowerCase();
    return rows.filter(
      (r) =>
        r.applicant_name.toLowerCase().includes(q) ||
        (r.case_number || "").toLowerCase().includes(q) ||
        (r.court_region || "").toLowerCase().includes(q) ||
        (r.judge_info || "").toLowerCase().includes(q),
    );
  }, [rows, query]);

  const table = useReactTable({
    data: filteredRows,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
  });

  // 가상 스크롤
  const parentRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: table.getRowModel().rows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 40,
    overscan: 10,
  });

  return (
    <div className="h-full flex flex-col">
      {/* 상단 검색 + 카운트 */}
      <div className="px-5 py-3 border-b border-slate-200 bg-white flex items-center gap-3 flex-shrink-0">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="신청인 / 사건번호 / 법원 / 재판부 검색..."
            className="w-full pl-9 pr-3 py-2 border border-slate-200 rounded-lg text-sm placeholder:text-slate-300 focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-400"
          />
        </div>
        <div className="text-xs text-slate-500">
          {loading ? (
            <span className="inline-flex items-center gap-1">
              <Loader2 className="w-3 h-3 animate-spin" />
              불러오는 중...
            </span>
          ) : (
            <>
              <span className="font-semibold text-slate-700">{filteredRows.length}</span>
              {query && (
                <span className="text-slate-400"> / {rows.length}</span>
              )}{" "}
              건
            </>
          )}
        </div>
      </div>

      {/* 테이블 */}
      <div className="flex-1 overflow-hidden bg-white">
        {loading ? (
          <div className="h-full flex items-center justify-center text-slate-400">
            <Loader2 className="w-5 h-5 animate-spin" />
          </div>
        ) : rows.length === 0 ? (
          <div className="h-full flex items-center justify-center text-slate-400 text-sm">
            등록된 사건이 없습니다. 우상단 "새로고침"을 눌러 동기화하세요.
          </div>
        ) : (
          <div ref={parentRef} className="h-full overflow-auto">
            <table className="w-full text-sm" style={{ minWidth: 920 }}>
              <thead className="sticky top-0 bg-slate-50/95 backdrop-blur-sm z-10 border-b border-slate-200">
                {table.getHeaderGroups().map((hg) => (
                  <tr key={hg.id}>
                    {hg.headers.map((h) => (
                      <th
                        key={h.id}
                        style={{ width: h.column.getSize() }}
                        className="px-3 py-2 text-left text-xs font-semibold text-slate-500 select-none"
                      >
                        {flexRender(h.column.columnDef.header, h.getContext())}
                      </th>
                    ))}
                  </tr>
                ))}
              </thead>
              <tbody
                style={{
                  height: `${virtualizer.getTotalSize()}px`,
                  position: "relative",
                  display: "block",
                }}
              >
                {virtualizer.getVirtualItems().map((vr) => {
                  const row = table.getRowModel().rows[vr.index];
                  return (
                    <tr
                      key={row.id}
                      data-index={vr.index}
                      ref={(el) => virtualizer.measureElement(el)}
                      style={{
                        position: "absolute",
                        top: 0,
                        transform: `translateY(${vr.start}px)`,
                        display: "table",
                        tableLayout: "fixed",
                        width: "100%",
                      }}
                      className="border-b border-slate-100 hover:bg-slate-50 cursor-pointer"
                    >
                      {row.getVisibleCells().map((cell) => (
                        <td
                          key={cell.id}
                          style={{ width: cell.column.getSize() }}
                          className="px-3 py-2 whitespace-nowrap"
                        >
                          {flexRender(cell.column.columnDef.cell, cell.getContext())}
                        </td>
                      ))}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
