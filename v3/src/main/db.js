/**
 * db.js — JAE-VIS v2 데이터 관리 레이어
 * 저장소: electron-store (JSON 파일 기반)
 * 실제 배포 시 SQLite 마이그레이션 고려 가능
 */
const Store = require('electron-store');
const crypto = require('crypto');

// ============================================================
// [사용자 설정] 데이터 저장 위치
// 기본값: %APPDATA%\jae-vis-v2-prototype\
// 변경 원할 경우 아래 cwd 주석 해제 후 경로 수정
// ============================================================
const store = new Store({
  name: 'jae-vis-v2-data',
  // cwd: 'C:/MyData/JAE-VIS',  // 커스텀 저장 경로
});

// ============================================================
// [사용자 설정] 기본 대분류 목록 (최초 실행 시 자동 세팅)
// 현장 업무에 맞게 항목·이름 자유롭게 수정 가능
// ============================================================
const DEFAULT_CATEGORIES = [
  // 대분류 (level: 1)
  { id: 'cat_01', parent_id: null, name: '계획서', level: 1, order_index: 0 },
  { id: 'cat_02', parent_id: null, name: '점검',   level: 1, order_index: 1 },
  { id: 'cat_03', parent_id: null, name: '검토',   level: 1, order_index: 2 },
  { id: 'cat_04', parent_id: null, name: '기타',   level: 1, order_index: 3 },
  // 중분류 (level: 2) — 점검에만 존재
  { id: 'cat_21', parent_id: 'cat_02', name: '건진법', level: 2, order_index: 0 },
  { id: 'cat_22', parent_id: 'cat_02', name: '시특법', level: 2, order_index: 1 },
  { id: 'cat_23', parent_id: 'cat_02', name: '관리법', level: 2, order_index: 2 },
];

// ============================================================
// [사용자 설정] 앱 기본 설정값
// ============================================================
const DEFAULT_SETTINGS = {
  briefingTime: '09:00',
  alarmDaysBefore: 7,
  autoStart: false,
  defaultView: 'card',
  weekStartDay: 1,
  theme: 'dark',
  autoLogin: false,
  autoLoginUser: null,
  // Phase C — 알림 설정
  notifEnabled:        true,
  notifRemindDays:     [3, 1],
  notifExcludeWeekend: false,
  notifExcludeStart:   22,
  notifExcludeEnd:     8,
  // Phase B — 챗봇 스타일
  chatStyle: 'concise',
};

// ─── 유틸 ────────────────────────────────────────────────────
function generateId(prefix = 'id') {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
}

function hashPin(pin) {
  return crypto.createHash('sha256').update(pin + 'jae-vis-salt').digest('hex');
}

