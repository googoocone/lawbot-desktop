// 자동 업데이트 (GitHub Releases + tauri-plugin-updater)
// 앱 시작 시 check() → 새 버전 있으면 배너 표시 → 사용자가 누르면 다운로드·설치·재시작.
import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";

export interface UpdateInfo {
  version: string;
  currentVersion: string;
  notes: string | null;
}

export type DownloadProgress = {
  stage: "idle" | "downloading" | "installing" | "done";
  downloaded: number;
  total: number | null;
};

let pendingUpdate: Update | null = null;

// 업데이트 확인 — 있으면 정보 반환, 없거나 dev/브라우저면 null
export async function checkForUpdate(): Promise<UpdateInfo | null> {
  // dev 빌드는 버전이 항상 0.1.0(tauri.conf.json)이라 릴리스보다 낮게 인식돼
  // 켤 때마다 업데이트 배너가 뜬다. 개발 중엔 체크 자체를 건너뛴다.
  // (프로덕션 빌드에선 import.meta.env.DEV === false 라 정상 동작)
  if (import.meta.env.DEV) return null;
  try {
    const update = await check();
    if (!update) return null;
    pendingUpdate = update;
    return {
      version: update.version,
      currentVersion: update.currentVersion,
      notes: update.body ?? null,
    };
  } catch (e) {
    // Tauri 컨텍스트가 아니거나(브라우저 dev), 네트워크/엔드포인트 문제 — 조용히 무시
    console.warn("[updater] check failed:", e);
    return null;
  }
}

// 다운로드 + 설치. onProgress로 진행률 콜백. 완료 후 호출측에서 restartApp() 호출.
export async function downloadAndInstall(
  onProgress?: (p: DownloadProgress) => void,
): Promise<{ error?: string }> {
  if (!pendingUpdate) return { error: "설치할 업데이트가 없습니다." };
  try {
    let downloaded = 0;
    let total: number | null = null;
    await pendingUpdate.downloadAndInstall((event) => {
      switch (event.event) {
        case "Started":
          total = event.data.contentLength ?? null;
          onProgress?.({ stage: "downloading", downloaded: 0, total });
          break;
        case "Progress":
          downloaded += event.data.chunkLength;
          onProgress?.({ stage: "downloading", downloaded, total });
          break;
        case "Finished":
          onProgress?.({ stage: "installing", downloaded, total });
          break;
      }
    });
    onProgress?.({ stage: "done", downloaded, total });
    return {};
  } catch (e: any) {
    console.error("[updater] install failed:", e);
    return { error: e?.message ?? String(e) };
  }
}

// 설치 완료 후 앱 재시작 (새 버전으로 부팅)
export async function restartApp(): Promise<void> {
  await relaunch();
}
