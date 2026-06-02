'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import type { Project, Process, ProcessStatus, Memo, MemoTag } from '@/lib/types';
import { createClient } from '@/lib/supabase';

const STATUS_NEXT: Record<ProcessStatus, ProcessStatus> = {
  '대기': '진행',
  '진행': '완료',
  '완료': '대기',
};
const STATUS_STYLE: Record<ProcessStatus, string> = {
  '대기': 'bg-gray-700 text-gray-300',
  '진행': 'bg-blue-900 text-blue-300',
  '완료': 'bg-green-900 text-green-300',
};

const TAG_OPTIONS: (MemoTag)[] = ['중요', '보완', '확인필요'];
const TAG_STYLE: Record<string, string> = {
  '중요':   'bg-red-900 text-red-300',
  '보완':   'bg-yellow-900 text-yellow-300',
  '확인필요': 'bg-blue-900 text-blue-300',
};

function fmtDate(iso: string | null) {
  if (!iso) return '-';
  const [, m, d] = iso.split('-');
  return `${Number(m)}/${Number(d)}`;
}

interface Props {
  project: Project;
  initialProcesses: Process[];
  initialMemos: Memo[];
}

export default function ProjectDetailClient({ project, initialProcesses, initialMemos }: Props) {
  const router = useRouter();
  const supabase = createClient();

  const [tab, setTab] = useState<'process' | 'memo'>('process');
  const [processes, setProcesses] = useState<Process[]>(initialProcesses);
  const [memos, setMemos] = useState<Memo[]>(initialMemos);

  // Realtime 구독 — PC에서 변경 시 즉시 반영
  useEffect(() => {
    const channel = supabase
      .channel(`project-detail-${project.id}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'memos', filter: `project_id=eq.${project.id}` },
        (payload) => {
          const incoming = payload.new as Memo;
          setMemos((prev) => prev.some((m) => m.id === incoming.id) ? prev : [incoming, ...prev]);
        }
      )
      .on(
        'postgres_changes',
        { event: 'DELETE', schema: 'public', table: 'memos' },
        (payload) => {
          setMemos((prev) => prev.filter((m) => m.id !== (payload.old as { id: string }).id));
        }
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'processes', filter: `project_id=eq.${project.id}` },
        (payload) => {
          const updated = payload.new as Process;
          setProcesses((prev) => prev.map((p) => p.id === updated.id ? updated : p));
        }
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project.id]);

  // 공정 상태 변경
  async function handleStatusChange(proc: Process) {
    const next = STATUS_NEXT[proc.status];
    const { error } = await supabase
      .from('processes')
      .update({ status: next, updated_at: new Date().toISOString() })
      .eq('id', proc.id);
    if (!error) {
      setProcesses((prev) =>
        prev.map((p) => (p.id === proc.id ? { ...p, status: next } : p))
      );
    }
  }

  // 메모 추가
  const [memoContent, setMemoContent] = useState('');
  const [memoTag, setMemoTag] = useState<MemoTag>(null);
  const [memoLoading, setMemoLoading] = useState(false);
  const [memoError, setMemoError] = useState<string | null>(null);

  async function handleAddMemo(e: React.FormEvent) {
    e.preventDefault();
    if (!memoContent.trim()) return;
    setMemoError(null);
    setMemoLoading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        router.push('/login');
        return;
      }
      const { data, error } = await supabase
        .from('memos')
        .insert({
          project_id: project.id,
          content: memoContent.trim(),
          tag: memoTag,
          author: user.email ?? '',
          is_pinned: false,
        })
        .select()
        .single();
      if (error) {
        setMemoError(error.message);
        return;
      }
      if (data) {
        setMemos((prev) => prev.some((m) => m.id === (data as Memo).id) ? prev : [data as Memo, ...prev]);
        setMemoContent('');
        setMemoTag(null);
      }
    } catch {
      setMemoError('네트워크 오류가 발생했습니다. 다시 시도해주세요.');
    } finally {
      setMemoLoading(false);
    }
  }

  // 메모 삭제
  async function handleDeleteMemo(id: string) {
    const { error } = await supabase.from('memos').delete().eq('id', id);
    if (!error) setMemos((prev) => prev.filter((m) => m.id !== id));
  }

  // 공정 트리 (is_group 상위 먼저, 자식은 들여쓰기)
  const rootProcs = processes.filter((p) => !p.parent_id && !p.is_deleted);
  const childMap = new Map<string, Process[]>();
  processes.filter((p) => p.parent_id && !p.is_deleted).forEach((p) => {
    if (!childMap.has(p.parent_id!)) childMap.set(p.parent_id!, []);
    childMap.get(p.parent_id!)!.push(p);
  });

  return (
    <div>
      {/* 헤더 */}
      <div className="sticky top-0 z-10 bg-[#0a0e1a] px-4 pt-4 pb-3 border-b border-[#1e2d45]">
        <button
          onClick={() => router.back()}
          className="text-[#00CFFF] text-sm mb-2 flex items-center gap-1"
        >
          ← 목록
        </button>
        <h1 className="text-base font-bold text-gray-100 leading-tight">{project.name}</h1>
      </div>

      {/* 탭 */}
      <div className="flex bg-[#111827] mx-4 mt-4 rounded-xl p-1 border border-[#1e2d45]">
        {(['process', 'memo'] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`flex-1 py-2 text-sm font-semibold rounded-lg transition ${
              tab === t ? 'bg-[#00CFFF] text-[#0a0e1a]' : 'text-gray-400'
            }`}
          >
            {t === 'process' ? '공정' : '메모'}
          </button>
        ))}
      </div>

      {/* 공정 탭 */}
      {tab === 'process' && (
        <div className="px-4 mt-4 space-y-2">
          {rootProcs.length === 0 && (
            <p className="text-center text-gray-500 text-sm py-10">등록된 공정 없음</p>
          )}
          {rootProcs.map((proc) => (
            <div key={proc.id}>
              {/* 루트 공정 또는 그룹 */}
              <ProcessRow proc={proc} onStatusChange={handleStatusChange} />

              {/* 자식 공정 (건진법 세부) */}
              {childMap.get(proc.id)?.map((child) => (
                <div key={child.id} className="ml-4 mt-1">
                  <ProcessRow proc={child} onStatusChange={handleStatusChange} />
                </div>
              ))}
            </div>
          ))}
        </div>
      )}

      {/* 메모 탭 */}
      {tab === 'memo' && (
        <div className="px-4 mt-4 space-y-4">
          {/* 메모 입력 폼 */}
          <form onSubmit={handleAddMemo} className="bg-[#111827] rounded-2xl p-4 border border-[#1e2d45]">
            <textarea
              value={memoContent}
              onChange={(e) => setMemoContent(e.target.value)}
              placeholder="메모 내용 입력..."
              rows={3}
              className="w-full bg-transparent text-sm text-gray-100 placeholder-gray-600 resize-none focus:outline-none"
            />
            <div className="flex items-center justify-between mt-3">
              <div className="flex gap-2 overflow-x-auto scrollbar-hide">
                <button
                  type="button"
                  onClick={() => setMemoTag(null)}
                  className={`shrink-0 text-xs px-2 py-1 rounded-full transition ${
                    memoTag === null ? 'bg-gray-600 text-gray-200' : 'bg-[#1a2235] text-gray-400'
                  }`}
                >
                  없음
                </button>
                {TAG_OPTIONS.map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setMemoTag(t)}
                    className={`shrink-0 text-xs px-2 py-1 rounded-full transition ${
                      memoTag === t ? TAG_STYLE[t!] : 'bg-[#1a2235] text-gray-400'
                    }`}
                  >
                    {t}
                  </button>
                ))}
              </div>
              <button
                type="submit"
                disabled={memoLoading || !memoContent.trim()}
                className="shrink-0 bg-[#00CFFF] text-[#0a0e1a] text-xs font-bold px-3 py-1.5 rounded-lg disabled:opacity-40 ml-2"
              >
                {memoLoading ? '추가 중...' : '추가'}
              </button>
            </div>
            {memoError && (
              <p className="text-xs text-red-400 bg-red-900/20 rounded-lg px-3 py-2 mt-2">{memoError}</p>
            )}
          </form>

          {/* 메모 목록 */}
          <div className="space-y-2">
            {memos.length === 0 && (
              <p className="text-center text-gray-500 text-sm py-8">메모 없음</p>
            )}
            {memos.map((memo) => (
              <div key={memo.id} className="bg-[#111827] rounded-xl p-3 border border-[#1e2d45]">
                <div className="flex items-start justify-between gap-2">
                  <p className="text-sm text-gray-200 whitespace-pre-wrap flex-1">{memo.content}</p>
                  <button
                    onClick={() => handleDeleteMemo(memo.id)}
                    className="text-gray-600 hover:text-red-400 transition shrink-0 text-xs"
                  >
                    ✕
                  </button>
                </div>
                <div className="flex items-center gap-2 mt-2">
                  {memo.tag && (
                    <span className={`text-xs px-2 py-0.5 rounded-full ${TAG_STYLE[memo.tag]}`}>
                      {memo.tag}
                    </span>
                  )}
                  <span className="text-xs text-gray-600">
                    {memo.created_at.slice(0, 10)}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function ProcessRow({
  proc,
  onStatusChange,
}: {
  proc: Process;
  onStatusChange: (p: Process) => void;
}) {
  const [loading, setLoading] = useState(false);

  async function handleTap() {
    setLoading(true);
    await onStatusChange(proc);
    setLoading(false);
  }

  return (
    <div className="bg-[#111827] rounded-xl px-3 py-2.5 border border-[#1e2d45] flex items-center gap-3">
      <div className="flex-1 min-w-0">
        <p className="text-sm text-gray-200 truncate">{proc.name}</p>
        {(proc.plan_start || proc.plan_end) && (
          <p className="text-xs text-gray-500 mt-0.5">
            {proc.plan_start && proc.plan_start !== proc.plan_end
              ? `${fmtDate(proc.plan_start)} ~ ${fmtDate(proc.plan_end)}`
              : fmtDate(proc.plan_end)}
          </p>
        )}
      </div>
      <button
        onClick={handleTap}
        disabled={loading}
        className={`shrink-0 text-xs px-2.5 py-1 rounded-full font-medium transition active:scale-95 ${
          STATUS_STYLE[proc.status]
        } disabled:opacity-50`}
      >
        {proc.status}
      </button>
    </div>
  );
}
