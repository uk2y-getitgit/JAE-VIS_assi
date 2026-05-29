/**
 * supabase.js — JAE-VIS v4 클라우드 동기화 모듈
 *
 * 설계 원칙:
 *  - 로컬(electron-store)이 주저장소, Supabase는 백그라운드 동기화
 *  - db.js / ipcHandlers.js API는 변경 없음 (챗봇 호환 유지)
 *  - 동기화는 fire-and-forget (UI 블로킹 없음)
 *  - Supabase 미설정 시 모든 sync 함수는 무조건 no-op
 */

const Store = require('electron-store');

// 세션 전용 스토어 (토큰 분리 보관)
const sessionStore = new Store({ name: 'jae-vis-session' });

let supabase     = null;   // Supabase 클라이언트
let currentUid   = null;   // 현재 로그인한 Supabase user UUID
let syncEnabled  = false;  // 동기화 활성 여부

// ── 초기화 ────────────────────────────────────────────────────
/**
 * @param {string} url       Supabase Project URL
 * @param {string} anonKey   Supabase anon public key
 * @returns {boolean} 초기화 성공 여부
 */
function init(url, anonKey) {
  if (!url || !anonKey) return false;
  try {
    const { createClient } = require('@supabase/supabase-js');
    // Electron(Node.js 20)은 네이티브 WebSocket 미지원 → ws 패키지로 대체
    const ws = require('ws');
    supabase = createClient(url, anonKey, {
      auth: {
        // 세션을 electron-store에 영속화 (브라우저 localStorage 대신)
        storage: {
          getItem:    (key)        => sessionStore.get(key, null),
          setItem:    (key, value) => sessionStore.set(key, value),
          removeItem: (key)        => sessionStore.delete(key),
        },
        autoRefreshToken:    true,
        persistSession:      true,
        detectSessionInUrl:  false,
      },
      realtime: {
        transport: ws,   // Node.js 20 WebSocket 대체
      },
    });
    return true;
  } catch (e) {
    console.error('[Supabase] 초기화 실패:', e.message);
    return false;
  }
}

function getClient()    { return supabase; }
function isReady()      { return !!(supabase && currentUid && syncEnabled); }
function getSyncStatus() {
  return {
    connected:   !!supabase,
    authenticated: !!currentUid,
    syncEnabled,
    userId: currentUid,
  };
}

// ── 인증 ─────────────────────────────────────────────────────
const auth = {
  /** 신규 계정 생성 */
  async signUp(email, password, username) {
    if (!supabase) throw new Error('Supabase URL/Key가 설정되지 않았습니다.');
    const { data, error } = await supabase.auth.signUp({ email, password });
    if (error) throw new Error(error.message);

    currentUid = data.user?.id;
    if (currentUid) {
      // 프로필 생성 (username 등록)
      const { error: pe } = await supabase
        .from('user_profiles')
        .upsert({ id: currentUid, username }, { onConflict: 'id' });
      if (pe) console.warn('[Supabase] 프로필 생성 실패:', pe.message);
      syncEnabled = true;
    }
    return { userId: currentUid, email: data.user?.email };
  },

  /** 기존 계정 로그인 */
  async signIn(email, password) {
    if (!supabase) throw new Error('Supabase URL/Key가 설정되지 않았습니다.');
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw new Error(error.message);

    currentUid  = data.user?.id;
    syncEnabled = !!currentUid;
    return { userId: currentUid, email: data.user?.email };
  },

  /** 로그아웃 */
  async signOut() {
    if (!supabase) return;
    await supabase.auth.signOut();
    currentUid  = null;
    syncEnabled = false;
  },

  /** 앱 시작 시 저장된 세션 복원 */
  async restoreSession() {
    if (!supabase) return false;
    try {
      const { data } = await supabase.auth.getSession();
      if (data?.session?.user) {
        currentUid  = data.session.user.id;
        syncEnabled = true;
        console.log('[Supabase] 세션 복원 완료:', currentUid);
        return true;
      }
    } catch (e) {
      console.error('[Supabase] 세션 복원 실패:', e.message);
    }
    return false;
  },

  getCurrentUserId() { return currentUid; },
};

// ── 내부 헬퍼 ────────────────────────────────────────────────
function logError(op, error) {
  if (error) console.error(`[Supabase sync] ${op}:`, error.message);
}

