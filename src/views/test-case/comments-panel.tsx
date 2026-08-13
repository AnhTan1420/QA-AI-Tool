'use client';

import { useEffect, useRef, useState } from 'react';
import { MessageSquare, Send, Loader2 } from 'lucide-react';
import { createClient } from '@/services/supabase/client';
import { SCROLLBAR } from './generate-workspace/shared';

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
    <div className="surface-card p-6">
      <div className="mb-4 flex items-center gap-2.5">
        <span className="panel-icon">
          <MessageSquare className="h-4 w-4" strokeWidth={2.25} />
        </span>
        <h3 className="text-h3">Thảo luận</h3>
        {comments.length > 0 && <span className="badge-neutral">{comments.length}</span>}
        <span className={`ml-auto flex items-center gap-1.5 text-xs font-semibold ${isLive ? 'text-success-600' : 'text-ink-300'}`}>
          <span className={`h-1.5 w-1.5 rounded-full ${isLive ? 'bg-success-600 animate-pulse' : 'bg-ink-300'}`} />
          {isLive ? 'Realtime' : 'Đang kết nối...'}
        </span>
      </div>

      <div className={`max-h-96 space-y-4 overflow-y-auto pr-1 ${SCROLLBAR}`}>
        {loading && <p className="text-caption">Đang tải...</p>}
        {!loading && comments.length === 0 && (
          <p className="text-caption italic">Chưa có bình luận nào. Hãy là người đầu tiên trao đổi về test case này.</p>
        )}
        {comments.map((c) => (
          <div key={c.id} className="flex gap-3">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand-100 text-xs font-bold text-brand-700">
              {initialsOf(c.profiles?.full_name)}
            </div>
            <div className="min-w-0 flex-1 rounded-[var(--radius-control)] bg-ink-50 px-3 py-2">
              <div className="flex flex-wrap items-baseline gap-2">
                <span className="text-sm font-semibold text-ink-800">{c.profiles?.full_name ?? 'Người dùng'}</span>
                <span className="text-xs text-ink-400">{new Date(c.created_at).toLocaleString('vi-VN')}</span>
              </div>
              <p className="mt-0.5 whitespace-pre-wrap break-words text-sm text-ink-700">{c.content}</p>
            </div>
          </div>
        ))}
        <div ref={listEndRef} />
      </div>

      {error && <p className="mt-3 text-xs font-semibold text-danger-600">{error}</p>}

      <form onSubmit={sendComment} className="mt-4 flex items-end gap-2 border-t border-ink-100 pt-4">
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
          className="field-input min-h-[2.5rem] flex-1 resize-none !py-2"
        />
        <button type="submit" disabled={isSending || !draft.trim()} className="btn-primary btn-sm shrink-0">
          {isSending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
          {isSending ? 'Đang gửi...' : 'Gửi'}
        </button>
      </form>
    </div>
  );
}
