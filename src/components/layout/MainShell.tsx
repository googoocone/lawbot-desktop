import { Bot, LogOut, RefreshCw, List, Calendar, FilePlus, Bell } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { SettingsMenu } from "./SettingsMenu";
import { UpdateBanner } from "./UpdateBanner";

export type ShellTab = "list" | "changes" | "calendar" | "register";
export type LiveStatus = "idle" | "subscribing" | "ready" | "error" | null;

interface MainShellProps {
  email: string;
  children: React.ReactNode;
  onSync?: () => void;
  syncing?: boolean;
  /** undefined면 탭 표시 안 함 (상세 페이지 등 단독 화면) */
  activeTab?: ShellTab;
  onTabChange?: (tab: ShellTab) => void;
  liveStatus?: LiveStatus;
  /** 변동사항 탭에 표시할 미읽음 건수 */
  changesBadge?: number;
}

export function MainShell({
  email, children, onSync, syncing, activeTab, onTabChange, liveStatus, changesBadge,
}: MainShellProps) {
  async function handleSignOut() {
    await supabase.auth.signOut();
  }

  return (
    // h-screen 고정 — 페이지 전체 스크롤을 막고, 스크롤은 각 화면 내부(main 또는 리스트)에만 생기게 한다
    <div className="h-screen overflow-hidden bg-[#eef1f8] flex flex-col">
      <header className="bg-white border-b border-slate-200 flex-shrink-0">
        <div className="flex items-center justify-between px-5 h-12">
          <div className="flex items-center gap-4 self-stretch">
            <div className="flex items-center gap-2">
              <div className="w-6.5 h-6.5 rounded-md bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center">
                <Bot className="w-3.5 h-3.5 text-white" strokeWidth={2.2} />
              </div>
              <div className="text-[13px] font-semibold text-slate-900 tracking-tight">
                law-bot 사건관리
              </div>
            </div>

            {activeTab && onTabChange && (
              <div className="flex items-stretch gap-1 ml-2 self-stretch">
                <TabButton
                  active={activeTab === "list"}
                  icon={<List className="w-3.5 h-3.5" />}
                  label="사건 목록"
                  onClick={() => onTabChange("list")}
                />
                <TabButton
                  active={activeTab === "changes"}
                  icon={<Bell className="w-3.5 h-3.5" />}
                  label="변동사항"
                  badge={changesBadge}
                  onClick={() => onTabChange("changes")}
                />
                <TabButton
                  active={activeTab === "calendar"}
                  icon={<Calendar className="w-3.5 h-3.5" />}
                  label="달력"
                  onClick={() => onTabChange("calendar")}
                />
                <TabButton
                  active={activeTab === "register"}
                  icon={<FilePlus className="w-3.5 h-3.5" />}
                  label="사건 등록"
                  onClick={() => onTabChange("register")}
                />
              </div>
            )}
          </div>

          <div className="flex items-center gap-2">
            {liveStatus && <LiveIndicator status={liveStatus} />}

            {onSync && (
              <button
                onClick={onSync}
                disabled={syncing}
                className="inline-flex items-center gap-1.5 px-2.5 h-7 text-xs font-medium text-slate-500 hover:text-slate-900 hover:bg-slate-100 disabled:opacity-50 rounded-md transition"
                title="동기화"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${syncing ? "animate-spin" : ""}`} />
                {syncing ? "동기화 중..." : "새로고침"}
              </button>
            )}

            <div className="h-4 w-px bg-slate-200 mx-1" />

            <SettingsMenu />

            <span className="text-xs text-slate-400">{email}</span>
            <button
              onClick={handleSignOut}
              className="inline-flex items-center justify-center w-7 h-7 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-md transition"
              title="로그아웃"
            >
              <LogOut className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </header>

      <UpdateBanner />

      <main className="flex-1 min-h-0 overflow-auto flex flex-col">{children}</main>
    </div>
  );
}

function LiveIndicator({ status }: { status: LiveStatus }) {
  if (!status || status === "idle") return null;
  const config = {
    ready: { dot: "bg-emerald-500", ring: "bg-emerald-400", text: "text-emerald-600", label: "실시간" },
    subscribing: { dot: "bg-amber-400", ring: "bg-amber-300", text: "text-amber-600", label: "연결 중" },
    error: { dot: "bg-red-500", ring: "bg-red-400", text: "text-red-600", label: "연결 끊김" },
  }[status];
  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2.5 h-8 text-[11px] font-semibold rounded-md ${config.text}`}
      title={`Supabase Realtime: ${config.label}`}
    >
      <span className="relative flex h-2 w-2">
        {status === "ready" && (
          <span className={`animate-ping absolute inline-flex h-full w-full rounded-full ${config.ring} opacity-75`} />
        )}
        <span className={`relative inline-flex rounded-full h-2 w-2 ${config.dot}`} />
      </span>
      {config.label}
    </span>
  );
}

function TabButton({
  active, icon, label, badge, onClick,
}: {
  active: boolean;
  icon: React.ReactNode;
  label: string;
  badge?: number;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 px-3 text-xs transition-colors border-b-2 -mb-px ${
        active
          ? "text-blue-600 border-blue-600 font-semibold"
          : "text-slate-500 border-transparent font-medium hover:text-slate-900"
      }`}
    >
      {icon}
      {label}
      {badge != null && badge > 0 && (
        <span className="min-w-[16px] h-4 px-1 bg-red-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center">
          {badge > 99 ? "99+" : badge}
        </span>
      )}
    </button>
  );
}
