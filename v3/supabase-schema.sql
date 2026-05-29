-- ================================================================
-- JAE-VIS v4 — Supabase 스키마
-- 실행: Supabase Dashboard → SQL Editor → 전체 붙여넣기 → Run
-- 주의: 현재 electron-store 구조와 1:1 대응 (필드명·타입 동일)
-- ================================================================

-- ── 카테고리 (글로벌 공유, user_id 없음) ────────────────────
CREATE TABLE IF NOT EXISTS categories (
  id          TEXT PRIMARY KEY,
  parent_id   TEXT REFERENCES categories(id) ON DELETE SET NULL,
  name        TEXT NOT NULL,
  level       INT  NOT NULL,          -- 1=대분류, 2=중분류
  order_index INT  DEFAULT 0
);

-- ── 사용자 프로필 (Supabase Auth 연동) ──────────────────────
CREATE TABLE IF NOT EXISTS user_profiles (
  id         UUID REFERENCES auth.users ON DELETE CASCADE PRIMARY KEY,
  username   TEXT UNIQUE NOT NULL,    -- 앱 내 표시명 (기존 name 필드)
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ── 프로젝트 ────────────────────────────────────────────────
-- 기존: { id, username, name, description, category_id, status, is_deleted, created_at, updated_at }
CREATE TABLE IF NOT EXISTS projects (
  id          TEXT PRIMARY KEY,       -- 기존 'proj_timestamp_random' 형식 유지
  user_id     UUID REFERENCES auth.users ON DELETE CASCADE NOT NULL,
  username    TEXT NOT NULL,          -- 챗봇 프롬프트 호환용 (기존 필드 유지)
  name        TEXT NOT NULL,
  description TEXT DEFAULT '',
  category_id TEXT REFERENCES categories(id) ON DELETE SET NULL,
  status      TEXT DEFAULT '대기',    -- '대기'|'진행중'|'완료'|'청구완료'
  is_deleted  BOOLEAN DEFAULT FALSE,
  created_at  TIMESTAMPTZ NOT NULL,
  updated_at  TIMESTAMPTZ NOT NULL
);

-- ── 공정 ────────────────────────────────────────────────────
-- 기존: { id, project_id, name, parent_id, is_group, order_index,
--         plan_start, plan_end, actual_start, actual_end,
--         status, memo, is_deleted, created_at, updated_at }
CREATE TABLE IF NOT EXISTS processes (
  id           TEXT PRIMARY KEY,      -- 기존 'proc_timestamp_random' 형식 유지
  project_id   TEXT REFERENCES projects(id) ON DELETE CASCADE NOT NULL,
  name         TEXT NOT NULL,
  parent_id    TEXT REFERENCES processes(id) ON DELETE CASCADE, -- 건진법 자식
  is_group     BOOLEAN DEFAULT FALSE, -- 건진법 그룹 컨테이너
  order_index  INT DEFAULT 0,
  plan_start   TEXT,                  -- 'YYYY-MM-DD' (TEXT 유지, 챗봇 호환)
  plan_end     TEXT,
  actual_start TEXT,
  actual_end   TEXT,
  status       TEXT DEFAULT '대기',   -- '대기'|'진행'|'완료'
  memo         TEXT DEFAULT '',       -- 공정 인라인 메모
  is_deleted   BOOLEAN DEFAULT FALSE,
  created_at   TIMESTAMPTZ NOT NULL,
  updated_at   TIMESTAMPTZ NOT NULL
);

-- ── 메모 ────────────────────────────────────────────────────
-- 기존: { id, project_id, process_id, content, tag, author, created_at, is_pinned }
CREATE TABLE IF NOT EXISTS memos (
  id         TEXT PRIMARY KEY,        -- 기존 'memo_timestamp_random' 형식 유지
  project_id TEXT REFERENCES projects(id) ON DELETE CASCADE NOT NULL,
  process_id TEXT REFERENCES processes(id) ON DELETE SET NULL, -- 선택
  content    TEXT NOT NULL,
  tag        TEXT,                    -- '중요'|'보완'|'확인필요'|null
  author     TEXT NOT NULL,           -- username
  created_at TIMESTAMPTZ NOT NULL,
  is_pinned  BOOLEAN DEFAULT FALSE
);

-- ── 빠른 메모 / 단기 작업 ───────────────────────────────────
-- 기존: { id, username, content, type, priority, due_date,
--         is_done, created_at, done_at, updated_at }
CREATE TABLE IF NOT EXISTS quick_memos (
  id         TEXT PRIMARY KEY,        -- 기존 'qm_timestamp_random' 형식 유지
  user_id    UUID REFERENCES auth.users ON DELETE CASCADE NOT NULL,
  username   TEXT NOT NULL,           -- 챗봇 호환용 (기존 필드 유지)
  content    TEXT NOT NULL,
  type       TEXT DEFAULT '기타',     -- '메일송부'|'자료검토'|'자료요청' 등
  priority   TEXT DEFAULT '보통',     -- '긴급'|'보통'|'낮음'
  due_date   TEXT,                    -- 'YYYY-MM-DD'
  is_done    BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL,
  done_at    TIMESTAMPTZ,
  updated_at TIMESTAMPTZ
);

-- ── 사용자 설정 ─────────────────────────────────────────────
-- 기존 settings 객체 필드를 컬럼으로 분리 (camelCase → snake_case)
CREATE TABLE IF NOT EXISTS user_settings (
  user_id            UUID REFERENCES auth.users ON DELETE CASCADE PRIMARY KEY,
  briefing_time      TEXT    DEFAULT '09:00',
  alarm_days_before  INT     DEFAULT 7,
  auto_start         BOOLEAN DEFAULT FALSE,
  default_view       TEXT    DEFAULT 'card',  -- 'card'|'list'
  week_start_day     INT     DEFAULT 1,
  theme              TEXT    DEFAULT 'dark',  -- 'dark'|'light'
  ai_provider        TEXT    DEFAULT 'claude',
  ai_api_key         TEXT    DEFAULT '',
  ai_widget_enabled  BOOLEAN DEFAULT TRUE,
  widget_x           INT,
  widget_y           INT,
  widget_expanded_w  INT,
  widget_expanded_h  INT,
  updated_at         TIMESTAMPTZ DEFAULT NOW()
);

-- ================================================================
-- Row Level Security (RLS) — 본인 데이터만 접근 가능
-- ================================================================

ALTER TABLE categories    ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE projects      ENABLE ROW LEVEL SECURITY;
ALTER TABLE processes     ENABLE ROW LEVEL SECURITY;
ALTER TABLE memos         ENABLE ROW LEVEL SECURITY;
ALTER TABLE quick_memos   ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_settings ENABLE ROW LEVEL SECURITY;

-- 카테고리: 인증된 사용자 전원 읽기/쓰기 (글로벌 공유 분류체계)
CREATE POLICY "auth_categories_select" ON categories
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth_categories_all" ON categories
  FOR ALL TO authenticated USING (true);

-- 프로필
CREATE POLICY "own_profile" ON user_profiles
  FOR ALL USING (auth.uid() = id);

-- 프로젝트
CREATE POLICY "own_projects" ON projects
  FOR ALL USING (auth.uid() = user_id);

-- 공정: 본인 프로젝트 소속만
CREATE POLICY "own_processes" ON processes
  FOR ALL USING (
    project_id IN (SELECT id FROM projects WHERE user_id = auth.uid())
  );

-- 메모: 본인 프로젝트 소속만
CREATE POLICY "own_memos" ON memos
  FOR ALL USING (
    project_id IN (SELECT id FROM projects WHERE user_id = auth.uid())
  );

-- 빠른 메모
CREATE POLICY "own_quick_memos" ON quick_memos
  FOR ALL USING (auth.uid() = user_id);

-- 설정
CREATE POLICY "own_settings" ON user_settings
  FOR ALL USING (auth.uid() = user_id);

-- ================================================================
-- 인덱스 (조회 성능)
-- ================================================================
CREATE INDEX IF NOT EXISTS idx_projects_user_id    ON projects(user_id);
CREATE INDEX IF NOT EXISTS idx_projects_is_deleted ON projects(is_deleted);
CREATE INDEX IF NOT EXISTS idx_processes_project   ON processes(project_id);
CREATE INDEX IF NOT EXISTS idx_processes_parent    ON processes(parent_id);
CREATE INDEX IF NOT EXISTS idx_memos_project       ON memos(project_id);
CREATE INDEX IF NOT EXISTS idx_quick_memos_user    ON quick_memos(user_id);
CREATE INDEX IF NOT EXISTS idx_quick_memos_is_done ON quick_memos(is_done);
