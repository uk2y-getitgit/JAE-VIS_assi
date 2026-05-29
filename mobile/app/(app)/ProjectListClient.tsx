'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import type { Category, Project, Process, ProjectStatus } from '@/lib/types';

const STATUS_STYLE: Record<ProjectStatus, string> = {
  '대기':    'bg-gray-700 text-gray-300',
  '진행중':  'bg-blue-900 text-blue-300',
  '완료':    'bg-green-900 text-green-300',
  '청구완료': 'bg-orange-900 text-orange-300',
};

interface Props {
  initialProjects: Project[];
  categories: Category[];
  processes: Process[];
}

export default function ProjectListClient({ initialProjects, categories, processes }: Props) {
  const [search, setSearch] = useState('');
  const [catFilter, setCatFilter] = useState<string>('all');

  // 대분류만 필터 탭으로
  const topCats = useMemo(() => categories.filter((c) => c.level === 1), [categories]);

  const filtered = useMemo(() => {
    return initialProjects.filter((p) => {
      const matchSearch = p.name.toLowerCase().includes(search.toLowerCase());
      if (!matchSearch) return false;
      if (catFilter === 'all') return true;
      // 대분류 → 하위 중분류 포함
      const cat = categories.find((c) => c.id === p.category_id);
      if (!cat) return false;
      if (cat.id === catFilter) return true;
      // 중분류인 경우 부모 확인
      return cat.parent_id === catFilter;
    });
  }, [initialProjects, categories, search, catFilter]);

  // 프로젝트별 공정 완료율 계산
  function calcRate(projectId: string) {
    const procs = processes.filter((p) => p.project_id === projectId);
    if (!procs.length) return 0;
    const done = procs.filter((p) => p.status === '완료').length;
    return Math.round((done / procs.length) * 100);
  }

  return (
    <div className="px-4 pt-4">
      {/* 헤더 */}
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-lg font-bold text-[#00CFFF]">프로젝트</h1>
        <span className="text-xs text-gray-500">{filtered.length}건</span>
      </div>

      {/* 검색 */}
      <input
        type="text"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="프로젝트 검색..."
        className="w-full bg-[#111827] border border-[#1e2d45] rounded-xl px-4 py-2.5 text-sm text-gray-100 placeholder-gray-600 focus:outline-none focus:border-[#00CFFF] mb-3 transition"
      />

      {/* 카테고리 필터 탭 */}
      <div className="flex gap-2 mb-4 overflow-x-auto scrollbar-hide pb-1">
        <button
          onClick={() => setCatFilter('all')}
          className={`shrink-0 px-3 py-1 rounded-full text-xs transition ${
            catFilter === 'all'
              ? 'bg-[#00CFFF] text-[#0a0e1a] font-bold'
              : 'bg-[#111827] text-gray-400 border border-[#1e2d45]'
          }`}
        >
          전체
        </button>
        {topCats.map((c) => (
          <button
            key={c.id}
            onClick={() => setCatFilter(c.id)}
            className={`shrink-0 px-3 py-1 rounded-full text-xs transition ${
              catFilter === c.id
                ? 'bg-[#00CFFF] text-[#0a0e1a] font-bold'
                : 'bg-[#111827] text-gray-400 border border-[#1e2d45]'
            }`}
          >
            {c.name}
          </button>
        ))}
      </div>

      {/* 프로젝트 카드 목록 */}
      <div className="space-y-3">
        {filtered.length === 0 && (
          <p className="text-center text-gray-500 text-sm py-10">프로젝트 없음</p>
        )}
        {filtered.map((proj) => {
          const rate = calcRate(proj.id);
          const catName = categories.find((c) => c.id === proj.category_id)?.name ?? '';
          return (
            <Link
              key={proj.id}
              href={`/project/${proj.id}`}
              className="block bg-[#111827] rounded-2xl p-4 border border-[#1e2d45] active:scale-[0.98] transition"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-sm text-gray-100 truncate">{proj.name}</p>
                  {catName && (
                    <p className="text-xs text-gray-500 mt-0.5">{catName}</p>
                  )}
                </div>
                <span className={`shrink-0 text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_STYLE[proj.status]}`}>
                  {proj.status}
                </span>
              </div>

              {/* 진행률 바 */}
              <div className="mt-3">
                <div className="flex justify-between text-xs text-gray-500 mb-1">
                  <span>공정 완료율</span>
                  <span>{rate}%</span>
                </div>
                <div className="h-1.5 bg-[#1e2d45] rounded-full overflow-hidden">
                  <div
                    className="h-full bg-[#00CFFF] rounded-full transition-all"
                    style={{ width: `${rate}%` }}
                  />
                </div>
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
