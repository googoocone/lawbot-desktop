// 중앙 크롤링 서버(lawbot-crawler) HTTP 호출 헬퍼.
// 크롤러는 서버에서 service_role로 Supabase에 직접 쓰고, 결과는 Realtime으로 앱에 반영된다.

const BASE_URL = import.meta.env.VITE_CRAWLER_URL;
const SECRET = import.meta.env.VITE_CRAWLER_SECRET;

export interface CrawlResult {
  ok: boolean;
  stdout: string;
  stderr: string;
  exitCode: number | null;
}

async function post(path: string, body: Record<string, unknown>): Promise<CrawlResult> {
  if (!BASE_URL) {
    return {
      ok: false,
      stdout: "",
      stderr: "크롤러 서버 주소(VITE_CRAWLER_URL)가 빌드에 설정되지 않았습니다.",
      exitCode: null,
    };
  }
  try {
    const res = await fetch(`${BASE_URL}${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(SECRET ? { Authorization: `Bearer ${SECRET}` } : {}),
      },
      body: JSON.stringify(body),
    });
    const text = await res.text();
    return {
      ok: res.ok,
      stdout: text,
      stderr: res.ok ? "" : `HTTP ${res.status}: ${text}`,
      exitCode: res.status,
    };
  } catch (e) {
    return {
      ok: false,
      stdout: "",
      stderr: e instanceof Error ? e.message : String(e),
      exitCode: null,
    };
  }
}

/** 단일 사건 크롤링 — 등록 직후 or 수동 트리거 */
export async function crawlSingleCase(caseId: string): Promise<CrawlResult> {
  return post("/trigger/case", { case_id: caseId });
}

/** 다수 사건 — 서버 배치 큐에 추가 (순차 처리, /status로 진행률 확인 가능) */
export async function crawlCases(caseIds: string[]): Promise<CrawlResult> {
  if (caseIds.length === 0) {
    return { ok: true, stdout: "", stderr: "", exitCode: 0 };
  }
  return post("/trigger/batch", { case_ids: caseIds });
}

/** 전체 크롤링 트리거 (서버는 firm 구분 없이 cf_cases 전체를 돈다) */
export async function crawlFirm(firmId: string, opts?: { workers?: number }): Promise<CrawlResult> {
  return post("/trigger", { firm_id: firmId, max_workers: opts?.workers ?? null });
}