// ─── 초기화 ──────────────────────────────────────────────────
function initializeData() {
  if (!store.has('initialized')) {
    store.set('users', []);
    store.set('projects', []);
    store.set('processes', []);
    store.set('memos', []);
    store.set('quickMemos', []);
    store.set('categories', DEFAULT_CATEGORIES);
    store.set('settings', DEFAULT_SETTINGS);
    store.set('initialized', true);
  }
  // 분류 구조 v2 마이그레이션 (계획서/점검/검토/기타 + 건진법/시특법/관리법)
  if (!store.get('categoriesV2')) {
    store.set('categories', DEFAULT_CATEGORIES);
    store.set('categoriesV2', true);
  }
  // quickMemos 키 없는 기존 설치 대응
  if (!store.has('quickMemos')) {
    store.set('quickMemos', []);
  }
  // manually_completed 필드 마이그레이션
  if (!store.get('projectsManualCompleted')) {
    const list = store.get('projects', []).map(p => ({
      ...p,
      manually_completed: p.manually_completed || false,
    }));
    store.set('projects', list);
    store.set('projectsManualCompleted', true);
  }

  // users role 마이그레이션 — 기존 계정에 role 없으면 채우고, 최초 생성 계정을 admin으로 지정
  if (!store.get('usersRoleV1')) {
    const sorted = store.get('users', []).slice().sort((a, b) =>
      new Date(a.createdAt || 0) - new Date(b.createdAt || 0));
    const firstId = sorted[0] ? sorted[0].id : null;
    const migrated = store.get('users', []).map(u => ({
      ...u,
      role: u.role || (firstId && u.id === firstId ? 'admin' : 'member'),
    }));
    store.set('users', migrated);
    store.set('usersRoleV1', true);
  }

  // quickMemos v3 마이그레이션 — type / priority / due_date 필드 추가
  if (!store.get('quickMemosV3')) {
    const existing = store.get('quickMemos', []);
    const migrated = existing.map(m => ({
      ...m,
      type:     m.type     || '기타',
      priority: m.priority || '보통',
      due_date: m.due_date || null,
    }));
    store.set('quickMemos', migrated);
    store.set('quickMemosV3', true);
  }
  // 공정 자동생성 템플릿 마이그레이션 — 렌더러에 하드코딩돼 있던 분류별 기본 공정을
  // 카테고리 데이터로 이관. 이후로는 설정창에서 사용자가 직접 수정한다.
  // 템플릿 = "이 분류의 1회분 공정 세트". 프로젝트 등록 시 자동생성에 쓰이고,
  // 항목(그룹)을 추가할 때 하위 공정의 기본값으로도 쓰인다.
  // 검토·기타는 기본값 없이 비워두고 사용자가 설정창에서 채운다.
  // cat_21(건진법)은 항상 항목 단위로 진행되므로 이 목록이 항목의 하위 공정이 된다.
  if (!store.get('catTemplatesV2')) {
    const seed = {
      cat_01: ['자료요청', '보고서작성', '제출', '제본', '청구'],                          // 계획서
      cat_21: ['현장점검', '보고서작성', '제출', '제본', '청구'],                          // 건진법 (항목 하위 공정)
      cat_22: ['착수 및 계약', '현장점검', '보고서작성', '제출', '제본', '준공 및 청구'],  // 시특법
      cat_23: ['계약', '현장점검', '보고서작성', '제출', '제본', '청구'],                  // 관리법
    };
    store.set('categories', store.get('categories', []).map(c =>
      // 이미 템플릿이 있으면 건드리지 않는다 (사용자 편집분·클라우드에서 내려받은 값 보호)
      (seed[c.id] && !Array.isArray(c.template_processes))
        ? { ...c, template_processes: seed[c.id] }
        : c
    ));
    store.set('catTemplatesV1', true);
    store.set('catTemplatesV2', true);
  }

  const currentSettings = store.get('settings', {});
  // 'jarvis' 테마 → 'dark'로 마이그레이션
  if (currentSettings.theme === 'jarvis' || !currentSettings.theme) {
    currentSettings.theme = 'dark';
  }
  const mergedSettings = { ...DEFAULT_SETTINGS, ...currentSettings };
  store.set('settings', mergedSettings);

  // 프로젝트 상태 일괄 보정 — 공정 전부 완료 시 '완료'로 자동 분류.
  // 그룹 버그로 잘못 분류돼 있던 기존 프로젝트, 모바일에서 직접 완료 처리된
  // 프로젝트도 데스크탑 시작 시 정상 분류된다. (변경된 것만 갱신 → 부담 없음)
  store.get('projects', [])
    .filter(p => !p.is_deleted)
    .forEach(p => projects.refreshStatus(p.id));
}

