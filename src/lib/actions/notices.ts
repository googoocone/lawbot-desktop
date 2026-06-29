// 공지사항 — Supabase cf_notices를 직접 읽고 쓴다 (로컬 SQLite 미러 없음, 소량 데이터).
// 작성/수정/삭제는 지정 이메일만 가능하며, Supabase RLS로도 서버단에서 강제된다.
import { supabase } from "@/lib/supabase";
import { getCurrentProfile } from "@/lib/actions/local";

/** 공지사항을 작성/수정/삭제할 수 있는 유일한 계정 */
export const NOTICE_ADMIN_EMAIL = "iycjdi0501@gmail.com";

export interface Notice {
  id: string;
  firm_id: string | null;
  title: string;
  body: string;
  author_id: string | null;
  author_name: string | null;
  created_at: string;
  updated_at: string;
}

/** 현재 로그인 계정이 공지를 쓸 수 있는지 (UI 게이팅용 — 서버는 RLS로 별도 차단) */
export async function canWriteNotices(): Promise<boolean> {
  const { data: { user } } = await supabase.auth.getUser();
  return (user?.email ?? "").toLowerCase() === NOTICE_ADMIN_EMAIL;
}

/** 우리 firm의 공지 목록 (최신순) */
export async function listNotices(): Promise<{ data: Notice[]; error?: string }> {
  const { data, error } = await supabase
    .from("cf_notices")
    .select("id, firm_id, title, body, author_id, author_name, created_at, updated_at")
    .order("created_at", { ascending: false });
  if (error) return { data: [], error: error.message };
  return { data: (data ?? []) as Notice[] };
}

export async function createNotice(
  input: { title: string; body: string },
): Promise<{ data?: Notice; error?: string }> {
  let profile;
  try { profile = await getCurrentProfile(); } catch (e: any) { return { error: e?.message }; }
  const { data, error } = await supabase
    .from("cf_notices")
    .insert({
      firm_id: profile.firm_id,
      title: input.title.trim(),
      body: input.body,
      author_id: profile.id,
      author_name: profile.name,
    })
    .select("id, firm_id, title, body, author_id, author_name, created_at, updated_at")
    .single();
  if (error) return { error: error.message };
  return { data: data as Notice };
}

export async function updateNotice(
  id: string,
  input: { title: string; body: string },
): Promise<{ data?: Notice; error?: string }> {
  const { data, error } = await supabase
    .from("cf_notices")
    .update({ title: input.title.trim(), body: input.body, updated_at: new Date().toISOString() })
    .eq("id", id)
    .select("id, firm_id, title, body, author_id, author_name, created_at, updated_at")
    .single();
  if (error) return { error: error.message };
  return { data: data as Notice };
}

export async function deleteNotice(id: string): Promise<{ error?: string }> {
  const { error } = await supabase.from("cf_notices").delete().eq("id", id);
  return error ? { error: error.message } : {};
}

const IMAGE_BUCKET = "notice-images";

/** 이미지를 Storage에 업로드하고 공개 URL을 반환. 본문엔 ![](url) 마크다운으로 삽입. */
export async function uploadNoticeImage(file: File): Promise<{ url?: string; error?: string }> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "인증이 필요합니다." };
  const ext = (file.name.split(".").pop() || "png").toLowerCase();
  // 충돌 없는 경로: userid/타임스탬프-랜덤.ext (Date/Math.random은 여기선 일반 코드라 사용 가능)
  const path = `${user.id}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
  const { error } = await supabase.storage
    .from(IMAGE_BUCKET)
    .upload(path, file, { cacheControl: "3600", upsert: false, contentType: file.type || undefined });
  if (error) return { error: error.message };
  const { data } = supabase.storage.from(IMAGE_BUCKET).getPublicUrl(path);
  return { url: data.publicUrl };
}
