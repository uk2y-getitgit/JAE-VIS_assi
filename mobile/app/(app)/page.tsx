import { createServerSupabaseClient } from '@/lib/supabase-server';
import type { Category, Project, Process } from '@/lib/types';
import ProjectListClient from './ProjectListClient';

export default async function ProjectsPage() {
  const supabase = await createServerSupabaseClient();

  const [{ data: projects }, { data: categories }, { data: processes }] = await Promise.all([
    supabase
      .from('projects')
      .select('*')
      .eq('is_deleted', false)
      .order('updated_at', { ascending: false }),
    supabase.from('categories').select('*').order('order_index'),
    supabase
      .from('processes')
      .select('*')
      .eq('is_deleted', false)
      .eq('is_group', false),
  ]);

  return (
    <ProjectListClient
      initialProjects={(projects ?? []) as Project[]}
      categories={(categories ?? []) as Category[]}
      processes={(processes ?? []) as Process[]}
    />
  );
}