// ── 동기화 API (로컬 → 클라우드, fire-and-forget용) ─────────
const sync = {

  // ── 카테고리 ───────────────────────────────────────────────
  async category(cat) {
    if (!isReady()) return;
    const { error } = await supabase.from('categories').upsert({
      id:          cat.id,
      parent_id:   cat.parent_id || null,
      name:        cat.name,
      level:       cat.level,
      order_index: cat.order_index ?? 0,
    }, { onConflict: 'id' });
    logError('category.upsert', error);
  },

  async deleteCategory(id) {
    if (!isReady()) return;
    const { error } = await supabase.from('categories').delete().eq('id', id);
    logError('category.delete', error);
  },

  // ── 프로젝트 ───────────────────────────────────────────────
  async project(proj) {
    if (!isReady()) return;
    const { error } = await supabase.from('projects').upsert({
      id:          proj.id,
      user_id:     currentUid,
      username:    proj.username,
      name:        proj.name,
      description: proj.description || '',
      category_id: proj.category_id || null,
      status:      proj.status,
      is_deleted:  proj.is_deleted || false,
      created_at:  proj.created_at,
      updated_at:  proj.updated_at,
    }, { onConflict: 'id' });
    logError('project.upsert', error);
  },

  async hardDeleteProject(id) {
    if (!isReady()) return;
    const { error } = await supabase.from('projects').delete().eq('id', id);
    logError('project.hardDelete', error);
  },

  // ── 공정 ───────────────────────────────────────────────────
  async process(proc) {
    if (!isReady()) return;
    const { error } = await supabase.from('processes').upsert({
      id:           proc.id,
      project_id:   proc.project_id,
      name:         proc.name,
      parent_id:    proc.parent_id  || null,
      is_group:     proc.is_group   || false,
      order_index:  proc.order_index ?? 0,
      plan_start:   proc.plan_start  || null,
      plan_end:     proc.plan_end    || null,
      actual_start: proc.actual_start || null,
      actual_end:   proc.actual_end   || null,
      status:       proc.status,
      memo:         proc.memo || '',
      is_deleted:   proc.is_deleted || false,
      created_at:   proc.created_at,
      updated_at:   proc.updated_at,
    }, { onConflict: 'id' });
    logError('process.upsert', error);
  },

  // ── 메모 ───────────────────────────────────────────────────
  async memo(memo) {
    if (!isReady()) return;
    const { error } = await supabase.from('memos').upsert({
      id:         memo.id,
      project_id: memo.project_id,
      process_id: memo.process_id || null,
      content:    memo.content,
      tag:        memo.tag || null,
      author:     memo.author,
      created_at: memo.created_at,
      is_pinned:  memo.is_pinned || false,
    }, { onConflict: 'id' });
    logError('memo.upsert', error);
  },

  async deleteMemo(id) {
    if (!isReady()) return;
    const { error } = await supabase.from('memos').delete().eq('id', id);
    logError('memo.delete', error);
  },

  // ── 빠른 메모 ──────────────────────────────────────────────
  async quickMemo(qm) {
    if (!isReady()) return;
    const { error } = await supabase.from('quick_memos').upsert({
      id:         qm.id,
      user_id:    currentUid,
      username:   qm.username,
      content:    qm.content,
      type:       qm.type     || '기타',
      priority:   qm.priority || '보통',
      due_date:   qm.due_date || null,
      is_done:    qm.is_done  || false,
      created_at: qm.created_at,
      done_at:    qm.done_at  || null,
      updated_at: qm.updated_at || null,
    }, { onConflict: 'id' });
    logError('quickMemo.upsert', error);
  },

  async deleteQuickMemo(id) {
    if (!isReady()) return;
    const { error } = await supabase.from('quick_memos').delete().eq('id', id);
    logError('quickMemo.delete', error);
  },

  // ── 설정 ───────────────────────────────────────────────────
  async settings(s) {
    if (!isReady()) return;
    const { error } = await supabase.from('user_settings').upsert({
      user_id:           currentUid,
      briefing_time:     s.briefingTime     || '09:00',
      alarm_days_before: s.alarmDaysBefore  ?? 7,
      auto_start:        s.autoStart        || false,
      default_view:      s.defaultView      || 'card',
      week_start_day:    s.weekStartDay     ?? 1,
      theme:             s.theme            || 'dark',
      ai_provider:       s.aiProvider       || 'claude',
      ai_api_key:        s.aiApiKey         || '',
      ai_widget_enabled: s.aiWidgetEnabled  !== false,
      widget_x:          s.widgetX          ?? null,
      widget_y:          s.widgetY          ?? null,
      widget_expanded_w: s.widgetExpandedW  ?? null,
      widget_expanded_h: s.widgetExpandedH  ?? null,
      updated_at:        new Date().toISOString(),
    }, { onConflict: 'user_id' });
    logError('settings.upsert', error);
  },

  // ── 전체 데이터 일괄 업로드 (마이그레이션) ─────────────────
  async bulkUpload({ categories, projects, processes, memos, quickMemos }) {
    if (!isReady()) throw new Error('Supabase 미연결 또는 미인증 상태입니다.');
    const results = { categories: 0, projects: 0, processes: 0, memos: 0, quickMemos: 0 };

    // categories
    if (categories?.length) {
      const rows = categories.map(c => ({
        id: c.id, parent_id: c.parent_id || null,
        name: c.name, level: c.level, order_index: c.order_index ?? 0,
      }));
      const { error } = await supabase.from('categories').upsert(rows, { onConflict: 'id' });
      if (error) throw new Error('categories 업로드 실패: ' + error.message);
      results.categories = rows.length;
    }

    // projects
    if (projects?.length) {
      const rows = projects.map(p => ({
        id: p.id, user_id: currentUid, username: p.username,
        name: p.name, description: p.description || '',
        category_id: p.category_id || null, status: p.status,
        is_deleted: p.is_deleted || false,
        created_at: p.created_at, updated_at: p.updated_at,
      }));
      const { error } = await supabase.from('projects').upsert(rows, { onConflict: 'id' });
      if (error) throw new Error('projects 업로드 실패: ' + error.message);
      results.projects = rows.length;
    }

    // processes (부모→자식 순서 보장: parent_id=null 먼저)
    if (processes?.length) {
      const parents  = processes.filter(p => !p.parent_id);
      const children = processes.filter(p =>  p.parent_id);
      const ordered  = [...parents, ...children];
      const rows = ordered.map(p => ({
        id: p.id, project_id: p.project_id,
        name: p.name, parent_id: p.parent_id || null,
        is_group: p.is_group || false, order_index: p.order_index ?? 0,
        plan_start: p.plan_start || null, plan_end: p.plan_end || null,
        actual_start: p.actual_start || null, actual_end: p.actual_end || null,
        status: p.status, memo: p.memo || '',
        is_deleted: p.is_deleted || false,
        created_at: p.created_at, updated_at: p.updated_at,
      }));
      const { error } = await supabase.from('processes').upsert(rows, { onConflict: 'id' });
      if (error) throw new Error('processes 업로드 실패: ' + error.message);
      results.processes = rows.length;
    }

    // memos
    if (memos?.length) {
      const rows = memos.map(m => ({
        id: m.id, project_id: m.project_id,
        process_id: m.process_id || null,
        content: m.content, tag: m.tag || null,
        author: m.author, created_at: m.created_at,
        is_pinned: m.is_pinned || false,
      }));
      const { error } = await supabase.from('memos').upsert(rows, { onConflict: 'id' });
      if (error) throw new Error('memos 업로드 실패: ' + error.message);
      results.memos = rows.length;
    }

    // quick_memos
    if (quickMemos?.length) {
      const rows = quickMemos.map(q => ({
        id: q.id, user_id: currentUid, username: q.username,
        content: q.content, type: q.type || '기타',
        priority: q.priority || '보통', due_date: q.due_date || null,
        is_done: q.is_done || false, created_at: q.created_at,
        done_at: q.done_at || null, updated_at: q.updated_at || null,
      }));
      const { error } = await supabase.from('quick_memos').upsert(rows, { onConflict: 'id' });
      if (error) throw new Error('quick_memos 업로드 실패: ' + error.message);
      results.quickMemos = rows.length;
    }

    return results;
  },
};

