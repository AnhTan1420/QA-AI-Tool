'use client';

import { useEffect, useRef, useState } from 'react';
import { createClient } from '@/lib/supabase/client';

type Comment = {
  id: string;
  content: string;
  created_at: string;
  user_id: string;
  profiles: { full_name: string | null; avatar_url: string | null } | null;
};

function initialsOf(name: string | null | undefined) {
  if (!name) return '?';
  return name.trim().slice(0, 1).toUpperCase();
}

export default function CommentsPanel({ testCaseId }: { testCaseId: string }) {
  const [comments, setComments] = useState<Comment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [draft, setDraft] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [isLive, setIsLive] = useState(false);
  const profileCache = useRef<Map<string, Comment['profiles']>>(new Map());
  const listEndRef = useRef<HTMLDivElement | null>(null);

  function upsertComment(comment: Comment) {
    setComments((prev) => {
      if (prev.some((c) => c.id === comment.id)) return prev;
      return [...prev, comment].sort((a, b) => a.created_at.localeCompare(b.created_at));
    });
  }

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError('');
      try {
        const res = await fetch(`/api/test-cases/${testCaseId}/comments`);
        const json = await res.json();
        if (!res.ok || !json.success) throw new Error(json.error ?? 'Không tải được comment');
        if (!cancelled) {
          const data: Comment[] = json.data ?? [];
          setComments(data);
          data.forEach((c) => profileCache.current.set(c.user_id, c.profiles));
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Không tải được comment');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [testCaseId]);

  // Realtime: lang nghe comment moi tu nguoi khac (va chinh minh) cho test case nay.
  useEffect(() => {
    const supabase = createClient();

    const channel = supabase
      .channel(`comments-${testCaseId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'comments', filter: `test_case_id=eq.${testCaseId}` },
        async (payload) => {
          const row = payload.new as { id: string; content: string; created_at: string; user_id: string };
          let profile = profileCache.current.get(row.user_id) ?? null;
          if (!profile) {
            const { data } = await supabase
              .from('profiles')
              .select('full_name, avatar_url')
              .eq('id', row.user_id)
              .maybeSingle();
            profile = data ?? null;
            profileCache.current.set(row.user_id, profile);
          }
          upsertComment({ ...row, profiles: profile });
        },
      )
      .subscribe((status) => setIsLive(status === 'SUBSCRIBED'));

    return () => {
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [testCaseId]);

  useEffect(() => {
    listEndRef.current?.scrollIntoView({ block: 'nearest' });
  }, [comments.length]);

  async function sendComment(e: React.FormEvent) {
    e.preventDefault();
    const content = draft.trim();
    if (!content) return;
    setIsSending(true);
    setError('');
    try {
      const res = await fetch(`/api/test-cases/${testCaseId}/comments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error ?? 'Không thể gửi comment');
      upsertComment(json.data);
      setDraft('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Không thể gửi comment');
    } finally {
      setIsSending(false);
    }
  }

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-6">
      <div className="mb-4 flex items-center gap-2">
        <svg className="h-4 w-4 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.86 9.86 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
        </svg>
        <h3 className="text-sm font-bold uppercase tracking-wider text-gray-700">Thảo luận</h3>
        {comments.length > 0 && (
          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-bold text-slate-500">{comments.length}</span>
        )}
        <span className={`ml-auto flex items-center gap-1.5 text-xs font-semibold ${isLive ? 'text-emerald-600' : 'text-gray-300'}`}>
          <span className={`h-1.5 w-1.5 rounded-full ${isLive ? 'bg-emerald-500 animate-pulse' : 'bg-gray-300'}`} />
          {isLive ? 'Realtime' : 'Đang kết nối...'}
        </span>
      </div>

      <div className="max-h-96 space-y-4 overflow-y-auto pr-1">
        {loading && <p className="text-sm text-gray-400">Đang tải...</p>}
        {!loading && comments.length === 0 && (
          <p className="text-sm italic text-gray-400">Chưa có bình luận nào. Hãy là người đầu tiên trao đổi về test case này.</p>
        )}
        {comments.map((c) => (
          <div key={c.id} className="flex gap-3">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-blue-100 text-xs font-bold text-blue-700">
              {initialsOf(c.profiles?.full_name)}
            </div>
            <div className="min-w-0 flex-1 rounded-lg bg-gray-50 px-3 py-2">
              <div className="flex flex-wrap items-baseline gap-2">
                <span className="text-sm font-semibold text-gray-800">{c.profiles?.full_name ?? 'Người dùng'}</span>
                <span className="text-xs text-gray-400">{new Date(c.created_at).toLocaleString('vi-VN')}</span>
              </div>
              <p className="mt-0.5 whitespace-pre-wrap break-words text-sm text-gray-700">{c.content}</p>
            </div>
          </div>
        ))}
        <div ref={listEndRef} />
      </div>

      {error && <p className="mt-3 text-xs font-semibold text-red-600">{error}</p>}

      <form onSubmit={sendComment} className="mt-4 flex items-end gap-2 border-t border-gray-100 pt-4">
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              sendComment(e);
            }
          }}
          placeholder="Viết bình luận... (Enter để gửi, Shift+Enter xuống dòng)"
          rows={2}
          className="min-h-[2.5rem] flex-1 resize-none rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-blue-300"
        />
        <button
          type="submit"
          disabled={isSending || !draft.trim()}
          className="shrink-0 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {isSending ? 'Đang gửi...' : 'Gửi'}
        </button>
      </form>
    </div>
  );
}
