const { ipcMain, app, BrowserWindow, dialog } = require('electron');
const path  = require('path');
const fs    = require('fs');
const db    = require('./db');
const cloud = require('./supabase');
const https = require('https');

let currentUsername = null;

function setCurrentUser(name) {
  currentUsername = name;
  if (name) autoResyncOnLogin(name);
}
function getCurrentUser()     { return currentUsername; }

// ── 구버전 로컬 데이터 가져오기 ──────────────────────────────
// 구버전(jae-vis-v3 등)을 쓰던 팀원 PC의 로컬 데이터를 현재 로그인 계정 소유로 가져온다.
// 자동 이전(migrateFromV2)은 남의 계정·autoLogin까지 통째로 끌어와 사고를 냈기에 제거했고,
// 대신 "무엇을 가져올지 사용자가 보고 고르는" 명시적 경로만 남긴다.
//
// 주의해야 할 두 가지:
//  1) 프로젝트는 id 기준으로 클라우드에 upsert된다. 구버전 데이터가 남의 환경 복사본에서
//     출발했다면 id가 겹쳐, 가져와서 올리는 순간 남의 클라우드 데이터를 덮어쓴다.
//     → 스캔 단계에서 로컬/클라우드 중복을 표시하고 기본 선택에서 제외한다.
//  2) projects.category_id에 외래키가 걸려 있어, 클라우드에 없는 분류를 참조하면
//     업로드가 통째로 실패한다. → 분류는 이름으로 다시 매칭하고, 못 찾으면 null로 둔다.

function readLegacyStore(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8');
  const data = JSON.parse(raw);
  if (!Array.isArray(data.projects) || !Array.isArray(data.processes)) {
    throw new Error('JAE-VIS 데이터 파일이 아닙니다. (projects/processes 없음)');
  }
  return data;
}

// 구버전의 category_id를 현재 분류 트리로 매핑한다.
// id가 그대로 있으면 그대로 쓰고, 없으면 구버전 파일의 분류 이름으로 현재 트리에서 찾는다.
function buildCategoryMap(legacy) {
  const localCats = db.categories.getAll();
  const localById = new Set(localCats.map(c => c.id));
  const map = new Map();
  for (const lc of legacy.categories || []) {
    if (localById.has(lc.id)) { map.set(lc.id, lc.id); continue; }
    const byName = localCats.find(c => c.name === lc.name && c.level === lc.level);
    map.set(lc.id, byName ? byName.id : null);
  }
  return map;
}

function setupLegacyImportHandlers() {
  ipcMain.handle('legacy-pick-file', async () => {
    const res = await dialog.showOpenDialog({
      title: '구버전 JAE-VIS 데이터 파일 선택',
      defaultPath: app.getPath('appData'),
      properties: ['openFile'],
      filters: [{ name: 'JAE-VIS 데이터', extensions: ['json'] }],
    });
    if (res.canceled || !res.filePaths[0]) return null;
    return res.filePaths[0];
  });

  // 파일을 읽어 "무엇이 들어있는지"만 돌려준다. 아무것도 쓰지 않는다.
  ipcMain.handle('legacy-scan', async (_, filePath) => {
    const legacy   = readLegacyStore(filePath);
    const catMap   = buildCategoryMap(legacy);
    const localIds = new Set(db.projects.getAll(currentUsername).map(p => p.id));
    const allLocalIds = new Set((db.projects.getAll(currentUsername).concat(db.projects.getDeleted(currentUsername))).map(p => p.id));

    // 연결돼 있으면 클라우드에 이미 있는 프로젝트 id도 확인해 덮어쓰기 사고를 막는다
    let cloudIds = null;
    if (cloud.isReady()) {
      try {
        const team = await cloud.pull.teamProjects();
        cloudIds = new Map((team.projects || []).map(p => [p.id, p.username]));
      } catch (e) {
        console.warn('[legacy-scan] 클라우드 조회 실패, 중복 검사 생략:', e.message);
      }
    }

    const legacyCatName = (id) => (legacy.categories || []).find(c => c.id === id)?.name || '';
    const projects = legacy.projects.filter(p => !p.is_deleted).map(p => {
      const mapped = p.category_id ? catMap.get(p.category_id) : null;
      return {
        id:            p.id,
        name:          p.name,
        owner:         p.username,
        status:        p.status,
        created_at:    p.created_at,
        procCount:     legacy.processes.filter(q => q.project_id === p.id && !q.is_deleted).length,
        memoCount:     (legacy.memos || []).filter(m => m.project_id === p.id).length,
        categoryName:  legacyCatName(p.category_id),
        categoryLost:  !!(p.category_id && !mapped),   // 현재 트리에서 못 찾은 분류
        existsLocally: allLocalIds.has(p.id),
        cloudOwner:    cloudIds ? (cloudIds.get(p.id) ?? null) : null,
      };
    });

    return {
      filePath,
      targetUser:    currentUsername,
      cloudChecked:  cloudIds !== null,
      owners:        [...new Set(legacy.projects.map(p => p.username))],
      projects,
    };
  });

  // 선택한 프로젝트만 현재 계정 소유로 병합한다. 분류·계정·설정은 가져오지 않는다.
  ipcMain.handle('legacy-import', async (_, filePath, selectedIds) => {
    if (!currentUsername) throw new Error('로그인 후 이용하세요.');
    const legacy = readLegacyStore(filePath);
    const catMap = buildCategoryMap(legacy);
    const wanted = new Set(selectedIds || []);

    const Store = require('electron-store');
    const s     = new Store({ name: 'jae-vis-v2-data' });

    const projects  = s.get('projects', []);
    const processes = s.get('processes', []);
    const memos     = s.get('memos', []);
    const existingProjIds = new Set(projects.map(p => p.id));
    const existingProcIds = new Set(processes.map(p => p.id));
    const existingMemoIds = new Set(memos.map(m => m.id));

    const result = { projects: 0, processes: 0, memos: 0, skipped: 0, categoryLost: 0 };
    const importedProjIds = [];

    for (const lp of legacy.projects) {
      if (!wanted.has(lp.id)) continue;
      if (existingProjIds.has(lp.id)) { result.skipped++; continue; }

      const mapped = lp.category_id ? catMap.get(lp.category_id) : null;
      if (lp.category_id && !mapped) result.categoryLost++;

      projects.push({
        ...lp,
        username:           currentUsername,   // 소유자를 현재 계정으로 이관
        category_id:        mapped || null,    // 외래키 위반 방지
        manually_completed: lp.manually_completed || false,
        is_deleted:         lp.is_deleted || false,
      });
      importedProjIds.push(lp.id);
      result.projects++;
    }

    const projSet = new Set(importedProjIds);
    for (const lproc of legacy.processes) {
      if (!projSet.has(lproc.project_id) || existingProcIds.has(lproc.id)) continue;
      processes.push({ ...lproc });
      result.processes++;
    }
    for (const lm of (legacy.memos || [])) {
      if (!projSet.has(lm.project_id) || existingMemoIds.has(lm.id)) continue;
      memos.push({ ...lm });
      result.memos++;
    }

    s.set('projects', projects);
    s.set('processes', processes);
    s.set('memos', memos);

    // 가져온 프로젝트 상태를 공정 기준으로 다시 계산 (구버전 상태값이 낡았을 수 있음)
    importedProjIds.forEach(id => db.projects.refreshStatus(id));

    // 클라우드에 연결돼 있으면 가져온 것만 즉시 올린다 (팀원은 분류를 올리지 않으므로 안전)
    if (cloud.isReady()) {
      for (const id of importedProjIds) {
        const proj = db.projects.getById(id);
        if (!proj) continue;
        await cloud.sync.project(proj);
        for (const pr of db.processes.getByProject(id)) await cloud.sync.process(pr);
        for (const m of db.memos.getByProject(id))      await cloud.sync.memo(m);
      }
      result.uploaded = importedProjIds.length;
    }

    return result;
  });
}

