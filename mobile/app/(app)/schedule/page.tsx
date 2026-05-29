import { createServerSupabaseClient } from '@/lib/supabase-server';
import type { Project, Process } from '@/lib/types';
import ScheduleClient from './ScheduleClient';

export default async function SchedulePage() {
  const supabase = await createServerSupabaseClient();

  const [{ data: projects }, { data: processes }] = await Promise.all([
    supabase.from('projects').select('*').eq('is_deleted', false),
    supabase
      .from('processes')
      .select('*')
      .eq('is_deleted', false)
      .eq('is_group', false)
      .not('plan_end', 'is', null),
  ]);

  return (
    <ScheduleClient
      projects={(projects ?? []) as Project[]}
      processes={(processes ?? []) as Process[]}
    />
  );
}