// ── Supabase → 로컬 전체 데이터 다운로드 ────────────────────
const pull = {
  async all() {
    if (!isReady()) throw new Error('Supabase 미연결 또는 미인증 상태입니다.');

    const [
      { data: categories, error: e1 },
      { data: projects,   error: e2 },
      { data: processes,  error: e3 },
      { data: memos,      error: e4 },
      { data: quickMemos, error: e5 },
    ] = await Promise.all([
      supabase.from('categories').select('*').order('level').order('order_index'),
      supabase.from('projects').select('*').eq('user_id', currentUid),
      supabase.from('processes').select('*').in(
        'project_id',
        (await supabase.from('projects').select('id').eq('user_id', currentUid)).data?.map(p => p.id) ?? []
      ),
      supabase.from('memos').select('*').in(
        'project_id',
        (await supabase.from('projects').select('id').eq('user_id', currentUid)).data?.map(p => p.id) ?? []
      ),
      supabase.from('quick_memos').select('*').eq('user_id', currentUid),
    ]);

    if (e1) throw new Error('categories 조회 실패: ' + e1.message);
    if (e2) throw new Error('projects 조회 실패: ' + e2.message);
    if (e3) throw new Error('processes 조회 실패: ' + e3.message);
    if (e4) throw new Error('memos 조회 실패: ' + e4.message);
    if (e5) throw new Error('quick_memos 조회 실패: ' + e5.message);

    return {
      categories: categories ?? [],
      projects:   projects   ?? [],
      processes:  processes  ?? [],
      memos:      memos      ?? [],
      quickMemos: quickMemos ?? [],
    };
  },
};

module.exports = { init, getClient, isReady, getSyncStatus, auth, sync, pull };
