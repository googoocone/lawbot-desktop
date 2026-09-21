import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!url || !anonKey) {
  throw new Error(
    "VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY 환경변수가 설정되지 않았습니다. " +
      ".env 파일을 확인하세요 (참고: .env.example).",
  );
}

export const supabase = createClient(url, anonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
  },
  realtime: {
    params: { eventsPerSecond: 20 },
  },
});

/**
 * 로컬에 저장된 세션의 사용자. getUser()는 매번 Supabase 서버에 물어보는 네트워크 호출이라
 * 오프라인이면 실패하고 리로드마다 부르기엔 느리다. id·이메일만 필요하면 이걸 쓴다.
 */
export async function getSessionUser() {
  const { data: { session } } = await supabase.auth.getSession();
  return session?.user ?? null;
}
