'use client';

import { useState, useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import type { QuickMemo, TaskType, TaskPriority } from '@/lib/types';
import { createClient } from '@/lib/supabase';

const TYPE_OPTIONS: TaskType[] = ['메일송부', '자료검토', '자료요청', '보고서작성', '회의준비', '전화/협의', '서명/결재', '기타'];
const TYPE_ICON: Record<TaskType, string> = {
  '메일송부': '📧', '자료검토': '📋', '자료요청': '📤', '보고서작성': '📄',
  '회의준비': '🗓', '전화/협의': '📞', '서명/결재': '✍', '기타': '📌',
};
const PRIORITY_STYLE: Record<TaskPriority, string> = {
  '긴급': 'bg-red-900 text-red-300',
  '보통': 'bg-yellow-900 text-yellow-300',
  '낮음': 'bg-green-900 text-green-300',
};

interface Props {
  initialTasks: QuickMemo[];
  userId: string;
}

export default function TasksClient({ initialTasks, userId }: Props) {
  const supabase = useMemo(() => createClient(), []);
  const router = useRouter();

  const [tasks, setTasks] = useState<QuickMemo[]>(initialTasks);
  const [userEmail, setUserEmail] = useState('');
  const [authReady, setAuthReady] = useState(false);

  const [content, setContent] = useState('');
  const [type, setType] = useState<TaskType>('기타');
  const [priority, setPriority] = useState<TaskPriority>('보통');
  const [dueDate, setDueDate] = useState('');
  const [loading, setLoading] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);

  // 마운트 시 세션 1회 확인 (네트워크 없이 로컬 캐시 읽기)
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!session) {
        router.push('/login');
        return;
      }
      setUserEmail(session.user.email ?? '');
      setAuthReady(true);
    });
  }, [supabase, router]);

  // PC와 실시간 동기화
  useEffect(() => {
    if (!authReady) return;
    const channel = supabase
      .channel('tasks-realtime')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'quick_memos', filter: `user_id=eq.${userId}` },
        (payload) => {
          const incoming = payload.new as QuickMemo;
          if (!incoming.is_done) {
            setTasks((prev) => prev.some((t) => t.id === incoming.id) ? prev : [incoming, ...prev]);
          }
        }
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'quick_memos', filter: `user_id=eq.${userId}` },
        (payload) => {
          const updated = payload.new as QuickMemo;
          if (updated.is_done) {
            setTasks((prev) => prev.filter((t) => t.id !== updated.id));
          } else {
            setTasks((prev) => prev.map((t) => t.id === updated.id ? updated : t));
          }
        }
      )
      .on(
        'postgres_changes',
        { event: 'DELETE', schema: 'public', table: 'quick_memos' },
        (payload) => {
          setTasks((prev) => prev.filter((t) => t.id !== (payload.old as { id: string }).id));
        }
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [supabase, userId, authReady]);

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    if (!content.trim()) return;
    setAddError(null);
    setLoading(true);
    try {
      const now = new Date().toISOString();
      const { data, error } = await supabase
        .from('quick_memos')
        .insert({
          id: crypto.randomUUID(),
          user_id: userId,
          username: userEmail,
          content: content.trim(),
          type,
          priority,
          due_date: dueDate || null,
          is_done: false,
          created_at: now,
          updated_at: now,
        })
        .select()
        .single();
      if (error) {
        setAddError(error.message);
        return;
      }
      if (data) {
        setTasks((prev) => prev.some((t) => t.id === (data as QuickMemo).id) ? prev : [data as QuickMemo, ...prev]);
        setContent('');
        setDueDate('');
        setType('기타');
        setPriority('보통');
        setShowForm(false);
      }
    } catch {
      setAddError('네트워크 오류가 발생했습니다. 다시 시도해주세요.');
    } finally {
      setLoading(false);
    }
  }

  async function handleComplete(id: string) {
    const now = new Date().toISOString();
    const { error } = await supabase
      .from('quick_memos')
      .update({ is_done: true, done_at: now, updated_at: now })
      .eq('id', id);
    if (!error) setTasks((prev) => prev.filter((t) => t.id !== id));
  }

  async function handleDelete(id: string) {
    const { error } = await supabase.from('quick_memos').delete().eq('id', id);
    if (!error) setTasks((prev) => prev.filter((t) => t.id !== id));
  }

  return (
    <div>
      {/* 헤더 */}
      <div className="sticky top-0 z-10 bg-[#0a0e1a] px-4 pt-4 pb-3 border-b border-[#1e2d45] flex items-center justify-between">
        <div>
          <h1 className="text-base font-bold text-gray-100">기타작업</h1>
          <p className="text-xs text-gray-500 mt-0.5">미완료 {tasks.length}건</p>
        </div>
        <button
          onClick={() => { setShowForm((v) => !v); setAddError(null); }}
          className="bg-[#00CFFF] text-[#0a0e1a] text-xs font-bold px-3 py-1.5 rounded-lg"
        >
          {showForm ? '닫기' : '+ 등록'}
        </button>
      </div>

      {/* 세션 로딩 중 */}
      {!authReady && (
        <p className="text-center text-gray-500 text-sm py-6">로딩 중...</p>
      )}

      {/* 작업 입력 폼 */}
      {authReady && showForm && (
        <form onSubmit={handleAdd} className="mx-4 mt-4 bg-[#111827] rounded-2xl p-4 border border-[#1e2d45] space-y-3">
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder="작업 내용 입력..."
            rows={2}
            className="w-full bg-transparent text-sm text-gray-100 placeholder-gray-600 resize-none focus:outline-none"
          />
          {/* 유형 */}
          <div className="flex gap-1.5 overflow-x-auto pb-1 scrollbar-hide">
            {TYPE_OPTIONS.map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setType(t)}
                className={`shrink-0 text-xs px-2 py-1 rounded-full transition ${
                  type === t ? 'bg-[#00CFFF] text-[#0a0e1a] font-bold' : 'bg-[#1a2235] text-gray-400'
                }`}
              >
                {TYPE_ICON[t]} {t}
              </button>
            ))}
          </div>
          {/* 우선순위 + 목표일 */}
          <div className="flex items-center gap-2">
            {(['긴급', '보통', '낮음'] as TaskPriority[]).map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => setPriority(p)}
                className={`text-xs px-2.5 py-1 rounded-full transition ${
                  priority === p ? PRIORITY_STYLE[p] : 'bg-[#1a2235] text-gray-400'
                }`}
              >
                {p}
              </button>
            ))}
            <input
              type="date"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
              className="ml-auto bg-[#1a2235] text-xs text-gray-300 rounded-lg px-2 py-1 border border-[#2a3a55] focus:outline-none"
            />
          </div>
          {addError && (
            <p className="text-xs text-red-400 bg-red-900/30 border border-red-800 rounded-lg px-3 py-2">{addError}</p>
          )}
          <button
            type="submit"
            disabled={loading || !content.trim()}
            className="w-full bg-[#00CFFF] text-[#0a0e1a] text-sm font-bold py-2 rounded-xl disabled:opacity-40"
          >
            {loading ? '등록 중...' : '등록'}
          </button>
        </form>
      )}

      {/* 작업 목록 */}
      <div className="px-4 mt-4 space-y-2 pb-24">
        {authReady && tasks.length === 0 && (
          <p className="text-center text-gray-500 text-sm py-12">미완료 작업 없음</p>
        )}
        {tasks.map((task) => (
          <div key={task.id} className="bg-[#111827] rounded-xl p-3 border border-[#1e2d45]">
            <div className="flex items-start gap-3">
              <button
                onClick={() => handleComplete(task.id)}
                className="shrink-0 mt-0.5 w-5 h-5 rounded-full border-2 border-gray-600 hover:border-[#00CFFF] hover:bg-[#00CFFF]/20 transition flex items-center justify-center"
                title="완료 처리"
              />
              <div className="flex-1 min-w-0">
                <p className="text-sm text-gray-200">{task.content}</p>
                <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
                  <span className="text-xs text-gray-500">{TYPE_ICON[task.type as TaskType]} {task.type}</span>
                  <span className={`text-xs px-1.5 py-0.5 rounded-full ${PRIORITY_STYLE[task.priority as TaskPriority]}`}>
                    {task.priority}
                  </span>
                  {task.due_date && (
                    <span className="text-xs text-gray-500">~ {task.due_date.slice(5).replace('-', '/')}</span>
                  )}
                </div>
              </div>
              <button
                onClick={() => handleDelete(task.id)}
                className="shrink-0 text-gray-600 hover:text-red-400 text-xs transition"
              >
                ✕
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
