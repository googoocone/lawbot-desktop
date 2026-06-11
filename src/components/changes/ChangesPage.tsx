import { useState, useEffect, useMemo } from "react";
import { dbSelect } from "@/lib/db";
import { supabase } from "@/lib/supabase";
import { markNotificationAsRead, markAllNotificationsAsRead } from "@/lib/actions/local";
import { relativeTime } from "@/lib/caseflow/utils/date";
import { EmptyState } from "@/components/ui/EmptyState";
import type { NotificationType, NotificationPriority } from "@/lib/caseflow/types";

interface ChangeRow {
  id: string;
  case_id: string | null;
  type: NotificationType;
  priority: NotificationPriority;
  title: string;
  message: string;
  is_read: number;
  created_at: string;
  case_number: string | null;
  applicant_name: string | null;
  court_name: string | null;
  staff_name: string | null;
}

interface Props {
  refreshKey?: number;
  onCaseClick?: (caseId: string) => void;
  onUnreadCountChange?: (n: number) => void;
}

// 크롤러가 감지하는 변동 유형별 표시 메타
const TYPE_META: Record<string, { label: string; chip: string; strip: string }> = {
  correction_new: {
    label: "보정·명령 도착",
    chip: "bg-blue-50 text-blue-700 ring-1 ring-blue-200",
    strip: "bg-blue-50/60 text-blue-800",
  },
  progress_update: {
    label: "진행내역 변경",
    chip: "bg-gray-100 text-gray-600 ring-1 ring-gray-200",
    strip: "bg-gray-50 text-gray-700",
  },
  status_change: {
    label: "단계 변경",
    chip: "bg-purple-50 text-purple-700 ring-1 ring-purple-200",
    strip: "bg-purple-50/60 text-purple-800",
  },
  deadline_approaching: {
    label: "기한 임박",
    chip: "bg-amber-50 text-amber-700 ring-1 ring-amber-200",
    strip: "bg-amber-50/70 text-amber-800",
  },
  deadline_overdue: {
    label: "기한 도과",
    chip: "bg-red-50 text-red-700 ring-1 ring-red-200",
    strip: "bg-red-50/70 text-red-700",
  },
  system: {
    label: "시스템",
    chip: "bg-slate-100 text-slate-600 ring-1 ring-slate-200",
    strip: "bg-slate-50 text-slate-600",
  },
};

const CATEGORIES: { key: string; label: string }[] = [
  { key: "", label: "전체" },
  { key: "correction_new", label: "보정·명령 도착" },
  { key: "progress_update", label: "진행내역 변경" },
  { key: "status_change", label: "단계 변경" },
  { key: "deadline", label: "기한 임박·도과" },
];

function matchCategory(type: NotificationType, key: string): boolean {
  if (!key) return true;
  if (key === "deadline") return type === "deadline_approaching" || type === "deadline_overdue";
  return type === key;
}

// 날짜별 그룹핑 — created_at(UTC)을 로컬 날짜 기준으로 묶는다
const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];

function localDateKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function dateGroupLabel(key: string): string {
  const now = new Date();
  if (key === localDateKey(now)) return "오늘";
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (key === localDateKey(yesterday)) return "어제";
  const [y, m, d] = key.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  return `${y === now.getFullYear() ? "" : `${y}년 `}${m}월 ${d}일 (${WEEKDAYS[dt.getDay()]})`;
}

