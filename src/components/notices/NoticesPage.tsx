import { useState, useEffect, useRef, useCallback } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Megaphone, Plus, Pencil, Trash2, ImagePlus, Loader2 } from "lucide-react";
import { EmptyState } from "@/components/ui/EmptyState";
import {
  listNotices, createNotice, updateNotice, deleteNotice, uploadNoticeImage,
  NOTICE_ADMIN_EMAIL, type Notice,
} from "@/lib/actions/notices";

// react-markdown 렌더 스타일 (typography 플러그인 없이 직접 매핑)
const md = {
  h1: ({ node, ...p }: any) => <h1 className="text-2xl font-bold text-slate-900 mt-6 mb-3 first:mt-0" {...p} />,
  h2: ({ node, ...p }: any) => <h2 className="text-xl font-bold text-slate-900 mt-5 mb-2.5" {...p} />,
  h3: ({ node, ...p }: any) => <h3 className="text-lg font-semibold text-slate-900 mt-4 mb-2" {...p} />,
  p: ({ node, ...p }: any) => <p className="text-[14px] leading-relaxed text-slate-700 my-2.5" {...p} />,
  ul: ({ node, ...p }: any) => <ul className="list-disc pl-6 my-2.5 space-y-1 text-[14px] text-slate-700" {...p} />,
  ol: ({ node, ...p }: any) => <ol className="list-decimal pl-6 my-2.5 space-y-1 text-[14px] text-slate-700" {...p} />,
  li: ({ node, ...p }: any) => <li className="leading-relaxed" {...p} />,
  a: ({ node, ...p }: any) => <a className="text-blue-600 hover:underline" target="_blank" rel="noreferrer" {...p} />,
  img: ({ node, ...p }: any) => <img className="max-w-full rounded-lg my-3 border border-slate-200" {...p} />,
  blockquote: ({ node, ...p }: any) => <blockquote className="border-l-4 border-slate-200 pl-4 my-3 text-slate-500 italic" {...p} />,
  code: ({ node, inline, ...p }: any) =>
    inline
      ? <code className="px-1.5 py-0.5 bg-slate-100 rounded text-[13px] font-mono text-rose-600" {...p} />
      : <code className="block p-3 bg-slate-900 text-slate-100 rounded-lg text-[13px] font-mono overflow-x-auto my-3" {...p} />,
  hr: () => <hr className="my-5 border-slate-200" />,
  strong: ({ node, ...p }: any) => <strong className="font-semibold text-slate-900" {...p} />,
  table: ({ node, ...p }: any) => <div className="overflow-x-auto my-3"><table className="border-collapse text-[13px]" {...p} /></div>,
  th: ({ node, ...p }: any) => <th className="border border-slate-200 px-3 py-1.5 bg-slate-50 font-semibold text-slate-700" {...p} />,
  td: ({ node, ...p }: any) => <td className="border border-slate-200 px-3 py-1.5 text-slate-700" {...p} />,
};

function fmt(iso: string) {
  const d = new Date(iso);
  return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, "0")}.${String(d.getDate()).padStart(2, "0")} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

type Mode = "view" | "edit" | "create";