// 분류(카테고리) 트리는 팀 전체가 공유하는 값이라 관리자만 고칠 수 있다.
// 렌더러에서 설정 화면의 분류 관리 카드를 숨기지만, 화면을 숨기는 것은 방어가 아니므로
// 실제 쓰기 경로인 여기서 막는다. (create/update/delete는 그대로 클라우드에 반영되고,
// 소분류는 PC마다 랜덤 ID로 생성되므로 팀원 PC가 손대면 팀 전체 분류가 깨진다.)
function assertCategoryAdmin() {
  const role = db.users.find(currentUsername)?.role;
  if (role !== 'admin') {
    throw new Error('분류 관리는 관리자만 할 수 있습니다.');
  }
}

// 로컬 데이터 전체 → Supabase 업로드 (cloud-migrate 핸들러와 로그인 시 자동 재동기화가 공유)
async function syncLocalDataToCloud(username) {
  const s = db.settings.get();
  // 분류(카테고리) 트리는 관리자만 업로드한다 — 소분류(level 3)는 PC마다 랜덤 ID로 생성되므로,
  // 팀원 PC가 각자 업로드하면 같은 이름의 분류가 서로 다른 id로 중복 등록될 수 있다.
  const isAdmin = db.users.find(username)?.role === 'admin';
  const categories = isAdmin ? db.categories.getAll() : [];
  const allProjects = [
    ...db.projects.getAll(username),
    ...db.projects.getDeleted(username),
  ];
  const allProcesses = [];
  for (const p of allProjects) {
    allProcesses.push(...db.processes.getByProject(p.id));
  }
  const allMemos = [];
  for (const p of allProjects) {
    allMemos.push(...db.memos.getByProject(p.id));
  }
  const qmActive = db.quickMemos.getActive(username);
  const qmDone   = db.quickMemos.getDone(username);

  const result = await cloud.sync.bulkUpload({
    categories,
    projects:   allProjects,
    processes:  allProcesses,
    memos:      allMemos,
    quickMemos: [...qmActive, ...qmDone],
  });
  await cloud.sync.settings(s);
  return result;
}

// 로그인 직후 자동 재동기화 — 오프라인 중 만들어져 fireSync가 실패했던 변경사항을
// 앱을 다시 켤 때(=온라인 복귀 시점) 자동으로 캐치업한다. 실패해도 로그인 자체는 막지 않는다.
// 2초 지연: 앱 시작 시 initCloudFromSettings()의 세션 복원(비동기)이 끝날 시간을 확보하기 위함.
function autoResyncOnLogin(username) {
  setTimeout(() => {
    if (!cloud.isReady()) return;
    // 로스터 캐치업: 로그인한 본인을 team_members에 올린다.
    // 등록 시점에 클라우드가 아직 연결되지 않았거나(오프라인/연결 전 가입),
    // 로스터 동기화가 없던 구버전으로 가입한 팀원은 클라우드 로스터에 빠져 있어
    // 관리자 화면에 영영 나타나지 않는다. upsert(id 기준)라 매번 올려도 안전하다.
    const me = db.users.find(username);
    if (me) {
      fireSync(() => cloud.sync.teamMember({ id: me.id, name: me.name, role: me.role || 'member' }));
    }
    syncLocalDataToCloud(username).catch(e =>
      console.error('[Supabase 자동 재동기화]', e.message));
  }, 2000);
}

// 자동실행(로그인 시 시작) 설정 객체.
// 실행 파일 경로와 인자를 명시해, 부팅 시 앱 경로 없이 실행돼
// Electron 기본 환영 화면이 뜨는 문제를 방지한다.
// (특히 개발 모드 electron.exe 는 실행할 앱 경로를 인자로 받아야 한다.)
function getLoginItemSettings(openAtLogin) {
  const opts = {
    openAtLogin,
    name: 'JAE-VIS v4',
    path: process.execPath,
  };
  if (!app.isPackaged) {
    opts.args = [path.resolve(app.getAppPath())];
  }
  return opts;
}

// fire-and-forget: 동기화 오류가 UI를 블로킹하지 않도록
function fireSync(fn) {
  Promise.resolve().then(fn).catch(e =>
    console.error('[Supabase sync]', e.message)
  );
}

// 앱 시작 시 저장된 Supabase 설정으로 자동 초기화
function initCloudFromSettings() {
  try {
    const s = db.settings.get();
    if (s.supabaseUrl && s.supabaseAnonKey) {
      const ok = cloud.init(s.supabaseUrl, s.supabaseAnonKey);
      if (ok) {
        cloud.auth.restoreSession().then(restored => {
          if (restored) console.log('[Supabase] 자동 연결 완료');
        });
      }
    }
  } catch (e) {
    console.error('[Supabase] 설정 로드 실패:', e.message);
  }
}

