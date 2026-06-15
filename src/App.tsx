import { useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { getDb, dbSelect } from "@/lib/db";
import { syncAll, ensureLocalDataOwner, type SyncProgress } from "@/lib/sync";
import { LoginScreen } from "@/components/auth/LoginScreen";
import { MainShell, type ShellTab } from "@/components/layout/MainShell";
import { CaseScheduleDashboard } from "@/components/cases/CaseScheduleDashboard";
import { CaseDetailPage } from "@/components/cases/CaseDetailPage";
import { CalendarPage } from "@/components/calendar/CalendarPage";
import { RegisterPage } from "@/components/register/RegisterPage";
import { CaseEditPage } from "@/components/cases/CaseEditPage";
import { ChangesPage } from "@/components/changes/ChangesPage";
import { loadCaseRows, type CaseRow } from "@/lib/caseflow/case-row";
import { subscribeRealtime, type RealtimeStatus } from "@/lib/realtime";

type AuthState =
  | { status: "loading" }
  | { status: "signed_out" }
  | { status: "signed_in"; email: string; name: string };

type View =
  | { kind: "list" }
  | { kind: "changes" }
  | { kind: "calendar" }
  | { kind: "register" }
  // from: 어느 탭에서 들어왔는지 — 뒤로가기/삭제 후 그 탭으로 복귀
  | { kind: "detail"; id: string; from: ShellTab }
  | { kind: "edit"; id: string; from: ShellTab };

function App() {
  const [auth, setAuth] = useState<AuthState>({ status: "loading" });
  const [view, setView] = useState<View>({ kind: "list" });
  const [syncing, setSyncing] = useState(false);
  const [syncProgress, setSyncProgress] = useState<SyncProgress | null>(null);
  const [syncResult, setSyncResult] = useState<string | null>(null);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [didInitialSync, setDidInitialSync] = useState(false);
  const [rows, setRows] = useState<CaseRow[]>([]);
  const [loadingRows, setLoadingRows] = useState(true);
  const [popupRow, setPopupRow] = useState<CaseRow | null>(null);
  const [rtStatus, setRtStatus] = useState<RealtimeStatus | null>(null);
  const [reloadTick, setReloadTick] = useState(0);
  const [unreadChanges, setUnreadChanges] = useState(0);
  // Realtime 재연결 감지용 — 끊긴 동안 놓친 변경분을 따라잡기 위해
  const rtIsReady = useRef(false);
  const rtWasEverReady = useRef(false);
  const syncingRef = useRef(false);

  useEffect(() => {
    (async () => {
      await getDb();
      const { data } = await supabase.auth.getSession();
      if (data.session) {
        const user = data.session.user;
        setAuth({
          status: "signed_in",
          email: user.email ?? "?",
          name: user.user_metadata?.full_name || user.user_metadata?.name || (user.email?.split("@")[0] ?? "?"),
        });
      } else {
        setAuth({ status: "signed_out" });
      }
    })();

    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session) {
        const user = session.user;
        setAuth({
          status: "signed_in",
          email: user.email ?? "?",
          name: user.user_metadata?.full_name || user.user_metadata?.name || (user.email?.split("@")[0] ?? "?"),
        });
      } else {
        setAuth({ status: "signed_out" });
      }
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (auth.status === "signed_in") {
      (async () => {
        // 다른 계정으로 로그인했으면 이전 계정의 로컬 미러를 비운다 (타 계정 사건 노출 방지).
        // 이 단계가 실패해도 목록 로드/동기화는 반드시 진행해야 무한 로딩에 빠지지 않는다.
        try {
          const { data: { user } } = await supabase.auth.getUser();
          if (user && (await ensureLocalDataOwner(user.id))) {
            console.log("[sync] 계정 변경 감지 — 로컬 데이터 초기화 후 풀 싱크");
          }
        } catch (e) {
          console.error("[init] ensureLocalDataOwner 실패 — 무시하고 진행:", e);
        }
        try {
          await reloadRows();
        } catch (e) {
          console.error("[init] reloadRows 실패:", e);
          setLoadingRows(false); // 어떤 경우에도 로딩 스피너는 해제
        }
        if (!didInitialSync) {
          setDidInitialSync(true);
          handleSync();
        }
      })();

      // Realtime 구독 — 다른 PC 변경이 즉시 반영
      const unsub = subscribeRealtime({
        onChange: () => reloadRows(),
        onStatus: (s) => {
          setRtStatus(s);
          // 끊겼다가 다시 연결되면 그 사이 서버 크롤링 등 놓친 변경분을 증분 동기화로 따라잡는다
          const ready = s.cases === "ready";
          if (ready && !rtIsReady.current && rtWasEverReady.current) {
            console.log("[realtime] reconnected — catching up via incremental sync");
            handleSync();
          }
          if (ready) rtWasEverReady.current = true;
          rtIsReady.current = ready;
        },
      });
      return () => unsub();
    }
    if (auth.status === "signed_out") {
      setDidInitialSync(false);
      setRows([]);
      setView({ kind: "list" });
      setRtStatus(null);
      rtIsReady.current = false;
      rtWasEverReady.current = false;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auth.status]);

  async function reloadRows() {
    setLoadingRows(true);
    try {
      const t0 = performance.now();
      const data = await loadCaseRows();
      const ms = Math.round(performance.now() - t0);
      console.log(`[App] loaded ${data.length} rows from SQLite in ${ms}ms`);
      setRows(data);
    } finally {
      setLoadingRows(false);
      setReloadTick((t) => t + 1);
    }
  }

  // 변동사항 탭 뱃지용 미읽음 건수 — 데이터 리로드 때마다 갱신
  useEffect(() => {
    if (auth.status !== "signed_in") { setUnreadChanges(0); return; }
    let alive = true;
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user || !alive) return;
      const r = await dbSelect<{ cnt: number }>(
        "SELECT COUNT(*) AS cnt FROM notifications WHERE user_id = ? AND is_read = 0",
        [user.id],
      );
      if (alive) setUnreadChanges(r[0]?.cnt ?? 0);
    })();
    return () => { alive = false; };
  }, [auth.status, reloadTick]);

  async function handleSync() {
    // state(syncing)는 구독 콜백의 stale closure에서 옛 값을 볼 수 있어 ref로 중복 실행을 막는다
    if (syncingRef.current) return;
    syncingRef.current = true;
    setSyncing(true);
    setSyncProgress(null);
    setSyncResult(null);
    setSyncError(null);
    try {
      const result = await syncAll((p) => setSyncProgress(p));
      console.log("[sync] done", result);
      setSyncResult(`사건 ${result.cases} · 보정 ${result.corrections} · 연장 ${result.extensions} · 프로필 ${result.profiles} (${result.elapsedMs}ms)`);
      await reloadRows();
    } catch (e: any) {
      console.error("[sync] failed", e);
      setSyncError(e?.message ?? String(e));
    } finally {
      syncingRef.current = false;
      setSyncing(false);
      setSyncProgress(null);
    }
  }

  if (auth.status === "loading") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <Loader2 className="w-6 h-6 text-slate-400 animate-spin" />
      </div>
    );
  }

  if (auth.status === "signed_out") return <LoginScreen />;

  const live = rtStatus?.cases ?? null;

  // 상세 화면 — 들어온 탭을 유지한 채 표시, 뒤로가기는 그 탭으로
  if (view.kind === "detail") {
    const from = view.from;
    return (
      <MainShell
        email={auth.email}
        onSync={handleSync}
        syncing={syncing}
        activeTab={from}
        onTabChange={(t) => setView({ kind: t })}
        liveStatus={live}
        changesBadge={unreadChanges}
      >
        <CaseDetailPage
          caseId={view.id}
          onBack={() => setView({ kind: from })}
          onDeleted={() => { setView({ kind: from }); reloadRows(); }}
          onMutate={reloadRows}
          onEdit={() => setView({ kind: "edit", id: view.id, from })}
        />
      </MainShell>
    );
  }

  // 수정 화면
  if (view.kind === "edit") {
    const from = view.from;
    return (
      <MainShell
        email={auth.email}
        onSync={handleSync}
        syncing={syncing}
        activeTab={from}
        onTabChange={(t) => setView({ kind: t })}
        liveStatus={live}
        changesBadge={unreadChanges}
      >
        <CaseEditPage
          caseId={view.id}
          onBack={() => setView({ kind: "detail", id: view.id, from })}
          onSaved={() => { setView({ kind: "detail", id: view.id, from }); reloadRows(); }}
        />
      </MainShell>
    );
  }

  // 변동사항 화면 — 크롤링으로 감지된 새 소식만 모아보기
  if (view.kind === "changes") {
    return (
      <MainShell
        email={auth.email}
        onSync={handleSync}
        syncing={syncing}
        activeTab="changes"
        onTabChange={(t) => setView({ kind: t })}
        liveStatus={live}
        changesBadge={unreadChanges}
      >
        <ChangesPage
          refreshKey={reloadTick}
          onCaseClick={(id) => setView({ kind: "detail", id, from: "changes" })}
          onUnreadCountChange={setUnreadChanges}
        />
      </MainShell>
    );
  }

  // 달력 화면
  if (view.kind === "calendar") {
    return (
      <MainShell
        email={auth.email}
        onSync={handleSync}
        syncing={syncing}
        activeTab="calendar"
        onTabChange={(t) => setView({ kind: t })}
        liveStatus={live}
        changesBadge={unreadChanges}
      >
        <CalendarPage
          refreshKey={rows.length}
          onEventClick={(id) => setView({ kind: "detail", id, from: "calendar" })}
        />
      </MainShell>
    );
  }

  // 사건 등록 화면
  if (view.kind === "register") {
    return (
      <MainShell
        email={auth.email}
        onSync={handleSync}
        syncing={syncing}
        activeTab="register"
        onTabChange={(t) => setView({ kind: t })}
        liveStatus={live}
        changesBadge={unreadChanges}
      >
        <RegisterPage
          onBack={() => setView({ kind: "list" })}
          onCreated={reloadRows}
        />
      </MainShell>
    );
  }

  return (
    <MainShell
      email={auth.email}
      onSync={handleSync}
      syncing={syncing}
      activeTab="list"
      onTabChange={(t) => setView({ kind: t })}
      liveStatus={live}
      changesBadge={unreadChanges}
    >
      {/* 첫 동기화(로컬이 비어 1900건 전체를 받는 중) — 화면 가운데 진행률 */}
      {syncing && syncProgress && rows.length === 0 && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-50/85 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-xl px-10 py-8 flex flex-col items-center gap-4 w-[320px]">
            <div className="text-5xl font-bold text-blue-600 tabular-nums">{syncProgress.percent}%</div>
            <div className="w-full h-2 bg-slate-100 rounded-full overflow-hidden">
              <div
                className="h-full bg-blue-600 rounded-full transition-all duration-300"
                style={{ width: `${syncProgress.percent}%` }}
              />
            </div>
            <p className="text-sm font-medium text-slate-600">{syncProgress.stage} 불러오는 중...</p>
            <p className="text-xs text-slate-400">처음 한 번만 전체 사건을 내려받아요</p>
          </div>
        </div>
      )}
      {/* 증분 동기화(이미 데이터가 있을 때) — 상단 얇은 바 */}
      {syncing && syncProgress && rows.length > 0 && (
        <div className="px-5 py-2 bg-blue-50 border-b border-blue-100 text-xs text-blue-700 flex items-center gap-2">
          <Loader2 className="w-3 h-3 animate-spin" />
          {syncProgress.stage} 동기화 중...
          <span className="font-semibold tabular-nums">{syncProgress.percent}%</span>
        </div>
      )}
      {syncError && (
        <div className="px-5 py-2 bg-red-50 border-b border-red-200 text-xs text-red-700 flex items-center justify-between">
          <span>❌ 동기화 실패: {syncError}</span>
          <button onClick={() => setSyncError(null)} className="text-red-500 hover:text-red-700">✕</button>
        </div>
      )}
      {syncResult && !syncing && (
        <div className="px-5 py-2 bg-emerald-50 border-b border-emerald-200 text-xs text-emerald-700 flex items-center justify-between">
          <span>✅ {syncResult}</span>
          <button onClick={() => setSyncResult(null)} className="text-emerald-500 hover:text-emerald-700">✕</button>
        </div>
      )}

      {loadingRows && rows.length === 0 ? (
        <div className="h-full flex items-center justify-center">
          <Loader2 className="w-5 h-5 text-slate-400 animate-spin" />
        </div>
      ) : (
        <CaseScheduleDashboard
          allCases={rows}
          userName={auth.name}
          onRowClick={(id) => setView({ kind: "detail", id, from: "list" })}
          onPopupOpen={(row) => setPopupRow(row)}
          onCasesDeleted={reloadRows}
        />
      )}

      {/* 목록에서 보정기한 클릭 시 팝업 — 다음 턴에 import해서 사용 가능. 지금은 placeholder */}
      {popupRow && (
        <PopupOnList
          row={popupRow}
          onClose={() => setPopupRow(null)}
          onChanged={() => { setPopupRow(null); reloadRows(); }}
        />
      )}
    </MainShell>
  );
}

import { CorrectionPopup } from "@/components/cases/CorrectionPopup";

function PopupOnList({
  row, onClose, onChanged,
}: {
  row: CaseRow;
  onClose: () => void;
  onChanged: () => void;
}) {
  return (
    <CorrectionPopup
      data={{
        caseId: row.case_id,
        correctionId: row.correction_id,
        applicantName: row.applicant_name,
        caseNumber: row.case_number,
        documentType: row.document_type,
        receivedDate: row.received_date,
        deadlineDate: row.deadline_date,
        deadlineStatus: row.deadline_status,
        arrivalRaw: row.arrival_raw,
        extensions: row.extensions.map((e) => ({
          extension_number: e.extension_number,
          extension_date: e.extension_date,
        })),
      }}
      onClose={onClose}
      onSaved={onChanged}
    />
  );
}

export default App;