export function NoticesPage({ email }: { email: string }) {
  const canWrite = (email || "").toLowerCase() === NOTICE_ADMIN_EMAIL;

  const [notices, setNotices] = useState<Notice[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>("view");

  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);

  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const reload = useCallback(async (keepId?: string) => {
    setLoading(true);
    const { data, error } = await listNotices();
    setLoading(false);
    if (error) { setError(error); return; }
    setNotices(data);
    setSelectedId((cur) => keepId ?? cur ?? (data[0]?.id ?? null));
  }, []);

  useEffect(() => { reload(); }, [reload]);

  const selected = notices.find((n) => n.id === selectedId) || null;

  function startCreate() {
    setMode("create"); setTitle(""); setBody(""); setError(null);
  }
  function startEdit() {
    if (!selected) return;
    setMode("edit"); setTitle(selected.title); setBody(selected.body); setError(null);
  }
  function cancelEdit() {
    setMode("view"); setError(null);
  }

  function insertAtCursor(text: string) {
    const ta = bodyRef.current;
    if (!ta) { setBody((b) => b + text); return; }
    const start = ta.selectionStart, end = ta.selectionEnd;
    setBody((b) => b.slice(0, start) + text + b.slice(end));
    requestAnimationFrame(() => {
      ta.focus();
      const pos = start + text.length;
      ta.setSelectionRange(pos, pos);
    });
  }

  async function handleFiles(files: File[]) {
    const imgs = files.filter((f) => f.type.startsWith("image/"));
    if (!imgs.length) return;
    setUploading(true); setError(null);
    for (const file of imgs) {
      const { url, error } = await uploadNoticeImage(file);
      if (error) { setError(`이미지 업로드 실패: ${error}`); break; }
      if (url) insertAtCursor(`\n![](${url})\n`);
    }
    setUploading(false);
  }

  function handlePaste(e: React.ClipboardEvent<HTMLTextAreaElement>) {
    const items = e.clipboardData?.items;
    if (!items) return;
    const files = Array.from(items).filter((i) => i.type.startsWith("image/")).map((i) => i.getAsFile()).filter(Boolean) as File[];
    if (!files.length) return;
    e.preventDefault();
    handleFiles(files);
  }

  async function handleSave() {
    if (!title.trim()) { setError("제목을 입력해주세요."); return; }
    setSaving(true); setError(null);
    const res = mode === "create"
      ? await createNotice({ title, body })
      : await updateNotice(selectedId!, { title, body });
    setSaving(false);
    if (res.error) { setError(res.error); return; }
    await reload(res.data?.id);
    setMode("view");
  }

  async function handleDelete(id: string) {
    setError(null);
    const { error } = await deleteNotice(id);
    if (error) { setError(error); return; }
    setPendingDelete(null);
    setSelectedId(null);
    await reload();
    setMode("view");
  }

  const editing = mode === "edit" || mode === "create";

  return (
    <div className="flex-1 min-h-0 flex flex-col p-6 md:p-8 max-w-[1400px] mx-auto w-full">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-lg font-semibold text-slate-900 tracking-tight flex items-center gap-2">
          <Megaphone className="w-5 h-5 text-blue-600" /> 공지사항
        </h1>
        {canWrite && !editing && (
          <button
            onClick={startCreate}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold transition-colors"
          >
            <Plus className="w-3.5 h-3.5" /> 새 공지
          </button>
        )}
      </div>

      {error && (
        <div className="mb-3 px-4 py-2 bg-red-50 border border-red-200 rounded-lg text-xs text-red-700 flex items-center justify-between">
          <span>{error}</span>
          <button onClick={() => setError(null)} className="text-red-400 hover:text-red-600">✕</button>
        </div>
      )}

      <div className="flex-1 min-h-0 flex gap-4">
        {/* 목록 */}
        <aside className="w-72 shrink-0 bg-white rounded-2xl shadow-sm overflow-hidden flex flex-col">
          <div className="px-4 py-3 border-b border-slate-100 text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
            전체 {notices.length}건
          </div>
          <div className="flex-1 overflow-auto">
            {loading ? (
              <div className="h-full flex items-center justify-center"><Loader2 className="w-4 h-4 text-slate-400 animate-spin" /></div>
            ) : notices.length === 0 ? (
              <div className="p-6 text-center text-xs text-slate-400">아직 공지가 없어요</div>
            ) : (
              notices.map((n) => {
                const active = n.id === selectedId && mode === "view";
                return (
                  <button
                    key={n.id}
                    onClick={() => { setSelectedId(n.id); setMode("view"); }}
                    className={`w-full text-left px-4 py-3 border-b border-slate-50 transition-colors ${active ? "bg-blue-50" : "hover:bg-slate-50"}`}
                  >
                    <p className={`text-[13px] font-medium truncate ${active ? "text-blue-700" : "text-slate-800"}`}>{n.title}</p>
                    <p className="text-[11px] text-slate-400 mt-0.5">{n.author_name || "관리자"} · {fmt(n.created_at)}</p>
                  </button>
                );
              })
            )}
          </div>
        </aside>

        {/* 본문 / 편집기 */}
        <section className="flex-1 min-h-0 bg-white rounded-2xl shadow-sm overflow-hidden flex flex-col">
          {editing ? (
            <div className="flex-1 min-h-0 flex flex-col">
              <div className="px-5 pt-5 pb-3 border-b border-slate-100">
                <input
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="공지 제목"
                  className="w-full text-lg font-semibold text-slate-900 placeholder:text-slate-300 focus:outline-none"
                />
              </div>
              <div className="flex items-center gap-2 px-5 py-2 border-b border-slate-100 bg-slate-50/60">
                <button
                  onClick={() => fileRef.current?.click()}
                  disabled={uploading}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium text-slate-600 hover:bg-slate-200/60 disabled:opacity-50 transition-colors"
                >
                  {uploading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ImagePlus className="w-3.5 h-3.5" />}
                  이미지 추가
                </button>
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/*"
                  multiple
                  className="hidden"
                  onChange={(e) => { handleFiles(Array.from(e.target.files ?? [])); e.target.value = ""; }}
                />
                <span className="text-[11px] text-slate-400">마크다운 지원 · 이미지는 붙여넣기(Ctrl+V)도 가능</span>
              </div>
              <div className="flex-1 min-h-0 grid grid-cols-1 md:grid-cols-2 divide-x divide-slate-100">
                <textarea
                  ref={bodyRef}
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  onPaste={handlePaste}
                  placeholder="# 제목&#10;&#10;내용을 마크다운으로 작성하세요.&#10;&#10;- 목록&#10;**굵게**, [링크](https://...)"
                  className="p-5 text-[14px] leading-relaxed text-slate-800 font-mono resize-none focus:outline-none min-h-0"
                />
                <div className="p-5 overflow-auto min-h-0">
                  {body.trim()
                    ? <Markdown remarkPlugins={[remarkGfm]} components={md}>{body}</Markdown>
                    : <p className="text-sm text-slate-300">미리보기</p>}
                </div>
              </div>
              <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-slate-100">
                <button onClick={cancelEdit} disabled={saving} className="px-4 py-2 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 text-sm font-medium transition-colors disabled:opacity-50">취소</button>
                <button onClick={handleSave} disabled={saving} className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold transition-colors disabled:opacity-60">
                  {saving && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                  {mode === "create" ? "등록" : "저장"}
                </button>
              </div>
            </div>
          ) : selected ? (
            <>
              <div className="flex items-start justify-between gap-4 px-6 pt-6 pb-4 border-b border-slate-100">
                <div className="min-w-0">
                  <h2 className="text-xl font-bold text-slate-900 break-words">{selected.title}</h2>
                  <p className="text-xs text-slate-400 mt-1">
                    {selected.author_name || "관리자"} · {fmt(selected.created_at)}
                    {selected.updated_at !== selected.created_at && <span className="ml-1">(수정됨 {fmt(selected.updated_at)})</span>}
                  </p>
                </div>
                {canWrite && (
                  <div className="flex items-center gap-1.5 shrink-0">
                    <button onClick={startEdit} className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md text-xs font-medium text-slate-600 hover:bg-slate-100 transition-colors"><Pencil className="w-3.5 h-3.5" /> 수정</button>
                    <button onClick={() => setPendingDelete(selected.id)} className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md text-xs font-medium text-red-600 hover:bg-red-50 transition-colors"><Trash2 className="w-3.5 h-3.5" /> 삭제</button>
                  </div>
                )}
              </div>
              <div className="flex-1 overflow-auto px-6 py-5">
                <div className="max-w-3xl">
                  {selected.body.trim()
                    ? <Markdown remarkPlugins={[remarkGfm]} components={md}>{selected.body}</Markdown>
                    : <p className="text-sm text-slate-400">내용이 없습니다.</p>}
                </div>
              </div>
            </>
          ) : (
            <div className="flex-1 flex items-center justify-center">
              <EmptyState
                icon="📢"
                message="공지사항이 없어요"
                description={canWrite ? "오른쪽 위 '새 공지'로 첫 공지를 작성해보세요." : "등록된 공지가 아직 없습니다."}
              />
            </div>
          )}
        </section>
      </div>

      {/* 삭제 확인 */}
      {pendingDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setPendingDelete(null)}>
          <div className="bg-white rounded-xl shadow-2xl w-[340px] overflow-hidden" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-3 px-5 py-4 bg-red-50 border-b border-red-100">
              <Trash2 className="w-5 h-5 text-red-500" />
              <h3 className="text-sm font-bold text-red-800">공지 삭제</h3>
            </div>
            <div className="px-5 py-4 space-y-4">
              <p className="text-sm text-slate-600">이 공지를 삭제할까요? 되돌릴 수 없습니다.</p>
              <div className="flex gap-2">
                <button onClick={() => setPendingDelete(null)} className="flex-1 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 text-sm font-medium rounded-lg transition-colors">취소</button>
                <button onClick={() => handleDelete(pendingDelete)} className="flex-1 py-2.5 bg-red-600 hover:bg-red-700 text-white text-sm font-semibold rounded-lg transition-colors">삭제</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