function setupIpcHandlers() {
  // 앱 시작 시 Supabase 자동 연결
  initCloudFromSettings();
  setupLegacyImportHandlers();

  // 화면에 실제 앱 버전을 띄우기 위함 — 어느 PC에 어떤 빌드가 깔렸는지 확인할 수단이 필요하다
  ipcMain.handle('get-app-version', () => app.getVersion());

  // ─── 사용자 ───────────────────────────────────────────────
  ipcMain.handle('get-users',   () => db.users.getAll());
  // 로그인 화면 "신규 등록" — 관리자가 만들어주지 않은 팀원이 직접 가입하는 경로.
  // 이 경로도 반드시 클라우드 로스터에 올려야 한다. 올리지 않으면 그 팀원은 관리자 PC의
  // 팀 현황/팀 진행 현황에 영원히 나타나지 않는다(로스터는 클라우드에만 모이므로).
  ipcMain.handle('create-user', (_, name, pin) => {
    const result = db.users.create(name, pin);
    fireSync(() => cloud.sync.teamMember(result));
    return result;
  });
  ipcMain.handle('verify-user', (_, name, pin) => {
    const ok = db.users.verify(name, pin);
    if (ok) currentUsername = name;
    return ok;
  });

  // 팀원 계정 생성 (역할 포함) + Supabase 동기화
  ipcMain.handle('create-team-member', (_, name, pin, role) => {
    const result = db.users.create(name, pin, role);
    fireSync(() => cloud.sync.teamMember(result));
    return result;
  });

  // 팀원 전체 목록 (역할 + 프로젝트 현황 통계 포함)
  //
  // 로스터와 건수 모두 클라우드가 원본이다. 로컬만 보면 두 가지가 동시에 틀린다:
  //  - 로스터: 이 PC에서 만들어진 계정만 보인다 (다른 PC에서 가입한 팀원이 빠짐)
  //  - 건수:   이 PC의 로컬 store에는 본인 프로젝트만 있다 → 남들은 전부 0건으로 표시됨
  // 클라우드가 준비되지 않았으면(오프라인) 로컬만으로 기존처럼 동작한다.
  ipcMain.handle('get-team-members', async () => {
    const local = db.users.getAll();
    let roster  = local;
    let byUser  = null;   // username → projects (클라우드 기준)

    if (cloud.isReady()) {
      try {
        const [remoteMembers, team] = await Promise.all([
          cloud.pull.teamMembers(),
          cloud.pull.teamProjects(),
        ]);

        // 로컬에 같은 이름이 있으면 로컬 계정(id)을 그대로 쓰고, 없으면 조회 전용 항목으로 추가한다.
        // 여기서 로컬 계정을 만들지는 않는다 — 화면에 보여주기 위해 로그인 가능한 계정을
        // 늘릴 이유가 없다(계정 생성은 로그인 화면의 로스터 pull이 담당).
        const seen = new Map(local.map(u => [u.name, u]));
        const add = (name, role) => {
          if (name && !seen.has(name)) seen.set(name, { id: null, name, role: role || 'member' });
        };
        for (const row of remoteMembers) add(row.username, row.role);

        byUser = {};
        for (const p of team.projects) (byUser[p.username] ||= []).push(p);

        // 클라우드에 프로젝트가 있는데 로스터에는 없는 사람도 팀원으로 본다.
        // 로스터 동기화가 없던 구버전으로 가입한 팀원은 team_members 행이 없지만
        // 프로젝트는 이미 올라와 있다 — 이들이 목록에서 빠지면 그 프로젝트가 통째로 안 보인다.
        // (본인 PC가 새 버전으로 올라오면 로그인 시 로스터 행도 채워진다.)
        Object.keys(byUser).forEach(name => add(name, 'member'));

        roster = [...seen.values()];
      } catch (e) {
        console.error('[get-team-members] 클라우드 조회 실패, 로컬로 대체:', e.message);
      }
    }

    return roster.map(u => {
      const projs = byUser ? (byUser[u.name] || []) : db.projects.getAll(u.name);
      return {
        ...u,
        totalProjects: projs.length,
        waiting:   projs.filter(p => p.status === '대기').length,
        active:    projs.filter(p => p.status === '진행중').length,
        completed: projs.filter(p => p.status === '완료' || p.status === '청구완료').length,
      };
    });
  });

  // 팀 진행 현황 대시보드 — Supabase에서 팀 전체 프로젝트+공정을 실시간 조회 (로컬 저장 안 함)
  ipcMain.handle('get-team-progress', async () => {
    if (!cloud.isReady()) throw new Error('Supabase에 먼저 연결해주세요.');
    return await cloud.pull.teamProjects();
  });

  // 팀원 프로젝트의 클라우드 메모 조회 (로컬에 없는 프로젝트일 수 있어 클라우드에서 직접 조회)
  ipcMain.handle('get-team-project-memos', async (_, projectId) => {
    if (!cloud.isReady()) throw new Error('Supabase에 먼저 연결해주세요.');
    return await cloud.pull.projectMemos(projectId);
  });

  // Supabase에서 팀원 목록 pull → 로컬에 없는 사용자만 생성
  ipcMain.handle('cloud-pull-team-members', async () => {
    if (!cloud.isReady()) throw new Error('Supabase에 먼저 로그인해주세요.');
    const remote = await cloud.pull.teamMembers();
    const knownNames = new Set(db.users.getAll().map(u => u.name));
    const created = [];
    const failed  = [];
    for (const row of remote) {
      if (knownNames.has(row.username)) continue;
      // 관리자 계정은 절대 자동 생성하지 않는다. 여기서 만드는 계정의 PIN은 임시값('0000')이라,
      // admin 행을 만들면 팀원 PC에서 아무나 관리자로 로그인할 수 있게 된다.
      // 관리자 PC는 자기 계정을 직접 만들어 쓰므로 내려받을 필요도 없다.
      if (row.role === 'admin') continue;
      try {
        const nu = db.users.create(row.username, '0000', row.role || 'member');
        knownNames.add(nu.name);
        created.push(nu);
      } catch (e) {
        // 이름 충돌 등 개별 실패는 건너뛰고 나머지 팀원 생성을 계속 진행한다
        console.error('[cloud-pull-team-members]', row.username, e.message);
        failed.push({ username: row.username, error: e.message });
      }
    }
    return { pulled: remote.length, created: created.length, createdUsers: created, failed };
  });

  // ─── 카테고리 ─────────────────────────────────────────────
  ipcMain.handle('get-categories', () => db.categories.getAll());
  ipcMain.handle('create-category', (_, data) => {
    assertCategoryAdmin();
    const result = db.categories.create(data);
    fireSync(() => cloud.sync.category(result));
    return result;
  });
  ipcMain.handle('update-category', (_, id, data) => {
    assertCategoryAdmin();
    db.categories.update(id, data);
    const updated = db.categories.getAll().find(c => c.id === id);
    if (updated) fireSync(() => cloud.sync.category(updated));
    return true;
  });
  ipcMain.handle('delete-category', (_, id) => {
    assertCategoryAdmin();
    db.categories.delete(id);
    fireSync(() => cloud.sync.deleteCategory(id));
    return true;
  });
  ipcMain.handle('get-breadcrumb', (_, categoryId) => db.categories.getBreadcrumb(categoryId));

  // ─── 프로젝트 ─────────────────────────────────────────────
  ipcMain.handle('get-projects', () => {
    if (!currentUsername) return [];
    return db.projects.getAll(currentUsername);
  });
  ipcMain.handle('get-deleted-projects', () => {
    if (!currentUsername) return [];
    return db.projects.getDeleted(currentUsername);
  });
  ipcMain.handle('create-project', (_, data) => {
    if (!currentUsername) throw new Error('로그인 필요');
    const result = db.projects.create(currentUsername, data);
    fireSync(() => cloud.sync.project(result));
    db.changeLogs.add({ username: currentUsername, target_type: 'project', target_id: result.id,
      project_id: result.id, project_name: result.name, target_name: result.name, action: 'create' });
    return result;
  });
  ipcMain.handle('update-project', (_, id, data) => {
    const before = db.projects.getById(id);
    const result = db.projects.update(id, data);
    if (result) {
      fireSync(() => cloud.sync.project(result));
      if (data.status && before && data.status !== before.status) {
        db.changeLogs.add({ username: currentUsername, target_type: 'project', target_id: id,
          project_id: id, target_name: result.name, action: 'status_change',
          field_changed: 'status', old_value: before.status, new_value: data.status });
      } else if (data.name || data.description !== undefined || data.category_id !== undefined) {
        db.changeLogs.add({ username: currentUsername, target_type: 'project', target_id: id,
          project_id: id, target_name: result.name, action: 'update' });
      }
    }
    return result;
  });
  ipcMain.handle('delete-project', (_, id) => {
    const proj = db.projects.getById(id);
    db.projects.softDelete(id);
    const updated = db.projects.getDeleted(currentUsername).find(p => p.id === id);
    if (updated) fireSync(() => cloud.sync.project(updated));
    if (proj) db.changeLogs.add({ username: currentUsername, target_type: 'project', target_id: id,
      project_id: id, target_name: proj.name, action: 'delete' });
    return true;
  });
  ipcMain.handle('restore-project', (_, id) => {
    db.projects.restore(id);
    const proj = db.projects.getAll(currentUsername).find(p => p.id === id);
    if (proj) {
      fireSync(() => cloud.sync.project(proj));
      db.changeLogs.add({ username: currentUsername, target_type: 'project', target_id: id,
        project_id: id, target_name: proj.name, action: 'restore' });
    }
    return true;
  });
  ipcMain.handle('hard-delete-project', (_, id) => {
    db.projects.hardDelete(id);
    fireSync(() => cloud.sync.hardDeleteProject(id));
    return true;
  });
  ipcMain.handle('complete-project', (_, id) => {
    const before = db.projects.getById(id);
    const result = db.projects.completeProject(id);
    if (result) {
      fireSync(() => cloud.sync.project(result));
      db.changeLogs.add({ username: currentUsername, target_type: 'project', target_id: id,
        project_id: id, target_name: result.name, action: 'status_change',
        field_changed: 'status', old_value: before?.status || '', new_value: '완료' });
    }
    return result;
  });
  ipcMain.handle('revert-project', (_, id) => {
    const result = db.projects.revertProject(id);
    if (result) {
      fireSync(() => cloud.sync.project(result));
      db.changeLogs.add({ username: currentUsername, target_type: 'project', target_id: id,
        project_id: id, target_name: result.name, action: 'status_change',
        field_changed: 'status', old_value: '완료', new_value: result.status });
    }
    return result;
  });

  // ─── 공정 ─────────────────────────────────────────────────
  // 공정을 추가·수정·삭제하면 db가 프로젝트 상태를 다시 계산한다(projects.refreshStatus).
  // 그 결과는 로컬에만 반영되므로, 바뀐 경우 프로젝트 행도 클라우드에 올려야
  // 관리자의 "팀 진행 현황"이 옛 상태 배지를 보여주지 않는다.
  function syncProjectIfStatusChanged(projectId, statusBefore) {
    const proj = db.projects.getById(projectId);
    if (proj && proj.status !== statusBefore) fireSync(() => cloud.sync.project(proj));
  }

  ipcMain.handle('get-processes', (_, projectId) => db.processes.getByProject(projectId));
  ipcMain.handle('create-process', (_, data) => {
    const statusBefore = db.projects.getById(data.project_id)?.status;
    const result = db.processes.create(data);
    fireSync(() => cloud.sync.process(result));
    syncProjectIfStatusChanged(result.project_id, statusBefore);
    const proj = db.projects.getById(result.project_id);
    db.changeLogs.add({ username: currentUsername, target_type: 'process', target_id: result.id,
      project_id: result.project_id, project_name: proj?.name || '',
      target_name: result.name, action: 'create' });
    return result;
  });
  ipcMain.handle('update-process', (_, id, data) => {
    const before = db.processes.getById(id);
    const statusBefore = before ? db.projects.getById(before.project_id)?.status : undefined;
    const result = db.processes.update(id, data);
    if (result) {
      fireSync(() => cloud.sync.process(result));
      syncProjectIfStatusChanged(result.project_id, statusBefore);
      const proj = db.projects.getById(result.project_id);
      // 상태 변경 이력
      if (data.status && before && data.status !== before.status) {
        db.changeLogs.add({ username: currentUsername, target_type: 'process', target_id: id,
          project_id: result.project_id, project_name: proj?.name || '',
          target_name: result.name, action: 'status_change',
          field_changed: 'status', old_value: before.status, new_value: data.status });
      }
      // 날짜 변경 이력
      const dateFields = ['plan_start','plan_end','actual_start','actual_end'];
      dateFields.forEach(f => {
        if (data[f] !== undefined && before && data[f] !== before[f]) {
          db.changeLogs.add({ username: currentUsername, target_type: 'process', target_id: id,
            project_id: result.project_id, project_name: proj?.name || '',
            target_name: result.name, action: 'date_change',
            field_changed: f, old_value: before[f] || '미정', new_value: data[f] || '미정' });
        }
      });
    }
    return result;
  });
  ipcMain.handle('delete-process', (_, id) => {
    const before = db.processes.getById(id);
    const statusBefore = before ? db.projects.getById(before.project_id)?.status : undefined;
    db.processes.softDelete(id);
    if (before) {
      fireSync(() => cloud.sync.process({ ...before, is_deleted: true }));
      syncProjectIfStatusChanged(before.project_id, statusBefore);
      const proj = db.projects.getById(before.project_id);
      db.changeLogs.add({ username: currentUsername, target_type: 'process', target_id: id,
        project_id: before.project_id, project_name: proj?.name || '',
        target_name: before.name, action: 'delete' });
    }
    return true;
  });
  ipcMain.handle('reorder-processes', (_, projectId, orderedIds) => {
    db.processes.reorder(projectId, orderedIds);
    // 순서 변경된 공정들 일괄 sync
    const procs = db.processes.getByProject(projectId);
    fireSync(async () => {
      for (const p of procs) await cloud.sync.process(p);
    });
    return true;
  });

  // ─── 메모 ─────────────────────────────────────────────────
  ipcMain.handle('get-memos-project', (_, projectId) => db.memos.getByProject(projectId));
  ipcMain.handle('get-memos-process', (_, processId) => db.memos.getByProcess(processId));
  ipcMain.handle('create-memo', (_, data) => {
    if (!currentUsername) throw new Error('로그인 필요');
    const result = db.memos.create({ ...data, author: currentUsername });
    fireSync(() => cloud.sync.memo(result));
    return result;
  });
  ipcMain.handle('update-memo', (_, id, data) => {
    db.memos.update(id, data);
    const updated = db.memos.getByProject(data.project_id || '').find(m => m.id === id);
    if (updated) fireSync(() => cloud.sync.memo(updated));
    return true;
  });
  ipcMain.handle('delete-memo', (_, id) => {
    db.memos.delete(id);
    fireSync(() => cloud.sync.deleteMemo(id));
    return true;
  });

  // ─── 빠른 메모 / 단기 작업 ───────────────────────────────
  ipcMain.handle('get-quick-memos-active', () => {
    if (!currentUsername) return [];
    return db.quickMemos.getActive(currentUsername);
  });
  ipcMain.handle('get-quick-memos-done', () => {
    if (!currentUsername) return [];
    return db.quickMemos.getDone(currentUsername);
  });
  ipcMain.handle('get-quick-memos-done-period', (_, period) => {
    if (!currentUsername) return [];
    return db.quickMemos.getDonePeriod(currentUsername, period);
  });
  ipcMain.handle('create-quick-memo', (_, data) => {
    if (!currentUsername) throw new Error('로그인 필요');
    const result = db.quickMemos.create(currentUsername, data);
    fireSync(() => cloud.sync.quickMemo(result));
    return result;
  });
  ipcMain.handle('complete-quick-memo', (_, id) => {
    db.quickMemos.complete(id);
    const qm = db.quickMemos.getDone(currentUsername).find(m => m.id === id);
    if (qm) fireSync(() => cloud.sync.quickMemo(qm));
    return true;
  });
  ipcMain.handle('delete-quick-memo', (_, id) => {
    db.quickMemos.delete(id);
    fireSync(() => cloud.sync.deleteQuickMemo(id));
    return true;
  });
  ipcMain.handle('update-quick-memo', (_, id, data) => {
    db.quickMemos.update(id, data);
    const qm = db.quickMemos.getActive(currentUsername).find(m => m.id === id);
    if (qm) fireSync(() => cloud.sync.quickMemo(qm));
    return true;
  });

  // ─── 설정 ─────────────────────────────────────────────────
  ipcMain.handle('get-settings', () => db.settings.get());
  ipcMain.handle('update-settings', (_, data) => {
    const result = db.settings.update(data);
    if (typeof data.autoStart === 'boolean') {
      app.setLoginItemSettings(getLoginItemSettings(data.autoStart));
    }
    fireSync(() => cloud.sync.settings(result));
    return result;
  });

  // ─── 자동로그인 ───────────────────────────────────────────
  ipcMain.handle('set-auto-login',   (_, username) => { db.settings.setAutoLogin(username); return true; });
  ipcMain.handle('clear-auto-login', () => { db.settings.clearAutoLogin(); return true; });
  ipcMain.handle('get-auto-login',   () => db.settings.getAutoLoginUser());

  // ─── AI 설정 ──────────────────────────────────────────────
  ipcMain.handle('get-ai-settings', () => db.settings.getAiSettings());
  ipcMain.handle('save-ai-settings', (_, data) => {
    db.settings.saveAiSettings(data);
    fireSync(() => cloud.sync.settings(db.settings.get()));
    return true;
  });

  // ─── Supabase 클라우드 연동 ───────────────────────────────
  // 연결 상태 조회
  ipcMain.handle('cloud-get-status', () => cloud.getSyncStatus());

  // Supabase 설정 저장 + 연결 시도
  ipcMain.handle('cloud-connect', async (_, { url, anonKey, email, password }) => {
    // 설정 저장
    db.settings.update({ supabaseUrl: url, supabaseAnonKey: anonKey, supabaseEmail: email });
    // 클라이언트 초기화
    const ok = cloud.init(url, anonKey);
    if (!ok) throw new Error('Supabase 초기화 실패. URL/Key를 확인하세요.');
    // 로그인
    const result = await cloud.auth.signIn(email, password);
    return result;
  });

  // 신규 Supabase 계정 생성
  ipcMain.handle('cloud-sign-up', async (_, { url, anonKey, email, password }) => {
    db.settings.update({ supabaseUrl: url, supabaseAnonKey: anonKey, supabaseEmail: email });
    const ok = cloud.init(url, anonKey);
    if (!ok) throw new Error('Supabase 초기화 실패.');
    const result = await cloud.auth.signUp(email, password, currentUsername || 'user');
    return result;
  });

  // Supabase 로그아웃
  ipcMain.handle('cloud-sign-out', async () => {
    await cloud.auth.signOut();
    return true;
  });

  // 로컬 데이터 전체 → Supabase 업로드 (최초 마이그레이션 / 수동 캐치업)
  ipcMain.handle('cloud-migrate', async () => {
    if (!cloud.isReady()) throw new Error('Supabase에 먼저 로그인해주세요.');
    return await syncLocalDataToCloud(currentUsername);
  });

  // Supabase → 로컬 전체 다운로드 (다른 PC 데이터 가져오기)
  ipcMain.handle('cloud-pull', async () => {
    if (!cloud.isReady()) throw new Error('Supabase에 먼저 로그인해주세요.');

    const remote = await cloud.pull.all(currentUsername);
    const Store  = require('electron-store');
    const s      = new Store({ name: 'jae-vis-v2-data' });

    // ── 카테고리: id 기준 upsert (배열 전체 교체) ──
    const catMap = new Map(s.get('categories', []).map(c => [c.id, c]));
    remote.categories.forEach(c => catMap.set(c.id, c));
    s.set('categories', [...catMap.values()]);

    // ── 프로젝트: id 기준 upsert ──
    // 소유자(username)는 클라우드 값을 그대로 따른다. 예전엔 현재 로그인 사용자로 도장을
    // 찍어서, 남의 프로젝트가 내려오면 내 것이 되고 다음 업로드 때 클라우드 소유자까지
    // 바뀌었다. pull.all이 이미 본인 것만 주지만, 소유자를 바꾸는 일은 여기서도 하지 않는다.
    const projMap = new Map(s.get('projects', []).map(p => [p.id, p]));
    remote.projects.forEach(p => {
      const existing = projMap.get(p.id);
      // manually_completed는 클라우드에 저장되지 않는 로컬 전용 플래그다.
      // 원격 객체에는 이 필드가 없으므로 그대로 덮어쓰면 pull 한 번에 완료처리가 전부 풀린다.
      projMap.set(p.id, {
        ...p,
        username: p.username || existing?.username || currentUsername,
        manually_completed: existing?.manually_completed ?? p.manually_completed ?? false,
      });
    });
    s.set('projects', [...projMap.values()]);

    // ── 공정: id 기준 upsert ──
    const procMap = new Map(s.get('processes', []).map(p => [p.id, p]));
    remote.processes.forEach(p => procMap.set(p.id, p));
    s.set('processes', [...procMap.values()]);

    // ── 메모: id 기준 upsert ──
    const memoMap = new Map(s.get('memos', []).map(m => [m.id, m]));
    remote.memos.forEach(m => memoMap.set(m.id, m));
    s.set('memos', [...memoMap.values()]);

    // ── 빠른메모: id 기준 upsert. 소유자는 프로젝트와 같은 이유로 클라우드 값을 따른다 ──
    const qmMap = new Map(s.get('quickMemos', []).map(q => [q.id, q]));
    remote.quickMemos.forEach(q => {
      const existing = qmMap.get(q.id);
      qmMap.set(q.id, { ...q, username: q.username || existing?.username || currentUsername });
    });
    s.set('quickMemos', [...qmMap.values()]);

    return {
      categories: remote.categories.length,
      projects:   remote.projects.length,
      processes:  remote.processes.length,
      memos:      remote.memos.length,
      quickMemos: remote.quickMemos.length,
    };
  });

  // ─── AI 컨텍스트 조회 ─────────────────────────────────────
  ipcMain.handle('ai-get-context', () => {
    if (!currentUsername) return { projects: [], tasks: [], today: '' };
    const ctx = buildAiContext(currentUsername);
    return ctx;
  });

  // ─── AI 채팅 (Phase B — Function Calling + 대화 히스토리) ──
  ipcMain.handle('ai-chat', async (_, userMessage) => {
    if (!currentUsername) return { action: 'none', message: '로그인이 필요합니다.' };
    const aiCfg  = db.settings.getAiSettings();
    const apiKey = aiCfg.aiApiKey || '';
    if (!apiKey) return { action: 'none', message: '⚙️ 설정에서 API 키를 먼저 입력해 주세요.' };

    const ctx          = buildAiContext(currentUsername);
    const style        = db.settings.get().chatStyle || 'concise';
    const systemPrompt = buildSystemPrompt(ctx, style);

    // 대화 히스토리 관리 (세션 내 문맥 유지)
    if (!chatHistory[currentUsername]) chatHistory[currentUsername] = [];
    const history = chatHistory[currentUsername];
    history.push({ role: 'user', content: userMessage });
    if (history.length > MAX_CHAT_HISTORY * 2) history.splice(0, 2); // 오래된 턴 제거

    try {
      let aiResponse;
      if (aiCfg.aiProvider === 'gemini') {
        aiResponse = await callGeminiApi(apiKey, systemPrompt, history);
      } else {
        aiResponse = await callClaudeApi(apiKey, systemPrompt, history);
      }

      // AI 응답을 히스토리에 추가
      history.push({ role: 'assistant', content: aiResponse });

      // JSON 파싱 (코드블록 포함 처리)
      let parsed;
      try {
        const jsonMatch = aiResponse.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/) ||
                          aiResponse.match(/(\{[\s\S]*\})/);
        parsed = JSON.parse(jsonMatch ? jsonMatch[1] || jsonMatch[0] : aiResponse);
      } catch (e) {
        return { action: 'none', message: aiResponse };
      }

      // ── Action 실행 ─────────────────────────────────────
      const d = parsed.data || {};

      if (parsed.action === 'update_process' && d.process_id) {
        const upd = {};
        if (d.status)       upd.status       = d.status;
        if (d.plan_start)   upd.plan_start   = d.plan_start;
        if (d.plan_end)     upd.plan_end     = d.plan_end;
        if (d.actual_start) upd.actual_start = d.actual_start;
        if (d.actual_end)   upd.actual_end   = d.actual_end;
        if (Object.keys(upd).length > 0) {
          const result = db.processes.update(d.process_id, upd);
          if (result) fireSync(() => cloud.sync.process(result));
          notifyDashboard('overview');
        }

      } else if (parsed.action === 'create_process' && d.project_id && d.name) {
        const newProc = db.processes.create({
          project_id:  d.project_id,
          name:        d.name,
          plan_start:  d.plan_start  || null,
          plan_end:    d.plan_end    || null,
          actual_start:d.actual_start|| null,
          actual_end:  d.actual_end  || null,
        });
        fireSync(() => cloud.sync.process(newProc));
        notifyDashboard('overview');

      } else if (parsed.action === 'update_project' && d.project_id && d.status) {
        const upd = db.projects.update(d.project_id, { status: d.status });
        if (upd) fireSync(() => cloud.sync.project(upd));
        notifyDashboard('overview');

      } else if (parsed.action === 'add_memo' && d.project_id && d.content) {
        const newMemo = db.memos.create({
          project_id: d.project_id,
          process_id: d.process_id || null,
          content:    d.content,
          tag:        d.tag || null,
          author:     currentUsername,
        });
        fireSync(() => cloud.sync.memo(newMemo));
        notifyDashboard('overview');

      } else if (parsed.action === 'create_task' && d.content) {
        const newQm = db.quickMemos.create(currentUsername, {
          content:  d.content,
          type:     d.type     || '기타',
          priority: d.priority || '보통',
          due_date: d.due_date || null,
        });
        fireSync(() => cloud.sync.quickMemo(newQm));
        notifyDashboard('memo');

      } else if (parsed.action === 'complete_task' && d.task_id) {
        db.quickMemos.complete(d.task_id);
        const done = db.quickMemos.getDone(currentUsername).find(m => m.id === d.task_id);
        if (done) fireSync(() => cloud.sync.quickMemo(done));
        notifyDashboard('memo');

      } else if (parsed.action === 'delete_task' && d.task_id) {
        db.quickMemos.delete(d.task_id);
        fireSync(() => cloud.sync.deleteQuickMemo(d.task_id));
        notifyDashboard('memo');
      }

      return parsed;
    } catch (err) {
      console.error('[AI Chat Error]', err.message);
      return { action: 'none', message: '❌ AI 오류: ' + err.message };
    }
  });

  // ─── Phase C: 알림 ──────────────────────────────────────────
  ipcMain.handle('get-notifications',   () => db.notifications.getAll());
  ipcMain.handle('get-notif-unread',    () => db.notifications.getUnread().length);
  ipcMain.handle('mark-notifs-read',    () => { db.notifications.markAllRead(); return true; });
  ipcMain.handle('clear-notifications', () => { db.notifications.clear(); return true; });
  ipcMain.handle('check-notifications', () => {
    const notifier = require('./notifier');
    notifier.checkAll(currentUsername);
    return db.notifications.getUnread().length;
  });

  // 알림 설정 업데이트 (settings 핸들러가 이미 처리, 여기선 설정 조회만)
  ipcMain.handle('get-notif-settings', () => {
    const s = db.settings.get();
    return {
      notifEnabled:        s.notifEnabled        ?? true,
      notifRemindDays:     s.notifRemindDays     ?? [3, 1],
      notifExcludeWeekend: s.notifExcludeWeekend ?? false,
      notifExcludeStart:   s.notifExcludeStart   ?? 22,
      notifExcludeEnd:     s.notifExcludeEnd     ?? 8,
    };
  });

  // ─── Phase D: 변경 이력 ─────────────────────────────────────
  ipcMain.handle('get-change-logs',         () => {
    if (!currentUsername) return [];
    return db.changeLogs.getByUser(currentUsername);
  });
  ipcMain.handle('get-change-logs-project', (_, projectId) =>
    db.changeLogs.getByProject(projectId)
  );
  ipcMain.handle('clear-change-logs', () => { db.changeLogs.clear(); return true; });

  // 대화 히스토리 초기화 (새 대화 시작)
  ipcMain.handle('ai-chat-reset', () => {
    if (currentUsername) chatHistory[currentUsername] = [];
    return true;
  });

  // 챗봇 답변 스타일 조회/변경
  ipcMain.handle('ai-get-style', () => db.settings.get().chatStyle || 'concise');
  ipcMain.handle('ai-set-style', (_, style) => {
    db.settings.update({ chatStyle: style });
    return true;
  });
}