// ─── 사용자 API ──────────────────────────────────────────────
const users = {
  getAll: () => store.get('users', []).map(u => ({ id: u.id, name: u.name, role: u.role || 'member' })),
  find: (name) => store.get('users', []).find(u => u.name === name),
  create: (name, pin, role = 'member') => {
    const list = store.get('users', []);
    if (list.find(u => u.name === name)) throw new Error('이미 존재하는 사용자명입니다.');
    if (!/^\d{4}$/.test(pin)) throw new Error('PIN은 4자리 숫자여야 합니다.');
    // 시스템 최초 계정은 admin — 단, 클라우드 연결 이력이 없는 PC(= 진짜 최초 설치본)에서만.
    // 이미 Supabase URL이 저장된 PC(팀원 PC가 로그인 화면에서 클라우드 연결을 거친 경우)는
    // 로컬 users가 비어있어도 자동 admin 승격을 하지 않는다 — 그렇지 않으면 팀원이 "신규 등록"
    // 경로로 우회 가입할 때마다 그 PC 안에서 admin이 되어버리는 멀티 PC 보안 허점이 생긴다.
    const isFreshInstall = list.length === 0 && !store.get('settings', {}).supabaseUrl;
    const safeRole = isFreshInstall ? 'admin' : ((role === 'admin' || role === 'member') ? role : 'member');
    const newUser = {
      id: generateId('user'),
      name,
      pin: hashPin(pin),
      role: safeRole,
      createdAt: new Date().toISOString(),
    };
    store.set('users', [...list, newUser]);
    return { id: newUser.id, name: newUser.name, role: newUser.role };
  },
  verify: (name, pin) => {
    const user = store.get('users', []).find(u => u.name === name);
    if (!user) return false;
    return user.pin === hashPin(pin);
  },
  setRole: (id, role) => {
    const safeRole = (role === 'admin' || role === 'member') ? role : 'member';
    store.set('users', store.get('users', []).map(u => u.id === id ? { ...u, role: safeRole } : u));
  },
};

// ─── 카테고리 API ────────────────────────────────────────────
const categories = {
  getAll: () => store.get('categories', []),
  getByLevel: (level) => store.get('categories', []).filter(c => c.level === level),
  getChildren: (parentId) => store.get('categories', [])
    .filter(c => c.parent_id === parentId)
    .sort((a, b) => a.order_index - b.order_index),
  // 분류명 → 풀 경로 텍스트 반환 (예: "점검 > 안전점검")
  getBreadcrumb: (categoryId) => {
    const cats = store.get('categories', []);
    const result = [];
    let current = cats.find(c => c.id === categoryId);
    while (current) {
      result.unshift(current.name);
      current = cats.find(c => c.id === current.parent_id);
    }
    return result.join(' > ');
  },
  create: (data) => {
    const list = store.get('categories', []);
    const newCat = {
      id: generateId('cat'),
      parent_id: data.parent_id || null,
      name: data.name,
      level: data.level,
      order_index: data.order_index ?? list.filter(c => c.parent_id === data.parent_id).length,
    };
    store.set('categories', [...list, newCat]);
    return newCat;
  },
  update: (id, data) => {
    store.set('categories', store.get('categories', []).map(c => c.id === id ? { ...c, ...data } : c));
  },
  delete: (id) => {
    // ID 기반 참조이므로 프로젝트 데이터는 영향 없음 — 하위 분류도 함께 삭제
    const getDescendants = (parentId) => {
      const children = store.get('categories', []).filter(c => c.parent_id === parentId);
      return children.flatMap(c => [c.id, ...getDescendants(c.id)]);
    };
    const toDelete = new Set([id, ...getDescendants(id)]);
    store.set('categories', store.get('categories', []).filter(c => !toDelete.has(c.id)));
  },
};

