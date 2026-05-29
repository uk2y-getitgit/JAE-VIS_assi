'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase';

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const supabase = createClient();
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw error;
      router.push('/');
      router.refresh();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : '로그인 실패');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-6 bg-[#0a0e1a]">
      {/* 로고 */}
      <div className="mb-10 text-center">
        <div className="text-4xl font-bold tracking-widest text-[#00CFFF] mb-1">JAE-VIS</div>
        <div className="text-sm text-gray-500">일정 관리 시스템 v4</div>
      </div>

      <form onSubmit={handleLogin} className="w-full max-w-sm space-y-4">
        <div>
          <label className="block text-xs text-gray-400 mb-1 ml-1">이메일</label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            placeholder="example@email.com"
            className="w-full bg-[#111827] border border-[#1e2d45] rounded-xl px-4 py-3 text-sm text-gray-100 placeholder-gray-600 focus:outline-none focus:border-[#00CFFF] transition"
          />
        </div>

        <div>
          <label className="block text-xs text-gray-400 mb-1 ml-1">비밀번호</label>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            placeholder="••••••••"
            className="w-full bg-[#111827] border border-[#1e2d45] rounded-xl px-4 py-3 text-sm text-gray-100 placeholder-gray-600 focus:outline-none focus:border-[#00CFFF] transition"
          />
        </div>

        {error && (
          <p className="text-red-400 text-xs text-center px-2">{error}</p>
        )}

        <button
          type="submit"
          disabled={loading}
          className="w-full bg-[#00CFFF] text-[#0a0e1a] font-bold rounded-xl py-3 text-sm mt-2 disabled:opacity-50 active:scale-[0.98] transition"
        >
          {loading ? '로그인 중...' : '로그인'}
        </button>
      </form>

      <p className="mt-8 text-xs text-gray-600 text-center">
        데스크탑 JAE-VIS에서 Supabase 계정으로<br />가입 후 로그인하세요
      </p>
    </div>
  );
}