// ─── 대화 히스토리 ────────────────────────────────────────────
const chatHistory    = {};   // { username: [{role, content}, ...] }
const MAX_CHAT_HISTORY = 10; // 유지할 최대 턴 수

// ─── AI 컨텍스트 빌더 ─────────────────────────────────────────
function buildAiContext(username) {
  const today    = new Date();
  const todayStr = today.toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' });
  const projects = db.projects.getAll(username).filter(p => !p.is_deleted);
  const tasks    = db.quickMemos.getActive(username);

  // 이번주 범위 계산 (월~일)
  const dow = today.getDay();
  const weekStart = new Date(today); weekStart.setDate(today.getDate() - ((dow+6)%7)); weekStart.setHours(0,0,0,0);
  const weekEnd   = new Date(weekStart); weekEnd.setDate(weekStart.getDate() + 6); weekEnd.setHours(23,59,59,999);
  const fmtISO    = d => d.toISOString().slice(0,10);

  const projectsWithProcesses = projects.map(p => {
    const procs = db.processes.getByProject(p.id).filter(pr => !pr.is_deleted);
    return { ...p, processes: procs };
  });

  // 이번주 공정 (계획 또는 실시 기간이 이번주와 겹치는 것)
  const thisWeekProcs = [];
  projectsWithProcesses.forEach(p => {
    p.processes.filter(pr => !pr.is_group).forEach(pr => {
      const ps = pr.plan_start || pr.actual_start;
      const pe = pr.plan_end   || pr.actual_end || ps;
      if (!ps) return;
      const startD = new Date(ps); const endD = new Date(pe);
      if (startD <= weekEnd && endD >= weekStart) {
        thisWeekProcs.push({ projName: p.name, projId: p.id, ...pr });
      }
    });
  });

  // 지연 공정 (plan_end < 오늘 && 미완료)
  const overdueProcs = [];
  projectsWithProcesses.forEach(p => {
    p.processes.filter(pr => !pr.is_group && pr.plan_end && pr.status !== '완료').forEach(pr => {
      if (new Date(pr.plan_end) < today) {
        overdueProcs.push({ projName: p.name, projId: p.id, ...pr });
      }
    });
  });

  return {
    today: todayStr, username, weekStartISO: fmtISO(weekStart), weekEndISO: fmtISO(weekEnd),
    projects: projectsWithProcesses, tasks, thisWeekProcs, overdueProcs,
  };
}