// ─── 프로젝트 API ────────────────────────────────────────────
const projects = {
  getAll: (username) => store.get('projects', []).filter(p => p.username === username && !p.is_deleted),
  getDeleted: (username) => store.get('projects', []).filter(p => p.username === username && p.is_deleted),
  getById: (id) => store.get('projects', []).find(p => p.id === id),

  // 프로젝트 상태 자동 계산 (공정 데이터 기반)
  // - 항목(그룹) 컨테이너(is_group)는 상태가 '대기' 고정이므로 집계에서 제외.
  //   (제외하지 않으면 항목을 쓰는 프로젝트는 영원히 '완료'가 되지 않음)
  // - 수동 지정한 '청구완료' 또는 manually_completed=true인 '완료'는 자동 계산이 덮어쓰지 않음.
  calcStatus: (projectId) => {
    const cur = projects.getById(projectId);
    if (cur && cur.status === '청구완료') return '청구완료';
    if (cur && cur.manually_completed) return '완료';

    const procs = store.get('processes', [])
      .filter(p => p.project_id === projectId && !p.is_deleted && !p.is_group);
    if (procs.length === 0) return '대기';
    if (procs.every(p => p.status === '완료')) return '완료';
    if (procs.some(p => p.status === '진행' || p.status === '완료')) return '진행중';
    return '대기';
  },

  create: (username, data) => {
    const list = store.get('projects', []);
    const newProj = {
      id: generateId('proj'),
      username,
      name: data.name,
      description: data.description || '',
      category_id: data.category_id || null,
      status: '대기',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      is_deleted: false,
    };
    store.set('projects', [...list, newProj]);
    return newProj;
  },
  update: (id, data) => {
    const list = store.get('projects', []).map(p =>
      p.id === id ? { ...p, ...data, updated_at: new Date().toISOString() } : p
    );
    store.set('projects', list);
    return store.get('projects', []).find(p => p.id === id);
  },
  refreshStatus: (projectId) => {
    const status = projects.calcStatus(projectId);
    const cur = projects.getById(projectId);
    if (cur && cur.status !== status) projects.update(projectId, { status });
    return status;
  },
  completeProject: (id) => {
    const result = projects.update(id, { status: '완료', manually_completed: true });
    return result;
  },
  revertProject: (id) => {
    projects.update(id, { manually_completed: false });
    const status = projects.refreshStatus(id);
    return projects.getById(id);
  },
  softDelete: (id) => projects.update(id, { is_deleted: true }),
  restore:    (id) => projects.update(id, { is_deleted: false }),
  hardDelete: (id) => {
    // 프로젝트와 관련 공정·메모 완전 삭제
    store.set('projects',  store.get('projects',  []).filter(p => p.id !== id));
    store.set('processes', store.get('processes', []).filter(p => p.project_id !== id));
    store.set('memos',     store.get('memos',     []).filter(m => m.project_id !== id));
  },
};

// ─── 공정 API ────────────────────────────────────────────────
const processes = {
  getByProject: (projectId) =>
    store.get('processes', [])
      .filter(p => p.project_id === projectId && !p.is_deleted)
      .sort((a, b) => a.order_index - b.order_index),
  getById: (id) => store.get('processes', []).find(p => p.id === id),

  create: (data) => {
    const list = store.get('processes', []);
    const projectProcs = list.filter(p => p.project_id === data.project_id && !p.is_deleted);
    const newProc = {
      id: generateId('proc'),
      project_id: data.project_id,
      name: data.name,
      parent_id: data.parent_id || null,   // 항목(그룹) 자식용
      is_group: data.is_group || false,     // 항목(그룹) 컨테이너
      order_index: data.order_index ?? projectProcs.length,
      plan_start: data.plan_start || null,
      plan_end: data.plan_end || null,
      actual_start: data.actual_start || null,
      actual_end: data.actual_end || null,
      status: '대기',
      memo: '',
      is_deleted: false,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    store.set('processes', [...list, newProc]);
    if (!data.parent_id) projects.refreshStatus(data.project_id);
    return newProc;
  },
  update: (id, data) => {
    const proc = store.get('processes', []).find(p => p.id === id);
    if (!proc) return null;

    const updated = store.get('processes', []).map(p =>
      p.id === id ? { ...p, ...data, updated_at: new Date().toISOString() } : p
    );
    store.set('processes', updated);
    projects.refreshStatus(proc.project_id);
    return store.get('processes', []).find(p => p.id === id);
  },
  softDelete: (id) => {
    const proc = store.get('processes', []).find(p => p.id === id);
    store.set('processes', store.get('processes', []).map(p =>
      p.id === id ? { ...p, is_deleted: true } : p
    ));
    if (proc) projects.refreshStatus(proc.project_id);
  },
  reorder: (projectId, orderedIds) => {
    store.set('processes', store.get('processes', []).map(p => {
      if (p.project_id !== projectId) return p;
      const idx = orderedIds.indexOf(p.id);
      return idx >= 0 ? { ...p, order_index: idx } : p;
    }));
  },
};

// ─── 메모 API ────────────────────────────────────────────────
const memos = {
  getByProject: (projectId) =>
    store.get('memos', [])
      .filter(m => m.project_id === projectId)
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at)),
  getByProcess: (processId) =>
    store.get('memos', [])
      .filter(m => m.process_id === processId)
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at)),
  create: (data) => {
    const list = store.get('memos', []);
    const newMemo = {
      id: generateId('memo'),
      project_id: data.project_id,
      process_id: data.process_id || null,
      content: data.content,
      tag: data.tag || null,   // '중요' | '보완' | '확인필요' | null
      author: data.author,
      created_at: new Date().toISOString(),
      is_pinned: false,
    };
    store.set('memos', [...list, newMemo]);
    return newMemo;
  },
  update: (id, data) => {
    store.set('memos', store.get('memos', []).map(m => m.id === id ? { ...m, ...data } : m));
  },
  delete: (id) => {
    store.set('memos', store.get('memos', []).filter(m => m.id !== id));
  },
};

