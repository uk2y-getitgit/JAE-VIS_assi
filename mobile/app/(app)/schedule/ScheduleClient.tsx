'use client';

import { useMemo, useState } from 'react';
import type { Project, Process, ProcessStatus } from '@/lib/types';

type WeekKey = 'last' | 'this' | 'next';

const STATUS_COLOR: Record<ProcessStatus, string> = {
  '대기': 'text-gray-400',
  '진행': 'text-blue-400',
  '완료': 'text-green-400',
};
const STATUS_DOT: Record<ProcessStatus, string> = {
  '대기': 'bg-gray-500',
  '진행': 'bg-blue-500',
  '완료': 'bg-green-500',
};

function getWeekRange(offset: number): { start: Date; end: Date } {
  const now = new Date();
  const day = now.getDay(); // 0=일
  const monday = new Date(now);
  monday.setDate(now.getDate() - ((day + 6) % 7) + offset * 7);
  monday.setHours(0, 0, 0, 0);
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  sunday.setHours(23, 59, 59, 999);
  return { start: monday, end: sunday };
}

function fmtDate(iso: string) {
  const [, m, d] = iso.split('-');
  return `${Number(m)}/${Number(d)}`;
}

function fmtWeekLabel(start: Date, end: Date) {
  return `${start.getMonth() + 1}/${start.getDate()} ~ ${end.getMonth() + 1}/${end.getDate()}`;
}

interface Props {
  projects: Project[];
  processes: Process[];
}

export default function ScheduleClient({ projects, processes }: Props) {
  const [week, setWeek] = useState<WeekKey>('this');

  const offset = week === 'last' ? -1 : week === 'next' ? 1 : 0;
  const { start, end } = useMemo(() => getWeekRange(offset), [offset]);

  // 해당 주 범위에 걸쳐있는 공정 필터
  const weekProcs = useMemo(() => {
    return processes.filter((p) => {
      if (!p.plan_end) return false;
      const ps = p.plan_start ? new Date(p.plan_start) : new Date(p.plan_end);
      const pe = new Date(p.plan_end);
      return pe >= start && ps <= end;
    });
  }, [processes, start, end]);

  // 프로젝트별 그룹
  const grouped = useMemo(() => {
    const map = new Map<string, { project: Project; procs: Process[] }>();
    weekProcs.forEach((proc) => {
      const proj = projects.find((p) => p.id === proc.project_id);
      if (!proj) return;
      if (!map.has(proj.id)) map.set(proj.id, { project: proj, procs: [] });
      map.get(proj.id)!.procs.push(proc);
    });
    return [...map.values()].sort((a, b) => a.project.name.localeCompare(b.project.name));
  }, [weekProcs, projects]);

  const TABS: { key: WeekKey; label: string }[] = [
    { key: 'last', label: 'LAST' },
    { key: 'this', label: 'THIS' },
    { key: 'next', label: 'NEXT' },
  ];

  return (
    <div className="px-4 pt-4">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-lg font-bold text-[#00CFFF]">3주 스케줄</h1>
        <span className="text-xs text-gray-500">{fmtWeekLabel(start, end)}</span>
      </div>

      {/* 주차 탭 */}
      <div className="flex bg-[#111827] rounded-xl p-1 mb-5 border border-[#1e2d45]">
        {TABS.map(({ key, label }) => (
          <button
            key={key}
            onClick={() => setWeek(key)}
            className={`flex-1 py-2 text-sm font-bold rounded-lg transition ${
              week === key
                ? 'bg-[#00CFFF] text-[#0a0e1a]'
                : 'text-gray-400'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* 스케줄 목록 */}
      {grouped.length === 0 ? (
        <p className="text-center text-gray-500 text-sm py-16">이번 주 공정 없음</p>
      ) : (
        <div className="space-y-4">
          {grouped.map(({ project, procs }) => (
            <div key={project.id} className="bg-[#111827] rounded-2xl border border-[#1e2d45] overflow-hidden">
              {/* 프로젝트 헤더 */}
              <div className="px-4 py-2.5 border-b border-[#1e2d45] bg-[#1a2235]">
                <p className="text-sm font-semibold text-gray-200 truncate">{project.name}</p>
              </div>

              {/* 공정 목록 */}
              <div className="divide-y divide-[#1e2d45]">
                {procs
                  .sort((a, b) => a.order_index - b.order_index)
                  .map((proc) => (
                    <div key={proc.id} className="px-4 py-2.5 flex items-center gap-3">
                      <div className={`w-2 h-2 rounded-full shrink-0 ${STATUS_DOT[proc.status]}`} />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm text-gray-200 truncate">{proc.name}</p>
                        <p className="text-xs text-gray-500 mt-0.5">
                          {proc.plan_start && proc.plan_start !== proc.plan_end
                            ? `${fmtDate(proc.plan_start)} ~ ${fmtDate(proc.plan_end!)}`
                            : fmtDate(proc.plan_end!)}
                        </p>
                      </div>
                      <span className={`text-xs font-medium shrink-0 ${STATUS_COLOR[proc.status]}`}>
                        {proc.status}
                      </span>
                    </div>
                  ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