export function ChangesPage({ refreshKey = 0, onCaseClick, onUnreadCountChange }: Props) {
  const [items, setItems] = useState<ChangeRow[]>([]);
  const [category, setCategory] = useState("");
  const [unreadOnly, setUnreadOnly] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const rows = await dbSelect<ChangeRow>(
        `SELECT n.id, n.case_id, n.type, n.priority, n.title, n.message,
                n.is_read, n.created_at,
                c.case_number, c.applicant_name, c.court_name, c.staff_name
         FROM notifications n
         LEFT JOIN cases c ON c.id = n.case_id
         WHERE n.user_id = ?
         ORDER BY n.created_at DESC
         LIMIT 300`,
        [user.id],
      );
      if (!alive) return;
      setItems(rows);
      onUnreadCountChange?.(rows.filter((r) => !r.is_read).length);
    })();
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshKey]);

  const unreadCount = useMemo(() => items.filter((r) => !r.is_read).length, [items]);

  const counts = useMemo(() => {
    const map: Record<string, number> = {};
    for (const cat of CATEGORIES) {
      map[cat.key] = items.filter((r) => matchCategory(r.type, cat.key)).length;
    }
    return map;
  }, [items]);

  const visible = useMemo(
    () => items.filter((r) => matchCategory(r.type, category) && (!unreadOnly || !r.is_read)),
    [items, category, unreadOnly],
  );

  // 날짜별 그룹 — visible이 created_at 내림차순이라 그룹도 최신 날짜(오늘)부터
  const groups = useMemo(() => {
    const map = new Map<string, ChangeRow[]>();
    for (const n of visible) {
      const key = localDateKey(new Date(n.created_at));
      const arr = map.get(key);
      if (arr) arr.push(n);
      else map.set(key, [n]);
    }
    return Array.from(map.entries());
  }, [visible]);

  async function handleMarkOne(id: string) {
    await markNotificationAsRead(id);
    setItems((prev) => {
      const next = prev.map((r) => (r.id === id ? { ...r, is_read: 1 } : r));
      onUnreadCountChange?.(next.filter((r) => !r.is_read).length);
      return next;
    });
  }

  async function handleMarkAll() {
    await markAllNotificationsAsRead();
    setItems((prev) => prev.map((r) => ({ ...r, is_read: 1 })));
    onUnreadCountChange?.(0);
  }

  function handleCardClick(n: ChangeRow) {
    if (!n.is_read) handleMarkOne(n.id);
    if (n.case_id && onCaseClick) onCaseClick(n.case_id);
  }

  return (
    <div className="p-6 md:p-8 space-y-5 max-w-[980px] mx-auto">
      {/* 헤더 */}
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold text-slate-900 tracking-tight flex items-baseline gap-2">
          변동사항
          <span className="text-xs font-normal text-slate-400">법원에서 감지된 새 소식</span>
        </h1>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setUnreadOnly((v) => !v)}
            className={`px-3 py-1.5 rounded-full text-xs font-medium transition-all shadow-sm ${
              unreadOnly
                ? "bg-blue-600 text-white"
                : "bg-white text-slate-500 hover:shadow-md"
            }`}
          >
            안 읽은 것만 {unreadCount > 0 && <span className="font-bold tabular-nums">{unreadCount}</span>}
          </button>
          {unreadCount > 0 && (
            <button
              onClick={handleMarkAll}
              className="px-3 py-1.5 rounded-full text-xs font-medium text-slate-500 bg-white shadow-sm hover:shadow-md transition-all"
            >
              전체 읽음
            </button>
          )}
        </div>
      </div>

      {/* 카테고리 필터 (로토매틱 스타일 알약) */}
      <div className="flex items-center gap-2 flex-wrap">
        {CATEGORIES.map((cat) => {
          const active = category === cat.key;
          const count = counts[cat.key] ?? 0;
          if (cat.key && count === 0) return null;
          return (
            <button
              key={cat.key}
              onClick={() => setCategory(cat.key)}
              className={`inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full text-[12px] font-medium transition-all ${
                active
                  ? "bg-blue-600 text-white shadow-sm"
                  : "bg-white text-slate-600 shadow-sm hover:shadow-md"
              }`}
            >
              {cat.label}
              <span
                className={`min-w-[20px] h-4.5 px-1.5 rounded-full text-[11px] font-semibold tabular-nums flex items-center justify-center ${
                  active ? "bg-white/20 text-white" : "bg-blue-50 text-blue-600"
                }`}
              >
                {count}
              </span>
            </button>
          );
        })}
      </div>

      {/* 카드 리스트 */}
      {visible.length === 0 ? (
        <div className="bg-white rounded-2xl shadow-sm p-8">
          <EmptyState
            icon="📡"
            message={unreadOnly ? "안 읽은 변동사항이 없어요" : "감지된 변동사항이 없어요"}
            description="크롤링으로 법원에서 새 소식이 잡히면 여기에 표시됩니다."
          />
        </div>
      ) : (
        <div className="space-y-6">
          {groups.map(([dateKey, groupItems]) => {
            const label = dateGroupLabel(dateKey);
            const isToday = label === "오늘";
            return (
              <div key={dateKey} className="space-y-2.5">
                {/* 날짜 헤더 */}
                <div className="flex items-center gap-3 pt-1">
                  <span className={`text-[12px] font-semibold ${isToday ? "text-blue-600" : "text-slate-500"}`}>
                    {label}
                  </span>
                  <span className="text-[11px] text-slate-400 tabular-nums">{groupItems.length}건</span>
                  <div className="flex-1 h-px bg-slate-200" />
                </div>
                {groupItems.map((n) => {
                  const meta = TYPE_META[n.type] || TYPE_META.system;
                  const unread = !n.is_read;
                  return (
              <button
                key={n.id}
                onClick={() => handleCardClick(n)}
                className={`w-full text-left bg-white rounded-2xl p-4 shadow-sm transition-all hover:shadow-md ${
                  unread ? "ring-2 ring-blue-200" : ""
                }`}
              >
                {/* 뱃지 줄 */}
                <div className="flex items-center gap-1.5">
                  <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] font-semibold ${meta.chip}`}>
                    {meta.label}
                  </span>
                  {n.priority === "urgent" && (
                    <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-red-500 text-white">
                      긴급
                    </span>
                  )}
                  <span className="ml-auto inline-flex items-center gap-2">
                    {unread && (
                      <>
                        <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-blue-600">
                          <span className="relative flex h-2 w-2">
                            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75" />
                            <span className="relative inline-flex rounded-full h-2 w-2 bg-blue-500" />
                          </span>
                          새 소식
                        </span>
                        <span
                          role="button"
                          onClick={(e) => { e.stopPropagation(); handleMarkOne(n.id); }}
                          className="text-[11px] text-slate-400 hover:text-blue-600 transition-colors"
                        >
                          읽음 처리
                        </span>
                      </>
                    )}
                  </span>
                </div>

                {/* 사건 정보 줄 */}
                <div className="mt-2.5 flex items-baseline gap-2 flex-wrap">
                  <span className="text-[14px] font-semibold text-slate-900">
                    {n.applicant_name || n.title}
                  </span>
                  {n.court_name && <span className="text-[12px] text-slate-500">{n.court_name}</span>}
                  {n.case_number && (
                    <span className="text-[12px] font-mono text-blue-600">{n.case_number}</span>
                  )}
                </div>
                {n.staff_name && (
                  <div className="mt-1 text-[11px] text-slate-400">
                    담당자 <span className="text-slate-600 font-medium">{n.staff_name}</span>
                  </div>
                )}

                {/* 내용 스트립 (로토매틱 하단 줄 스타일) */}
                <div className={`mt-3 flex items-center gap-3 rounded-lg px-3 py-2 text-[12px] ${meta.strip}`}>
                  <span className="font-semibold shrink-0">{n.title}</span>
                  <span className="flex-1 truncate opacity-80" title={n.message}>{n.message}</span>
                  <span className="shrink-0 opacity-70">{relativeTime(n.created_at)}</span>
                </div>
              </button>
                  );
                })}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
