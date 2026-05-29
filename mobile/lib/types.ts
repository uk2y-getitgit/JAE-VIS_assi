export type ProjectStatus = '대기' | '진행중' | '완료' | '청구완료';
export type ProcessStatus = '대기' | '진행' | '완료';
export type MemoTag = '중요' | '보완' | '확인필요' | null;

export interface Category {
  id: string;
  parent_id: string | null;
  name: string;
  level: number;
  order_index: number;
}

export interface Project {
  id: string;
  user_id: string;
  username: string;
  name: string;
  description: string;
  category_id: string | null;
  status: ProjectStatus;
  is_deleted: boolean;
  created_at: string;
  updated_at: string;
  processes?: Process[];
}

export interface Process {
  id: string;
  project_id: string;
  name: string;
  parent_id: string | null;
  is_group: boolean;
  order_index: number;
  plan_start: string | null;
  plan_end: string | null;
  actual_start: string | null;
  actual_end: string | null;
  status: ProcessStatus;
  memo: string;
  is_deleted: boolean;
  created_at: string;
  updated_at: string;
}

export interface Memo {
  id: string;
  project_id: string;
  process_id: string | null;
  content: string;
  tag: MemoTag;
  author: string;
  is_pinned: boolean;
  created_at: string;
}

export type TaskType = '메일송부' | '자료검토' | '자료요청' | '보고서작성' | '회의준비' | '전화/협의' | '서명/결재' | '기타';
export type TaskPriority = '긴급' | '보통' | '낮음';

export interface QuickMemo {
  id: string;
  user_id: string;
  username: string;
  content: string;
  type: TaskType;
  priority: TaskPriority;
  due_date: string | null;
  is_done: boolean;
  created_at: string;
  done_at: string | null;
  updated_at: string | null;
}
