import { useState, useEffect, useRef } from "react";
import { Settings, Power, Check } from "lucide-react";
import { isEnabled, enable, disable } from "@tauri-apps/plugin-autostart";

export function SettingsMenu() {
  const [open, setOpen] = useState(false);
  const [autoStart, setAutoStart] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    isEnabled()
      .then(setAutoStart)
      .catch(() => setAutoStart(false));
  }, []);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  async function toggleAutoStart() {
    if (autoStart === null || busy) return;
    setBusy(true);
    try {
      if (autoStart) {
        await disable();
        setAutoStart(false);
      } else {
        await enable();
        setAutoStart(true);
      }
    } catch (e) {
      console.error("[autostart] toggle failed", e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center justify-center w-8 h-8 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-md transition"
        title="설정"
      >
        <Settings className="w-4 h-4" />
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1 w-[260px] bg-white rounded-xl shadow-2xl ring-1 ring-gray-200 overflow-hidden z-50">
          <div className="px-4 py-3 border-b border-gray-100">
            <div className="text-sm font-semibold text-gray-900">설정</div>
          </div>
          <div className="p-2">
            <button
              onClick={toggleAutoStart}
              disabled={autoStart === null || busy}
              className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-gray-50 transition-colors text-left disabled:opacity-60"
            >
              <Power className="w-4 h-4 text-slate-400 flex-shrink-0" />
              <div className="flex-1">
                <div className="text-sm text-gray-800">OS 부팅 시 자동 시작</div>
                <div className="text-[11px] text-gray-400">
                  Windows 켜질 때 자동 실행 (직원 PC 권장)
                </div>
              </div>
              <div className={`relative w-9 h-5 rounded-full transition-colors ${
                autoStart ? "bg-blue-500" : "bg-gray-200"
              }`}>
                <span className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full shadow-sm transition-transform ${
                  autoStart ? "translate-x-4" : ""
                }`}>
                  {autoStart && (
                    <Check className="w-3 h-3 text-blue-500 absolute top-0.5 left-0.5" />
                  )}
                </span>
              </div>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