// ─── 시스템 프롬프트 빌더 ─────────────────────────────────────
function buildSystemPrompt(ctx, style) {
  const styleGuide = {
    concise:  '3줄 이내로 핵심만 답변. 불필요한 설명 생략.',
    detailed: '상세하게 설명. 필요 시 목록이나 표 형태로 정리.',
    report:   '번호 매기기, 항목별 정리. 보고서 형식으로 작성.',
  }[style] || '3줄 이내로 핵심만 답변.';

  // 전체 프로젝트·공정 목록 (AI가 ID 기반으로 작업 수행)
  const projectsText = ctx.projects.map(p => {
    const procLines = p.processes.map(pr =>
      `  - [공정ID:${pr.id}] [${pr.name}] 상태:${pr.status}` +
      ` 계획:${pr.plan_start||'미정'}~${pr.plan_end||'미정'}` +
      ` 실시:${pr.actual_start||'미정'}~${pr.actual_end||'미정'}` +
      (pr.is_group ? ' [그룹]' : '') +
      (pr.parent_id ? ` [상위:${pr.parent_id}]` : '')
    ).join('\n');
    return `▶ [프로젝트ID:${p.id}] ${p.name} (${p.status}) [분류ID:${p.category_id||'없음'}]\n${procLines||'  (공정 없음)'}`;
  }).join('\n\n') || '(프로젝트 없음)';

  // 이번주 공정 요약
  const weekText = ctx.thisWeekProcs.length
    ? ctx.thisWeekProcs.map(pr =>
        `  - ${pr.projName} / ${pr.name} (${pr.status}) 계획:${pr.plan_start||''}~${pr.plan_end||''}`
      ).join('\n')
    : '  (이번주 일정 없음)';

  // 지연 공정
  const overdueText = ctx.overdueProcs.length
    ? ctx.overdueProcs.map(pr => {
        const daysLate = Math.floor((new Date() - new Date(pr.plan_end)) / 86400000);
        return `  - [공정ID:${pr.id}] ${pr.projName} / ${pr.name} — 계획종료 ${pr.plan_end} (${daysLate}일 경과)`;
      }).join('\n')
    : '  (없음)';

  // 단기 작업
  const tasksText = ctx.tasks.length
    ? ctx.tasks.map(t =>
        `  - [작업ID:${t.id}] [${t.type}] ${t.content} (우선순위:${t.priority}${t.due_date?' 마감:'+t.due_date:''})`
      ).join('\n')
    : '  (없음)';

  return `당신은 JAE-VIS, 건설 안전 업무 전담 AI 비서입니다.

[역할]
건설 안전 점검·계획·검토 업무의 프로젝트 공정 일정을 관리합니다.
공정 상태 변경, 일정 등록, 메모 추가, 단기작업 관리 등 실무 작업을 직접 수행합니다.

[오늘] ${ctx.today}
[이번주] ${ctx.weekStartISO} ~ ${ctx.weekEndISO}
[사용자] ${ctx.username}

[전체 프로젝트·공정 현황]
${projectsText}

[이번주 공정]
${weekText}

[지연 공정]
${overdueText}

[미완료 단기 작업]
${tasksText}

[답변 스타일] ${styleGuide}
[날짜 형식] 항상 "5월 28일(수)" 형식 사용
[주의] 인사말 생략. 데이터 수정 시 반드시 해당 ID 사용.

반드시 아래 JSON 형식으로만 답변하세요 (코드블록·마크다운 없이 순수 JSON):
{"action":"...", "message":"한국어 답변", "data":{...}}

[action 목록 및 data 구조]
- "none"           : 조회·대화. data:{}
- "briefing"       : 이번주 일정 브리핑. data:{}
- "update_process" : 공정 상태/날짜 변경.
    data:{"process_id":"(필수)","status":"대기|진행|완료","plan_start":"YYYY-MM-DD","plan_end":"YYYY-MM-DD","actual_start":"YYYY-MM-DD","actual_end":"YYYY-MM-DD"}
    ※ 변경할 항목만 포함. process_id는 위 [공정ID:xxx] 값 그대로 사용.
- "create_process" : 새 공정 등록.
    data:{"project_id":"(필수)","name":"공정명(필수)","plan_start":"YYYY-MM-DD","plan_end":"YYYY-MM-DD"}
- "update_project" : 프로젝트 상태 변경.
    data:{"project_id":"(필수)","status":"대기|진행중|완료|청구완료"}
- "add_memo"       : 프로젝트/공정 메모 추가.
    data:{"project_id":"(필수)","process_id":"(선택)","content":"내용(필수)","tag":"중요|보완|확인필요"}
- "create_task"    : 단기 작업 등록.
    data:{"content":"내용(필수)","type":"메일송부|자료검토|자료요청|보고서작성|회의준비|전화/협의|서명/결재|기타","priority":"긴급|보통|낮음","due_date":"YYYY-MM-DD"}
- "complete_task"  : 단기 작업 완료.
    data:{"task_id":"(필수)"}
- "delete_task"    : 단기 작업 삭제.
    data:{"task_id":"(필수)"}`;
}

