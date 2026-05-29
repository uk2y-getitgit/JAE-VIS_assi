'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const TABS = [
  { href: '/',          label: '프로젝트', icon: '📋' },
  { href: '/schedule',  label: '스케줄',   icon: '📅' },
  { href: '/tasks',     label: '기타작업', icon: '📌' },
];

export default function BottomNav() {
  const pathname = usePathname();

  return (
    <nav className="fixed bottom-0 left-0 right-0 bg-[#111827] border-t border-[#1e2d45] safe-bottom z-50">
      <div className="flex">
        {TABS.map((tab) => {
          const active = tab.href === '/'
            ? pathname === '/' || pathname.startsWith('/project')
            : pathname.startsWith(tab.href);

          return (
            <Link
              key={tab.href}
              href={tab.href}
              className={`flex-1 flex flex-col items-center py-3 text-xs gap-1 transition-colors ${
                active ? 'text-[#00CFFF]' : 'text-gray-500'
              }`}
            >
              <span className="text-xl leading-none">{tab.icon}</span>
              <span>{tab.label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
