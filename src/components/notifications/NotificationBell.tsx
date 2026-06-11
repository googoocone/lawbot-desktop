import { useState, useEffect, useRef } from "react";
import { Bell, X } from "lucide-react";
import { dbSelect } from "@/lib/db";
import { markNotificationAsRead, markAllNotificationsAsRead } from "@/lib/actions/local";
import { NOTIFICATION_TYPE_ICONS } from "@/lib/caseflow/constants/status";
import { relativeTime } from "@/lib/caseflow/utils/date";
import { EmptyState } from "@/components/ui/EmptyState";
import { supabase } from "@/lib/supabase";
import type { NotificationType, NotificationPriority } from "@/lib/caseflow/types";

interface NotificationRow {
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
}

interface Props {
  refreshKey?: number;
  onCaseClick?: (caseId: string) => void;
}

export function NotificationBell({ refreshKey = 0, onCaseClick }: Props) {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<NotificationRow[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const rows = await dbSelect<NotificationRow>(
        `SELECT n.id, n.case_id, n.type, n.priority, n.title, n.message,
                n.is_read, n.created_at,
                c.case_number, c.applicant_name
         FROM notifications n
         LEFT JOIN cases c ON c.id = n.case_id
         WHERE n.user_id = ?
         ORDER BY n.created_at DESC
         LIMIT 50`,
        [user.id],
      );
      if (!alive) return;
      setItems(rows);
      setUnreadCount(rows.filter((r) => !r.is_read).length);
    })();
    return () => { alive = false; };
  }, [refreshKey]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  async function handleMarkOne(id: string) {
    await markNotificationAsRead(id);
    setItems((prev) => prev.map((r) => r.id === id ? { ...r, is_read: 1 } : r));
    setUnreadCount((c) => Math.max(0, c - 1));
  }

  async function handleMarkAll() {
    await markAllNotificationsAsRead();
    setItems((prev) => prev.map((r) => ({ ...r, is_read: 1 })));
    setUnreadCount(0);
  }

  function handleItemClick(n: NotificationRow) {
    if (!n.is_read) handleMarkOne(n.id);
    if (n.case_id && onCaseClick) {
      onCaseClick(n.case_id);
      setOpen(false);
    }
  }

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="relative inline-flex items-center justify-center w-8 h-8 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-md transition"
        title="알림"
      >
        <Bell className="w-4 h-4" />
        {unreadCount > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 px-1 bg-red-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center">
            {unreadCount > 99 ? "99+" : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1 w-[380px] bg-white rounded-xl shadow-2xl ring-1 ring-gray-200 overflow-hidden z-50">
          <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
            <div className="text-sm font-semibold text-gray-900">
              알림
              <span className="ml-2 text-xs font-normal text-gray-400">
                미읽음 {unreadCount} / 전체 {items.length}
              </span>
            </div>
            <div className="flex items-center gap-2">
              {unreadCount > 0 && (
                <button
                  onClick={handleMarkAll}
                  className="text-xs text-blue-600 hover:text-blue-800"
                >
                  전체 읽음
                </button>
              )}
              <button
                onClick={() => setOpen(false)}
                className="text-gray-400 hover:text-gray-600"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>

          <div className="max-h-[480px] overflow-y-auto">
            {items.length === 0 ? (
              <div className="p-4">
                <EmptyState
                  icon="🔔"
                  message="알림이 없습니다"
                  description="새 알림이 도착하면 여기에 표시됩니다."
                />
              </div>
            ) : (
              <div className="divide-y divide-gray-100">
                {items.map((n) => {
                  const icon = NOTIFICATION_TYPE_ICONS[n.type] || "📋";
                  const isUnread = !n.is_read;
                  return (
                    <button
                      key={n.id}
                      onClick={() => handleItemClick(n)}
                      className={`w-full text-left flex items-start gap-3 p-3.5 transition-colors ${
                        isUnread ? "bg-blue-50 hover:bg-blue-100" : "bg-white hover:bg-gray-50"
                      } ${n.case_id ? "cursor-pointer" : "cursor-default"}`}
                    >
                      <span className="text-xl flex-shrink-0 mt-0.5">{icon}</span>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <p className={`text-sm ${isUnread ? "text-gray-900 font-semibold" : "text-gray-700"}`}>
                            {n.title}
                          </p>
                          {n.priority === "urgent" && (
                            <span className="text-[10px] bg-red-100 text-red-700 px-1.5 py-0.5 rounded font-semibold">
                              긴급
                            </span>
                          )}
                        </div>
                        {(n.applicant_name || n.case_number) && (
                          <p className="text-[11px] text-gray-600 mt-0.5">
                            {n.applicant_name && (
                              <span className="font-medium">{n.applicant_name}</span>
                            )}
                            {n.case_number && (
                              <span className="ml-1.5 font-mono text-gray-400">
                                {n.case_number}
                              </span>
                            )}
                          </p>
                        )}
                        <p className="text-xs text-gray-500 mt-0.5 line-clamp-2">{n.message}</p>
                        <p className="text-[10px] text-gray-400 mt-1">{relativeTime(n.created_at)}</p>
                      </div>
                      {isUnread && (
                        <span
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            handleMarkOne(n.id);
                          }}
                          className="flex-shrink-0 text-[11px] text-blue-600 hover:text-blue-800 mt-1"
                          role="button"
                        >
                          읽음
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
