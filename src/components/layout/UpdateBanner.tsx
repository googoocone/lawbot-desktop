import { useEffect, useState } from "react";
import { Download, Loader2, X } from "lucide-react";
import {
  checkForUpdate,
  downloadAndInstall,
  restartApp,
  type UpdateInfo,
  type DownloadProgress,
} from "@/lib/updater";

type Phase = "idle" | "available" | "working" | "done" | "error";

export function UpdateBanner() {
  const [info, setInfo] = useState<UpdateInfo | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [progress, setProgress] = useState<DownloadProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState(false);

  // 앱 시작 시 한 번 확인
  useEffect(() => {
    (async () => {
      const found = await checkForUpdate();
      if (found) {
        setInfo(found);
        setPhase("available");
      }
    })();
  }, []);

  if (phase === "idle" || dismissed || !info) return null;

  async function handleUpdate() {
    setPhase("working");
    setError(null);
    const { error: err } = await downloadAndInstall((p) => setProgress(p));
    if (err) {
      setError(err);
      setPhase("error");
      return;
    }
    setPhase("done");
    // 잠깐 "완료" 보여준 뒤 재시작
    setTimeout(() => { restartApp(); }, 800);
  }

  const pct =
    progress && progress.total
      ? Math.min(100, Math.round((progress.downloaded / progress.total) * 100))
      : null;

  return (
    <div className="px-5 py-2.5 bg-blue-600 text-white flex items-center gap-3 text-sm">
      <Download className="w-4 h-4 shrink-0" />

      {phase === "available" && (
        <>
          <span className="flex-1">
            새 버전 <b>{info.version}</b>이 있습니다.
            <span className="opacity-80 ml-1">(현재 {info.currentVersion})</span>
          </span>
          <button
            onClick={handleUpdate}
            className="px-3 py-1 rounded-md bg-white text-blue-700 text-xs font-semibold hover:bg-blue-50 transition-colors"
          >
            지금 업데이트
          </button>
          <button
            onClick={() => setDismissed(true)}
            className="p-1 rounded hover:bg-white/15 transition-colors"
            title="나중에"
          >
            <X className="w-4 h-4" />
          </button>
        </>
      )}

      {phase === "working" && (
        <>
          <Loader2 className="w-4 h-4 animate-spin shrink-0" />
          <span className="flex-1">
            {progress?.stage === "installing"
              ? "설치 중..."
              : `다운로드 중...${pct != null ? ` ${pct}%` : ""}`}
          </span>
          {pct != null && (
            <div className="w-32 h-1.5 rounded-full bg-white/25 overflow-hidden">
              <div className="h-full bg-white transition-all" style={{ width: `${pct}%` }} />
            </div>
          )}
        </>
      )}

      {phase === "done" && (
        <span className="flex-1">업데이트 완료 — 앱을 재시작합니다...</span>
      )}

      {phase === "error" && (
        <>
          <span className="flex-1 text-red-100">⚠ 업데이트 실패: {error}</span>
          <button
            onClick={handleUpdate}
            className="px-3 py-1 rounded-md bg-white text-blue-700 text-xs font-semibold hover:bg-blue-50 transition-colors"
          >
            다시 시도
          </button>
          <button
            onClick={() => setDismissed(true)}
            className="p-1 rounded hover:bg-white/15 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </>
      )}
    </div>
  );
}
