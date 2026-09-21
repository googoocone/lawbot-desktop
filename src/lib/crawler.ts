// 중앙 크롤링 서버(lawbot-crawler) HTTP 호출 헬퍼.
// 크롤러는 서버에서 service_role로 Supabase에 직접 쓰고, 결과는 Realtime으로 앱에 반영된다.
//
// 인증: 로그인한 Supabase 세션의 access token(JWT)을 Bearer로 보낸다. 서버는 Supabase Auth에 토큰을
// 검증하고 요청한 사건이 그 사용자의 firm 소속인지 확인한다. 앱 번들에 공유 시크릿을 넣지 않는다
// (예전 VITE_CRAWLER_SECRET 방식은 설치파일에서 시크릿을 꺼내 전체 크롤링을 돌릴 수 있었다).
import { supabase } from "@/lib/supabase";

const BASE_URL = import.meta.env.VITE_CRAWLER_URL;

export interface CrawlResult {
  ok: boolean;
  /** 서버 응답 본문 (성공 시) */
  message: string;
  /** 사용자에게 보여줄 실패 사유 (실패 시) */
  error: string;
  status: number | null;
}

function fail(error: string, status: number | null = null): CrawlResult {
  return { ok: false, message: "", error, status };
}

async function post(path: string, body: Record<string, unknown>): Promise<CrawlResult> {
  if (!BASE_URL) {
    return fail("크롤러 서버 주소(VITE_CRAWLER_URL)가 빌드에 설정되지 않았습니다.");
  }
  const { data: { session } } = await supabase.auth.getSession();
  const token = session?.access_token;
  if (!token) return fail("로그인 세션이 없어 크롤링을 요청할 수 없습니다.");

  try {
    const res = await fetch(`${BASE_URL}${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(body),
    });
    const text = await res.text();
    if (!res.ok) return fail(`HTTP ${res.status}: ${text}`, res.status);
    return { ok: true, message: text, error: "", status: res.status };
  } catch (e) {
    return fail(e instanceof Error ? e.message : String(e));
  }
}

/** 단일 사건 크롤링 — 등록 직후 or 수동 트리거 */
export async function crawlSingleCase(caseId: string): Promise<CrawlResult> {
  return post("/trigger/case", { case_id: caseId });
}

/** 다수 사건 — 서버 배치 큐에 추가 (순차 처리, /status로 진행률 확인 가능) */
export async function crawlCases(caseIds: string[]): Promise<CrawlResult> {
  if (caseIds.length === 0) {
    return { ok: true, message: "", error: "", status: 0 };
  }
  return post("/trigger/batch", { case_ids: caseIds });
}
