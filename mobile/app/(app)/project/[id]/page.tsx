import { createServerSupabaseClient } from '@/lib/supabase-server';
import { notFound } from 'next/navigation';
import type { Project, Process, Memo } from '@/lib/types';
import ProjectDetailClient from './ProjectDetailClient';

interface Props {
  params: Promise<{ id: string }>;
}

export default async function ProjectDetailPage({ params }: Props) {
  const { id } = await params;
  const supabase = await createServerSupabaseClient();

  const [{ data: project }, { data: processes }, { data: memos }] = await Promise.all([
    supabase.from('projects').select('*').eq('id', id).single(),
    supabase
      .from('processes')
      .select('*')
      .eq('project_id', id)
      .eq('is_deleted', false)
      .order('order_index'),
    supabase
      .from('memos')
      .select('*')
      .eq('project_id', id)
      .order('created_at', { ascending: false }),
  ]);

  if (!project) notFound();

  return (
    <ProjectDetailClient
      project={project as Project}
      initialProcesses={(processes ?? []) as Process[]}
      initialMemos={(memos ?? []) as Memo[]}
    />
  );
}