// ─── Claude API 호출 (대화 히스토리 지원) ─────────────────────
function callClaudeApi(apiKey, systemPrompt, history) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      model:      'claude-sonnet-4-6',
      max_tokens: 1500,
      system:     systemPrompt,
      messages:   history,
    });
    const req = https.request({
      hostname: 'api.anthropic.com',
      path:     '/v1/messages',
      method:   'POST',
      headers: {
        'x-api-key':         apiKey,
        'anthropic-version': '2023-06-01',
        'content-type':      'application/json',
        'content-length':    Buffer.byteLength(body),
      },
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          if (json.error) return reject(new Error(json.error.message || JSON.stringify(json.error)));
          resolve(json.content && json.content[0] ? json.content[0].text : '');
        } catch(e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// ─── Gemini API 호출 (대화 히스토리 지원) ─────────────────────
function callGeminiApi(apiKey, systemPrompt, history) {
  return new Promise((resolve, reject) => {
    // Gemini는 system prompt를 첫 번째 user turn으로 처리
    const contents = [
      { role: 'user',  parts: [{ text: systemPrompt }] },
      { role: 'model', parts: [{ text: '알겠습니다. JSON 형식으로만 답변하겠습니다.' }] },
      ...history.map(m => ({
        role:  m.role === 'user' ? 'user' : 'model',
        parts: [{ text: m.content }],
      })),
    ];
    const body = JSON.stringify({ contents });
    const reqPath = '/v1beta/models/gemini-2.5-flash:generateContent?key=' + apiKey;
    const req = https.request({
      hostname: 'generativelanguage.googleapis.com',
      path:     reqPath,
      method:   'POST',
      headers: {
        'content-type':   'application/json',
        'content-length': Buffer.byteLength(body),
      },
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          if (json.error) return reject(new Error(json.error.message));
          const text = json.candidates && json.candidates[0] &&
            json.candidates[0].content && json.candidates[0].content.parts &&
            json.candidates[0].content.parts[0] ? json.candidates[0].content.parts[0].text : '';
          resolve(text);
        } catch(e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// ─── 대시보드 새로고침 알림 ───────────────────────────────────
function notifyDashboard(page) {
  BrowserWindow.getAllWindows().forEach(win => {
    try { win.webContents.send('notify-dashboard', page); } catch(e) {}
  });
}

module.exports = { setupIpcHandlers, setCurrentUser, getCurrentUser, getLoginItemSettings };