// ─── 빠른 메모 / 단기 작업 API ─────────────────────────────
const PRIORITY_ORDER = { '긴급': 0, '보통': 1, '낮음': 2 };

const quickMemos = {
  getActive: (username) =>
    store.get('quickMemos', [])
      .filter(m => m.username === username && !m.is_done)
      .sort((a, b) => {
        // 우선순위 정렬 → 같으면 최신순
        const pa = PRIORITY_ORDER[a.priority] ?? 1;
        const pb = PRIORITY_ORDER[b.priority] ?? 1;
        if (pa !== pb) return pa - pb;
        return new Date(b.created_at) - new Date(a.created_at);
      }),

  getDone: (username) =>
    store.get('quickMemos', [])
      .filter(m => m.username === username && m.is_done)
      .sort((a, b) => new Date(b.done_at || b.created_at) - new Date(a.done_at || a.created_at)),

  // 완료 항목을 기간(daily/weekly/monthly)으로 필터링
  getDonePeriod: (username, period) => {
    const now  = new Date();
    const all  = store.get('quickMemos', []).filter(m => m.username === username && m.is_done && m.done_at);

    const filtered = all.filter(m => {
      const d = new Date(m.done_at);
      if (period === 'daily') {
        return d.toDateString() === now.toDateString();
      }
      if (period === 'weekly') {
        // 이번 주 월요일 ~ 일요일
        const startOfWeek = new Date(now);
        startOfWeek.setDate(now.getDate() - ((now.getDay() + 6) % 7));
        startOfWeek.setHours(0, 0, 0, 0);
        const endOfWeek = new Date(startOfWeek);
        endOfWeek.setDate(startOfWeek.getDate() + 6);
        endOfWeek.setHours(23, 59, 59, 999);
        return d >= startOfWeek && d <= endOfWeek;
      }
      if (period === 'monthly') {
        return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
      }
      return true;
    });
    return filtered.sort((a, b) => new Date(b.done_at) - new Date(a.done_at));
  },

  // data: 문자열(하위호환) 또는 { content, type, priority, due_date }
  create: (username, data) => {
    const list = store.get('quickMemos', []);
    const isStr = typeof data === 'string';
    const newMemo = {
      id:         generateId('qm'),
      username,
      content:    isStr ? data : (data.content || ''),
      type:       isStr ? '기타' : (data.type     || '기타'),
      priority:   isStr ? '보통' : (data.priority || '보통'),
      due_date:   isStr ? null   : (data.due_date || null),
      is_done:    false,
      created_at: new Date().toISOString(),
    };
    store.set('quickMemos', [...list, newMemo]);
    return newMemo;
  },

  complete: (id) => {
    store.set('quickMemos', store.get('quickMemos', []).map(m =>
      m.id === id ? { ...m, is_done: true, done_at: new Date().toISOString() } : m
    ));
  },

  delete: (id) => {
    store.set('quickMemos', store.get('quickMemos', []).filter(m => m.id !== id));
  },

  // data: 문자열(하위호환) 또는 { content, type, priority, due_date }
  update: (id, data) => {
    store.set('quickMemos', store.get('quickMemos', []).map(m => {
      if (m.id !== id) return m;
      const isStr = typeof data === 'string';
      return {
        ...m,
        content:    isStr ? data : (data.content  !== undefined ? data.content  : m.content),
        type:       isStr ? m.type : (data.type     !== undefined ? data.type     : m.type),
        priority:   isStr ? m.priority : (data.priority !== undefined ? data.priority : m.priority),
        due_date:   isStr ? m.due_date : (data.due_date  !== undefined ? data.due_date  : m.due_date),
        updated_at: new Date().toISOString(),
      };
    }));
  },
};

