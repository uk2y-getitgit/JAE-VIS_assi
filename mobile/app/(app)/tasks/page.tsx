import { createServerSupabaseClient } from '@/lib/supabase-server';
import type { QuickMemo } from '@/lib/types';
import TasksClient from './TasksClient';

export default async function TasksPage() {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();

  const { data: tasks } = await supabase
    .from('quick_memos')
    .select('*')
    .eq('user_id', user!.id)
    .eq('is_done', false)
    .order('created_at', { ascending: false });

  return <TasksClient initialTasks={(tasks ?? []) as QuickMemo[]} userId={user!.id} />;
}