// ─── 설정 API ────────────────────────────────────────────────
const settings = {
  get: () => store.get('settings', DEFAULT_SETTINGS),
  update: (data) => {
    const current = store.get('settings', DEFAULT_SETTINGS);
    store.set('settings', { ...current, ...data });
    return store.get('settings');
  },
  setAutoLogin: (username) => {
    const current = store.get('settings', DEFAULT_SETTINGS);
    store.set('settings', { ...current, autoLogin: true, autoLoginUser: username });
  },
  clearAutoLogin: () => {
    const current = store.get('settings', DEFAULT_SETTINGS);
    store.set('settings', { ...current, autoLogin: false, autoLoginUser: null });
  },
  getAutoLoginUser: () => {
    const s = store.get('settings', DEFAULT_SETTINGS);
    if (!s.autoLogin || !s.autoLoginUser) return null;
    const exists = store.get('users', []).some(u => u.name === s.autoLoginUser);
    return exists ? s.autoLoginUser : null;
  },

  // AI 설정 전체 조회
  getAiSettings: () => {
    const s = store.get('settings', DEFAULT_SETTINGS);
    return {
      aiProvider:      s.aiProvider      || 'claude',
      aiApiKey:        s.aiApiKey        || '',
      aiWidgetEnabled: s.aiWidgetEnabled !== false,
      widgetX:         s.widgetX,
      widgetY:         s.widgetY,
    };
  },

  // AI 설정 일괄 저장
  saveAiSettings: (data) => {
    const current = store.get('settings', DEFAULT_SETTINGS);
    store.set('settings', { ...current, ...data });
  },

  // 단일 키 저장 (위젯 위치 등)
  saveAiSetting: (key, value) => {
    const current = store.get('settings', DEFAULT_SETTINGS);
    store.set('settings', { ...current, [key]: value });
  },
};

// ─── 알림 중복방지 로그 ──────────────────────────────────────
const notifLog = {
  has: (key) => !!(store.get('notifLog', {})[key]),
  set: (key) => {
    const log = store.get('notifLog', {});
    log[key] = true;
    // 7일 지난 키 자동 정리
    const threshold = new Date(); threshold.setDate(threshold.getDate() - 7);
    const threshStr = threshold.toISOString().slice(0, 10);
    Object.keys(log).forEach(k => { if (k.slice(-10) < threshStr) delete log[k]; });
    store.set('notifLog', log);
  },
};

// ─── 앱 내 알림 목록 ─────────────────────────────────────────
const notifications = {
  getAll:       ()   => store.get('notifications', []).slice().reverse(), // 최신순
  getUnread:    ()   => store.get('notifications', []).filter(n => !n.is_read),
  add:          (n)  => {
    const list = [...store.get('notifications', []), n].slice(-100);
    store.set('notifications', list);
    return n;
  },
  markAllRead:  ()   => store.set('notifications',
    store.get('notifications', []).map(n => ({ ...n, is_read: true }))),
  markRead:     (id) => store.set('notifications',
    store.get('notifications', []).map(n => n.id === id ? { ...n, is_read: true } : n)),
  clear:        ()   => store.set('notifications', []),
};

// ─── 변경 이력 타임라인 ───────────────────────────────────────
const changeLogs = {
  getByUser: (username) =>
    store.get('changeLogs', [])
      .filter(l => l.username === username)
      .slice().reverse(),
  getByProject: (projectId) =>
    store.get('changeLogs', [])
      .filter(l => l.project_id === projectId)
      .slice().reverse(),
  add: (data) => {
    const entry = { id: generateId('log'), ...data, created_at: new Date().toISOString() };
    store.set('changeLogs', [...store.get('changeLogs', []), entry].slice(-1000));
    return entry;
  },
  clear: () => store.set('changeLogs', []),
};

module.exports = { initializeData, users, categories, projects, processes, memos, quickMemos, settings, notifLog, notifications, changeLogs };
