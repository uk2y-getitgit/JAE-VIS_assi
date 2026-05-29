/**
 * dashboard.js — JAE-VIS v2 프로토타입 메인 렌더러
 *
 * 담당 뷰:
 *  1. 전체 현황 대시보드 (카드/리스트, 필터, 검색)
 *  2. 3주 스케줄 뷰 (LAST / THIS / NEXT)
 *  3. 프로젝트 상세 슬라이드 패널 (공정 관리 + 메모)
 *  4. 설정 (분류 관리, 앱 설정)
 *  5. 보관함 (삭제 프로젝트 복구)
 */

// ═══════════════════════════════════════════════════════════
// 상태
// ═══════════════════════════════════════════════════════════
let currentUser    = null;
let allProjects    = [];
let allCategories  = [];
let currentView    = 'card';
let currentPage    = 'dashboard';
let currentProjId  = null;   // 상세 패널 열린 프로젝트 ID
let scheduleOffset = 0;      // 3주 스케줄 주차 오프셋 (0 = 오늘 기준)
let scheduleSearch = '';     // 3주 스케줄 프로젝트 검색어
const procModes    = {};     // 공정별 단기/장기 모드 { procId: 'short'|'long' }
let currentGroupId = null;   // 건진법 드릴인 상태 (null=최상위, 그룹ID=세부보기)

const GUNJIN_SUB_ITEMS = ['현장점검', '보고서작성', '제출', '제본', '청구'];

function isGunjinProject(projectId) {
  const proj = allProjects.find(p => p.id === projectId);
  if (!proj?.category_id) return false;
  const cat = allCategories.find(c => c.id === proj.category_id);
  return cat?.name === '건진법';
}

// 공정 날짜 기본 모드 추론 (기존 데이터 기반)
function getDefaultProcMode(proc) {
  if ((proc.plan_start && proc.plan_end && proc.plan_start !== proc.plan_end) ||
      (proc.actual_start && proc.actual_end && proc.actual_start !== proc.actual_end)) {
    return 'long';
  }
  return 'short';
}

// ═══════════════════════════════════════════════════════════
// 초기화
// ═══════════════════════════════════════════════════════════
window.api.onSetUser(async (username) => {
  currentUser = username;
  document.getElementById('tbUser').textContent    = username;
  document.getElementById('sidebarUser').textContent = username;
  await loadAll();
});

window.api.onNavigate((page) => navigateTo(page));

// AI 위젯 액션 후 대시보드 자동 갱신
if (window.api.onDashboardRefresh) {
  window.api.onDashboardRefresh(async (page) => {
    // 데이터 새로고침
    allProjects = await window.api.getProjects();
    await preloadProcesses();
    // 현재 보이는 페이지에 따라 렌더링
    const cur = document.querySelector('.nav-item.active')?.dataset?.page || 'overview';
    if (cur === 'overview' || cur === 'schedule' || cur === 'briefing') {
      renderDashboard();
    } else if (cur === 'memo') {
      renderMemoPage();
    }
  });
}

async function loadAll() {
  allCategories = await window.api.getCategories();
  allProjects   = await window.api.getProjects();
  const s = await window.api.getSettings();
  applyTheme(s.theme || 'dark');
  await preloadProcesses(); // processCache 채운 후 렌더링
  renderDashboard();
  populateCategoryFilters();
}

// ── 테마 ──────────────────────────────────────────────────────
function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  document.body.removeAttribute('class'); // 이전 class 방식 초기화
  const tb = document.getElementById('btnThemeToggle');
  if (tb) tb.textContent = theme === 'light' ? '🌙' : '☀️';
  document.querySelectorAll('.theme-btn').forEach(b =>
    b.classList.toggle('active', b.dataset.theme === theme)
  );
}

document.getElementById('btnThemeToggle').addEventListener('click', async () => {
  const current = document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark';
  const next    = current === 'light' ? 'dark' : 'light';
  await window.api.updateSettings({ theme: next });
  applyTheme(next);
});

['btnThemeDark', 'btnThemeLight'].forEach(id => {
  document.getElementById(id)?.addEventListener('click', async (e) => {
    const theme = e.currentTarget.dataset.theme;
    await window.api.updateSettings({ theme });
    applyTheme(theme);
  });
});

// ═══════════════════════════════════════════════════════════
// 네비게이션
// ═══════════════════════════════════════════════════════════
document.querySelectorAll('.nav-item').forEach(item => {
  item.addEventListener('click', () => navigateTo(item.dataset.page));
});

function navigateTo(page) {
  currentPage = page;
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));

  const pageEl = document.getElementById(`page-${page}`);
  if (pageEl) pageEl.classList.add('active');
  const navEl = document.querySelector(`.nav-item[data-page="${page}"]`);
  if (navEl) navEl.classList.add('active');

  if (page === 'schedule')  renderSchedule();
  if (page === 'briefing')  renderBriefing();
  if (page === 'history')   renderHistory();
  if (page === 'trash')     renderTrash();
  if (page === 'settings')  renderSettings();
  if (page === 'memo')      renderMemoPage();
  if (page === 'completed') {
    // 이번주를 기본 기간으로 설정
    const _today = new Date();
    const _mon   = getWeekMonday(_today, 0);
    const _sun   = addDays(_mon, 6);
    document.getElementById('completedDateFrom').value = fmtISO(_mon);
    document.getElementById('completedDateTo').value   = fmtISO(_sun);
    setQuickDateActive('week');
    renderCompletedWork();
  }
}

// ═══════════════════════════════════════════════════════════
// 창 제어
// ═══════════════════════════════════════════════════════════
document.getElementById('btnMinimize').addEventListener('click', () => window.api.minimize());
document.getElementById('btnMaximize').addEventListener('click', () => window.api.maximize());
document.getElementById('btnClose').addEventListener('click',    () => window.api.close());
document.getElementById('btnLogout').addEventListener('click',   () => window.api.logout());

// ═══════════════════════════════════════════════════════════
// 카테고리 유틸
// ═══════════════════════════════════════════════════════════
function getCategoryBreadcrumb(categoryId) {
  if (!categoryId) return '미분류';
  const result = [];
  let current  = allCategories.find(c => c.id === categoryId);
  while (current) {
    result.unshift(current.name);
    current = allCategories.find(c => c.id === current.parent_id);
  }
  return result.join(' › ');
}

function getCatLevel1(categoryId) {
  if (!categoryId) return null;
  let c = allCategories.find(x => x.id === categoryId);
  while (c && c.parent_id) c = allCategories.find(x => x.id === c.parent_id);
  return c || null;
}

function populateCategoryFilters() {
  const level1 = allCategories.filter(c => c.level === 1);
  // 필터 드롭다운
  const sel = document.getElementById('filterCategory');
  sel.innerHTML = '<option value="">전체 분류</option>' +
    level1.map(c => `<option value="${c.id}">${c.name}</option>`).join('');
  // 프로젝트 다이얼로그 대분류
  const dlg1 = document.getElementById('dlgCat1');
  dlg1.innerHTML = '<option value="">선택하세요</option>' +
    level1.map(c => `<option value="${c.id}">${c.name}</option>`).join('');
}

// 공정 자동생성 템플릿 (분류명 기준)
const AUTO_PROCESS_TEMPLATES = {
  '계획서': ['자료요청', '보고서작성', '제출', '제본', '청구'],
  '시특법': ['착수 및 계약', '현장점검', '보고서작성', '제출', '제본', '준공 및 청구'],
  '관리법': ['계약', '현장점검', '보고서작성', '제출', '제본', '청구'],
  // 건진법은 그룹 계층구조로 별도 처리
};

function getCatName(id) {
  const cat = allCategories.find(c => c.id === id);
  return cat ? cat.name : '';
}

// ── 건진법 다중 항목 입력 ──────────────────────────────────
function createProcItemRow(index) {
  const row = document.createElement('div');
  row.className = 'proc-item-row';

  const num = document.createElement('span');
  num.className = 'proc-item-num';
  num.textContent = index + 1;

  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'form-input proc-item-input';
  input.placeholder = `항목 ${index + 1} (예: 항타기${index + 1}차)`;
  input.setAttribute('style', '-webkit-user-select:text;-webkit-app-region:no-drag;pointer-events:auto');

  const removeBtn = document.createElement('button');
  removeBtn.type = 'button';
  removeBtn.className = 'btn-remove-item';
  removeBtn.title = '항목 삭제';
  removeBtn.textContent = '×';

  row.appendChild(num);
  row.appendChild(input);
  row.appendChild(removeBtn);

  const list = document.getElementById('dlgProcItemList');

  // Tab 키 → 현재 입력값이 있으면 새 항목 추가, 없으면 기본 동작
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Tab') {
      const allInputs = [...list.querySelectorAll('.proc-item-input')];
      const curIdx = allInputs.indexOf(input);
      const isLast = curIdx === allInputs.length - 1;

      if (input.value.trim() && isLast) {
        // 마지막 입력에 값이 있으면 새 항목 추가 후 포커스
        e.preventDefault();
        appendProcItemRow();
      }
      // 그 외(빈 입력 or 마지막 아님): 기본 Tab 동작 허용
    } else if (e.key === 'Backspace' && input.value === '') {
      // 빈 입력에서 Backspace → 해당 행 삭제 후 이전 항목 포커스
      const allInputs = [...list.querySelectorAll('.proc-item-input')];
      const curIdx = allInputs.indexOf(input);
      if (list.children.length > 1) {
        e.preventDefault();
        const target = allInputs[curIdx - 1] || allInputs[curIdx + 1];
        list.removeChild(row);
        updateProcItemNumbers();
        if (target) target.focus();
      }
    }
  });

  // × 버튼 → 행 삭제
  removeBtn.addEventListener('click', () => {
    if (list.children.length > 1) {
      const allInputs = [...list.querySelectorAll('.proc-item-input')];
      const curIdx = allInputs.indexOf(input);
      const target = allInputs[curIdx - 1] || allInputs[curIdx + 1];
      list.removeChild(row);
      updateProcItemNumbers();
      if (target) target.focus();
    }
    updateRemoveBtnState();
  });

  return row;
}

function appendProcItemRow() {
  const list = document.getElementById('dlgProcItemList');
  const idx  = list.children.length;
  const row  = createProcItemRow(idx);
  list.appendChild(row);
  row.querySelector('.proc-item-input').focus();
  updateRemoveBtnState();
}

function initProcItemList() {
  const list = document.getElementById('dlgProcItemList');
  if (!list) return;
  list.innerHTML = '';
  const row = createProcItemRow(0);
  list.appendChild(row);
  updateRemoveBtnState();
}

function updateProcItemNumbers() {
  const list = document.getElementById('dlgProcItemList');
  [...list.children].forEach((row, i) => {
    const num   = row.querySelector('.proc-item-num');
    const input = row.querySelector('.proc-item-input');
    if (num)   num.textContent   = i + 1;
    if (input) input.placeholder = `항목 ${i + 1} (예: 항타기${i + 1}차)`;
  });
  updateRemoveBtnState();
}

function updateRemoveBtnState() {
  const list = document.getElementById('dlgProcItemList');
  if (!list) return;
  const rows = list.querySelectorAll('.proc-item-row');
  rows.forEach(row => {
    const btn = row.querySelector('.btn-remove-item');
    if (btn) btn.disabled = rows.length === 1;
  });
}

function getProcItemValues() {
  return [...document.querySelectorAll('#dlgProcItemList .proc-item-input')]
    .map(el => el.value.trim())
    .filter(v => v !== '');
}

// "＋ 항목 추가" 버튼
document.getElementById('btnAddProcItem').addEventListener('click', () => {
  appendProcItemRow();
});

function updateAutoProcessUI(cat1Id, cat2Id) {
  const isEditMode = !!document.getElementById('dialogProjectId').value;
  const catName = cat2Id ? getCatName(cat2Id) : getCatName(cat1Id);
  const hasTemplate = !!AUTO_PROCESS_TEMPLATES[catName] || catName === '건진법';
  const isGunjin = catName === '건진법';

  document.getElementById('dlgAutoProcessNotice').style.display = (!isEditMode && hasTemplate) ? '' : 'none';
  document.getElementById('dlgProcItemGroup').style.display      = (!isEditMode && isGunjin)   ? '' : 'none';
}

// 대분류 선택 시 중분류 채우기
document.getElementById('dlgCat1').addEventListener('change', (e) => {
  const children = allCategories.filter(c => c.parent_id === e.target.value);
  const sel2     = document.getElementById('dlgCat2');
  sel2.innerHTML = children.length
    ? '<option value="">선택하세요</option>' + children.map(c => `<option value="${c.id}">${c.name}</option>`).join('')
    : '<option value="">해당 없음</option>';
  updateAutoProcessUI(e.target.value, '');
});

document.getElementById('dlgCat2').addEventListener('change', (e) => {
  const cat1Id = document.getElementById('dlgCat1').value;
  updateAutoProcessUI(cat1Id, e.target.value);
});

// ═══════════════════════════════════════════════════════════
// 통계 업데이트
// ═══════════════════════════════════════════════════════════
function updateStats(projects) {
  document.getElementById('stat-total').textContent   = projects.length;
  document.getElementById('stat-active').textContent  = projects.filter(p => p.status === '진행중').length;
  document.getElementById('stat-billing').textContent = projects.filter(p => p.status === '청구완료').length;
  document.getElementById('stat-done').textContent    = projects.filter(p => p.status === '완료').length;
}

// ═══════════════════════════════════════════════════════════
// 전체 현황 대시보드
// ═══════════════════════════════════════════════════════════
function renderDashboard() {
  const search  = document.getElementById('searchInput').value.toLowerCase();
  const status  = document.getElementById('filterStatus').value;
  const catId   = document.getElementById('filterCategory').value;

  let projects = allProjects.filter(p => {
    if (search && !p.name.toLowerCase().includes(search)) return false;
    if (status && p.status !== status) return false;
    if (catId) {
      const l1 = getCatLevel1(p.category_id);
      if (!l1 || l1.id !== catId) return false;
    }
    return true;
  });

  updateStats(allProjects);

  const container = document.getElementById('project-container');
  container.className = currentView === 'card' ? 'card-grid' : 'project-list';

  if (projects.length === 0) {
    container.innerHTML = `
      <div class="empty-state" style="grid-column:1/-1">
        <div class="empty-icon">📂</div>
        <p>${allProjects.length === 0 ? '프로젝트가 없습니다. 새 프로젝트를 등록하세요.' : '검색 결과가 없습니다.'}</p>
      </div>`;
    return;
  }

  if (currentView === 'card') {
    container.innerHTML = projects.map(p => renderProjectCard(p)).join('');
  } else {
    container.innerHTML = projects.map(p => renderProjectRow(p)).join('');
  }

  // 클릭 → 상세 패널
  container.querySelectorAll('[data-proj-id]').forEach(el => {
    el.addEventListener('click', (e) => {
      if (e.target.closest('.icon-btn')) return;
      openProjectModal(el.dataset.projId);
    });
  });

  // 삭제 버튼
  container.querySelectorAll('.btn-del-proj').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      if (!confirm(`"${btn.dataset.name}" 프로젝트를 휴지통으로 이동할까요?`)) return;
      await window.api.deleteProject(btn.dataset.id);
      allProjects = await window.api.getProjects();
      renderDashboard();
    });
  });
}

function renderProjectCard(p) {
  const progress = calcProjectProgress(p.id);
  return `
  <div class="project-card" data-proj-id="${p.id}">
    <div class="card-header">
      <div class="card-name">${p.name}</div>
      <span class="status-badge status-${p.status}">${p.status}</span>
    </div>
    <div class="card-category">📁 ${getCategoryBreadcrumb(p.category_id)}</div>
    <div class="card-progress">
      <div class="progress-label">
        <span>진행률</span>
        <span>${progress}%</span>
      </div>
      <div class="progress-bar"><div class="progress-fill" style="width:${progress}%"></div></div>
    </div>
    <div class="card-footer">
      <span class="card-proc-count">⚙ ${getProcessCount(p.id)}개 공정</span>
      <div class="row-actions">
        <button class="icon-btn" title="편집" onclick="openEditProject('${p.id}')">✏️</button>
        <button class="icon-btn del btn-del-proj" data-id="${p.id}" data-name="${p.name}" title="삭제">🗑️</button>
      </div>
    </div>
  </div>`;
}

function renderProjectRow(p) {
  const progress = calcProjectProgress(p.id);
  return `
  <div class="project-row" data-proj-id="${p.id}">
    <div class="row-name">${p.name}</div>
    <div class="row-cat">${getCategoryBreadcrumb(p.category_id)}</div>
    <div class="row-prog">
      <div class="progress-label" style="font-size:10px">
        <span>진행률</span><span>${progress}%</span>
      </div>
      <div class="progress-bar">
        <div class="progress-fill" style="width:${progress}%"></div>
      </div>
    </div>
    <div class="row-status">
      <span class="status-badge status-${p.status}">${p.status}</span>
    </div>
    <div class="row-actions">
      <button class="icon-btn" title="편집" onclick="openEditProject('${p.id}')">✏️</button>
      <button class="icon-btn del btn-del-proj" data-id="${p.id}" data-name="${p.name}" title="삭제">🗑️</button>
    </div>
  </div>`;
}

// ─ 프로젝트 진행률 계산 (완료 공정 수 / 전체 공정 수)
const processCache = {};
function getProcessCount(projectId) {
  return (processCache[projectId] || []).filter(p => !p.is_group).length;
}
function calcProjectProgress(projectId) {
  const procs = (processCache[projectId] || []).filter(p => !p.is_group);
  if (!procs.length) return 0;
  const done = procs.filter(p => p.status === '완료').length;
  return Math.round((done / procs.length) * 100);
}

// 모든 프로젝트의 공정을 미리 로드
async function preloadProcesses() {
  await Promise.all(allProjects.map(async p => {
    processCache[p.id] = await window.api.getProcesses(p.id);
  }));
}

// ─ 필터/검색 이벤트
document.getElementById('searchInput').addEventListener('input',    renderDashboard);
document.getElementById('filterStatus').addEventListener('change',  renderDashboard);
document.getElementById('filterCategory').addEventListener('change',renderDashboard);

// ─ 뷰 토글
document.querySelectorAll('.view-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.view-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    currentView = btn.dataset.view;
    renderDashboard();
  });
});

// ═══════════════════════════════════════════════════════════
// 프로젝트 등록 / 편집 다이얼로그
// ═══════════════════════════════════════════════════════════
document.getElementById('btnNewProject').addEventListener('click', () => openProjectDialog(null));
document.getElementById('btnDlgCancel').addEventListener('click',  () => closeDialog('projectDialog'));

function openProjectDialog(projectId) {
  const proj = projectId ? allProjects.find(p => p.id === projectId) : null;
  document.getElementById('dialogTitle').textContent    = proj ? '프로젝트 편집' : '새 프로젝트 등록';
  document.getElementById('dialogProjectId').value      = projectId || '';
  document.getElementById('dlgName').value              = proj?.name || '';
  document.getElementById('dlgDesc').value              = proj?.description || '';

  // 카테고리 세팅
  let parentId = null;
  if (proj?.category_id) {
    const cat = allCategories.find(c => c.id === proj.category_id);
    if (cat?.level === 2) {
      parentId = cat.parent_id;
      document.getElementById('dlgCat1').value = parentId;
      // 중분류 채우기
      const children = allCategories.filter(c => c.parent_id === parentId);
      document.getElementById('dlgCat2').innerHTML =
        '<option value="">선택하세요</option>' +
        children.map(c => `<option value="${c.id}"${c.id === proj.category_id ? ' selected' : ''}>${c.name}</option>`).join('');
    } else if (cat?.level === 1) {
      document.getElementById('dlgCat1').value = proj.category_id;
    }
  } else {
    document.getElementById('dlgCat1').value = '';
    document.getElementById('dlgCat2').innerHTML = '<option value="">선택하세요</option>';
  }

  // 자동생성 UI 초기화 (편집 모드에서는 숨김)
  initProcItemList();
  document.getElementById('dlgAutoProcessNotice').style.display = 'none';
  document.getElementById('dlgProcItemGroup').style.display     = 'none';

  openDialog('projectDialog');
}

document.getElementById('btnDlgSave').addEventListener('click', async () => {
  const name = document.getElementById('dlgName').value.trim();
  if (!name) { alert('프로젝트명을 입력하세요.'); return; }

  const cat2Val = document.getElementById('dlgCat2').value;
  const cat1Val = document.getElementById('dlgCat1').value;
  const catId   = cat2Val && cat2Val !== '' && cat2Val !== '선택하세요' ? cat2Val : (cat1Val || null);
  const desc    = document.getElementById('dlgDesc').value.trim();
  const projId  = document.getElementById('dialogProjectId').value;

  if (projId) {
    await window.api.updateProject(projId, { name, description: desc, category_id: catId });
  } else {
    const newProj = await window.api.createProject({ name, description: desc, category_id: catId });

    // 공정 자동생성
    const catName = catId ? getCatName(catId) : '';
    if (catName === '건진법') {
      // 계약: 프로젝트 전체 1건 (최상위, 비그룹)
      await window.api.createProcess({ project_id: newProj.id, name: '계약' });
      // 사용자 입력 항목명 목록으로 그룹 + 세부공정 생성
      const prefixes = getProcItemValues();
      for (const prefix of prefixes) {
        const group = await window.api.createProcess({ project_id: newProj.id, name: prefix, is_group: true });
        for (const item of GUNJIN_SUB_ITEMS) {
          await window.api.createProcess({ project_id: newProj.id, name: item, parent_id: group.id });
        }
      }
    } else {
      const templates = AUTO_PROCESS_TEMPLATES[catName];
      if (templates) {
        for (const pname of templates) {
          await window.api.createProcess({ project_id: newProj.id, name: pname });
        }
      }
    }
  }

  allProjects = await window.api.getProjects();
  await preloadProcesses();
  closeDialog('projectDialog');
  renderDashboard();
});

window.openEditProject = async (projectId) => {
  openProjectDialog(projectId);
};

// ═══════════════════════════════════════════════════════════
// 프로젝트 상세 슬라이드 패널
// ═══════════════════════════════════════════════════════════
async function openProjectModal(projectId) {
  currentProjId  = projectId;
  currentGroupId = null; // 드릴인 상태 초기화
  const proj = allProjects.find(p => p.id === projectId);
  if (!proj) return;

  document.getElementById('modalProjName').textContent = proj.name;
  document.getElementById('modalProjCat').textContent  = getCategoryBreadcrumb(proj.category_id);
  const badge = document.getElementById('modalStatusBadge');
  badge.textContent = proj.status;
  badge.className   = `status-badge status-${proj.status}`;

  document.getElementById('dlgProcProjectId').value = projectId;

  switchModalTab('processes');
  await renderProcessList(projectId);
  document.getElementById('projectModal').classList.add('open');
}

document.getElementById('btnCloseModal').addEventListener('click', () => {
  document.getElementById('projectModal').classList.remove('open');
  currentProjId = null;
});
document.getElementById('projectModal').addEventListener('click', (e) => {
  if (e.target === e.currentTarget) {
    document.getElementById('projectModal').classList.remove('open');
    currentProjId = null;
  }
});

// 편집
document.getElementById('btnEditProject').addEventListener('click', () => {
  if (currentProjId) openProjectDialog(currentProjId);
});

// 모달 탭 전환
document.querySelectorAll('.modal-tab').forEach(tab => {
  tab.addEventListener('click', () => switchModalTab(tab.dataset.tab));
});

function switchModalTab(tabName) {
  document.querySelectorAll('.modal-tab').forEach(t => t.classList.remove('active'));
  document.querySelector(`.modal-tab[data-tab="${tabName}"]`).classList.add('active');
  document.getElementById('modal-tab-processes').style.display = tabName === 'processes' ? 'block' : 'none';
  document.getElementById('modal-tab-memos').style.display     = tabName === 'memos'     ? 'block' : 'none';
  if (tabName === 'memos' && currentProjId) renderMemoList(currentProjId);
}

// ═══════════════════════════════════════════════════════════
// 공정 관리
// ═══════════════════════════════════════════════════════════
async function renderProcessList(projectId) {
  const procs = await window.api.getProcesses(projectId);
  processCache[projectId] = procs;
  const container = document.getElementById('processList');
  const addBtn    = document.getElementById('btnAddProcess');

  if (procs.length === 0) {
    container.innerHTML = '<div class="empty-state"><div class="empty-icon">⚙️</div><p>등록된 공정이 없습니다.</p></div>';
    setGunjinNav(false);
    addBtn.style.display = '';
    return;
  }

  if (isGunjinProject(projectId)) {
    renderGunjinView(projectId, procs, container, addBtn);
  } else {
    setGunjinNav(false);
    addBtn.style.display = '';
    container.innerHTML = procs.map(proc => renderProcessItem(proc)).join('');
    attachProcItemEvents(procs, projectId, container);
  }
}

// 건진법 그룹 네비게이션 바 표시/숨김
function setGunjinNav(visible, groupName = '') {
  const nav = document.getElementById('procGroupNav');
  nav.style.display = visible ? 'flex' : 'none';
  if (visible) document.getElementById('procGroupName').textContent = groupName;
}

// 건진법 전용 뷰 렌더링
function renderGunjinView(projectId, allProcs, container, addBtn) {
  if (currentGroupId) {
    // ── 드릴인: 그룹 세부 항목 ──
    const group    = allProcs.find(p => p.id === currentGroupId);
    const children = allProcs.filter(p => p.parent_id === currentGroupId);
    setGunjinNav(true, group?.name || '');
    addBtn.style.display = 'none';

    if (children.length === 0) {
      container.innerHTML = '<div class="empty-state"><div class="empty-icon">📋</div><p>세부 항목이 없습니다.</p></div>';
      return;
    }
    container.innerHTML = children.map(proc => renderProcessItem(proc)).join('');
    attachProcItemEvents(children, projectId, container);
  } else {
    // ── 최상위: 계약 + 그룹 목록 ──
    setGunjinNav(false);
    addBtn.style.display = '';
    const topLevel = allProcs.filter(p => !p.parent_id);
    container.innerHTML = topLevel.map(proc =>
      proc.is_group ? renderGunjinGroupItem(proc, allProcs) : renderProcessItem(proc)
    ).join('');

    // 그룹 아이템 클릭 → 드릴인
    container.querySelectorAll('.gunjin-group-item').forEach(item => {
      item.addEventListener('click', () => {
        currentGroupId = item.dataset.groupId;
        renderProcessList(projectId);
      });
    });

    // 그룹 삭제 (그룹 + 자식 일괄 삭제)
    container.querySelectorAll('.gunjin-group-item .btn-del-proc').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        if (!confirm('이 항목과 하위 공정을 모두 삭제할까요?')) return;
        const gid      = btn.dataset.id;
        const children = allProcs.filter(p => p.parent_id === gid);
        for (const c of children) await window.api.deleteProcess(c.id);
        await window.api.deleteProcess(gid);
        await renderProcessList(projectId);
        allProjects = await window.api.getProjects();
        renderDashboard();
      });
    });

    // 비그룹 항목(계약 등) 이벤트
    attachProcItemEvents(topLevel.filter(p => !p.is_group), projectId, container);
  }
}

// 건진법 그룹 아이템 렌더링
function renderGunjinGroupItem(proc, allProcs) {
  const children = allProcs.filter(p => p.parent_id === proc.id);
  const done     = children.filter(p => p.status === '완료').length;
  const total    = children.length;
  const pct      = total ? Math.round((done / total) * 100) : 0;
  return `
  <div class="gunjin-group-item" data-group-id="${proc.id}">
    <div class="gunjin-group-info">
      <span class="gunjin-group-icon">📁</span>
      <span class="gunjin-group-name">${proc.name}</span>
      <span class="gunjin-group-count">${done}/${total} 완료</span>
      <div class="progress-bar" style="width:80px;margin:0 6px">
        <div class="progress-fill" style="width:${pct}%"></div>
      </div>
      <span class="gunjin-group-pct">${pct}%</span>
    </div>
    <div class="gunjin-group-actions">
      <span class="gunjin-group-arrow">›</span>
      <button class="icon-btn del btn-del-proc" data-id="${proc.id}" title="항목 삭제">🗑</button>
    </div>
  </div>`;
}

// 공정 아이템 공통 이벤트 바인딩
function attachProcItemEvents(procs, projectId, container) {
  container.querySelectorAll('.proc-mode-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const procId = btn.closest('.proc-mode-toggle').dataset.procId;
      procModes[procId] = btn.dataset.mode;
      renderProcessList(projectId);
    });
  });

  container.querySelectorAll('.btn-cal').forEach(btn => {
    btn.addEventListener('click', () => {
      const input = document.getElementById(btn.dataset.inputId);
      if (!input) return;
      try { input.showPicker(); } catch (e) { input.click(); }
    });
  });

  container.querySelectorAll('.proc-status-select').forEach(sel => {
    sel.addEventListener('change', async (e) => {
      await window.api.updateProcess(sel.dataset.id, { status: e.target.value });
      allProjects = await window.api.getProjects();
      const proj  = allProjects.find(p => p.id === projectId);
      if (proj) {
        document.getElementById('modalStatusBadge').textContent = proj.status;
        document.getElementById('modalStatusBadge').className   = `status-badge status-${proj.status}`;
      }
      renderDashboard();
      if (currentPage === 'schedule') renderSchedule();
    });
  });

  container.querySelectorAll('.date-input').forEach(input => {
    input.addEventListener('change', async (e) => {
      const data = {};
      data[input.dataset.field] = e.target.value || null;
      if (input.dataset.sync) data[input.dataset.sync] = e.target.value || null;
      await window.api.updateProcess(input.dataset.id, data);
      processCache[projectId] = await window.api.getProcesses(projectId);
      renderDashboard();
      if (currentPage === 'schedule') renderSchedule();
    });
  });

  container.querySelectorAll('.btn-del-proc').forEach(btn => {
    if (btn.closest('.gunjin-group-item')) return; // 그룹 삭제는 위에서 처리
    btn.addEventListener('click', async () => {
      if (!confirm('이 공정을 삭제할까요?')) return;
      delete procModes[btn.dataset.id];
      await window.api.deleteProcess(btn.dataset.id);
      await renderProcessList(projectId);
      allProjects = await window.api.getProjects();
      renderDashboard();
    });
  });
}

function renderProcessItem(proc) {
  const statusColors = { '대기': 'var(--status-wait)', '진행': 'var(--status-active)', '완료': 'var(--status-done)' };
  const color = statusColors[proc.status] || 'var(--text-dim)';
  const mode  = procModes[proc.id] ?? getDefaultProcMode(proc);

  // 날짜 입력 필드 빌더 (달력 버튼 포함)
  const dateField = (label, field, value) => `
    <div class="date-field">
      <span class="date-label">${label}</span>
      <div class="date-with-btn">
        <input type="date" class="date-input" id="di_${proc.id}_${field}"
               data-id="${proc.id}" data-field="${field}"
               ${field === 'plan_start' && mode === 'short' ? 'data-sync="plan_end"' : ''}
               ${field === 'actual_start' && mode === 'short' ? 'data-sync="actual_end"' : ''}
               value="${value || ''}">
        <button class="btn-cal" data-input-id="di_${proc.id}_${field}" title="달력">📅</button>
      </div>
    </div>`;

  const planFields = mode === 'short'
    ? dateField('계획일자', 'plan_start', proc.plan_start)
    : dateField('계획 시작', 'plan_start', proc.plan_start) + dateField('계획 종료', 'plan_end', proc.plan_end);

  const actualFields = mode === 'short'
    ? dateField('실시일자', 'actual_start', proc.actual_start)
    : dateField('실시 시작', 'actual_start', proc.actual_start) + dateField('실시 종료', 'actual_end', proc.actual_end);

  return `
  <div class="process-item" id="proc-${proc.id}">
    <div class="proc-header">
      <div class="proc-name">${proc.name}</div>
      <div class="proc-mode-toggle" data-proc-id="${proc.id}">
        <button class="proc-mode-btn${mode === 'short' ? ' active' : ''}" data-mode="short">단기</button>
        <button class="proc-mode-btn${mode === 'long'  ? ' active' : ''}" data-mode="long">장기</button>
      </div>
      <select class="proc-status-select" data-id="${proc.id}" style="color:${color}">
        ${['대기','진행','완료'].map(s =>
          `<option value="${s}"${proc.status === s ? ' selected' : ''}>${s}</option>`
        ).join('')}
      </select>
      <button class="icon-btn del btn-del-proc" data-id="${proc.id}" title="삭제">🗑</button>
    </div>
    <div class="proc-dates">
      ${planFields}
      ${actualFields}
    </div>
  </div>`;
}

// 공정 추가 — 단기/장기 토글
let currentDateType = 'short';

function setDateType(type) {
  currentDateType = type;
  document.getElementById('btnDateShort').classList.toggle('active', type === 'short');
  document.getElementById('btnDateLong').classList.toggle('active', type === 'long');
  document.getElementById('dlgActualShort').style.display = type === 'short' ? '' : 'none';
  document.getElementById('dlgActualLong').style.display  = type === 'long'  ? '' : 'none';
}

document.getElementById('btnDateShort').addEventListener('click', () => setDateType('short'));
document.getElementById('btnDateLong').addEventListener('click',  () => setDateType('long'));

// 건진법 목록으로 돌아가기
document.getElementById('btnBackToGroup').addEventListener('click', () => {
  currentGroupId = null;
  renderProcessList(currentProjId);
});

// 건진법 그룹 추가 다이얼로그
document.getElementById('btnGunjinGroupCancel').addEventListener('click', () => closeDialog('gunjinGroupDialog'));
document.getElementById('btnGunjinGroupSave').addEventListener('click', async () => {
  const name = document.getElementById('dlgGunjinGroupName').value.trim();
  if (!name) { alert('항목명을 입력하세요.'); return; }
  const group = await window.api.createProcess({ project_id: currentProjId, name, is_group: true });
  for (const item of GUNJIN_SUB_ITEMS) {
    await window.api.createProcess({ project_id: currentProjId, name: item, parent_id: group.id });
  }
  closeDialog('gunjinGroupDialog');
  await renderProcessList(currentProjId);
  allProjects = await window.api.getProjects();
  await preloadProcesses();
  renderDashboard();
  showToast(`"${name}" 항목이 추가됐습니다.`);
});
document.getElementById('gunjinGroupDialog').addEventListener('click', (e) => {
  if (e.target === e.currentTarget) closeDialog('gunjinGroupDialog');
});

document.getElementById('btnAddProcess').addEventListener('click', () => {
  // 건진법 최상위: 그룹 추가 다이얼로그
  if (isGunjinProject(currentProjId) && !currentGroupId) {
    document.getElementById('dlgGunjinGroupName').value = '';
    openDialog('gunjinGroupDialog');
    return;
  }
  // 일반 공정 추가
  document.getElementById('dlgProcName').value    = '';
  document.getElementById('dlgPlanStart').value   = '';
  document.getElementById('dlgPlanEnd').value     = '';
  document.getElementById('dlgActualDate').value  = '';
  document.getElementById('dlgActualStart').value = '';
  document.getElementById('dlgActualEnd').value   = '';
  setDateType('short');
  openDialog('processDialog');
});
document.getElementById('btnProcDlgCancel').addEventListener('click', () => closeDialog('processDialog'));
document.getElementById('btnProcDlgSave').addEventListener('click', async () => {
  const name = document.getElementById('dlgProcName').value.trim();
  if (!name) { alert('공정명을 입력하세요.'); return; }
  const projectId = document.getElementById('dlgProcProjectId').value;

  let actual_start = null, actual_end = null;
  if (currentDateType === 'short') {
    const d = document.getElementById('dlgActualDate').value;
    if (d) { actual_start = d; actual_end = d; }
  } else {
    actual_start = document.getElementById('dlgActualStart').value || null;
    actual_end   = document.getElementById('dlgActualEnd').value   || null;
  }

  await window.api.createProcess({
    project_id: projectId,
    name,
    plan_start: document.getElementById('dlgPlanStart').value || null,
    plan_end:   document.getElementById('dlgPlanEnd').value   || null,
    actual_start,
    actual_end,
  });
  closeDialog('processDialog');
  await renderProcessList(projectId);
  allProjects = await window.api.getProjects();
  renderDashboard();
});

// ═══════════════════════════════════════════════════════════
// 메모·이력
// ═══════════════════════════════════════════════════════════
async function renderMemoList(projectId) {
  const memos = await window.api.getMemosByProject(projectId);
  const list  = document.getElementById('memoList');

  if (memos.length === 0) {
    list.innerHTML = '<div class="empty-state"><div class="empty-icon">📝</div><p>등록된 메모가 없습니다.</p></div>';
    return;
  }

  list.innerHTML = memos.map(m => `
    <div class="memo-item">
      <div class="memo-item-header">
        <span class="memo-author">${m.author}</span>
        <span class="memo-date">${new Date(m.created_at).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
        ${m.tag ? `<span class="memo-tag-badge tag-${m.tag}">${m.tag}</span>` : ''}
        ${m.is_pinned ? '<span style="color:var(--cyan);font-size:12px">📌</span>' : ''}
      </div>
      <div class="memo-content">${escapeHtml(m.content)}</div>
      <button class="memo-delete" data-id="${m.id}" title="삭제">✕</button>
    </div>
  `).join('');

  list.querySelectorAll('.memo-delete').forEach(btn => {
    btn.addEventListener('click', async () => {
      await window.api.deleteMemo(btn.dataset.id);
      renderMemoList(projectId);
    });
  });
}

document.getElementById('btnAddMemo').addEventListener('click', async () => {
  const content = document.getElementById('memoContent').value.trim();
  if (!content) { alert('메모 내용을 입력하세요.'); return; }
  const tag = document.getElementById('memoTag').value;
  await window.api.createMemo({
    project_id: currentProjId,
    content,
    tag: tag || null,
  });
  document.getElementById('memoContent').value = '';
  document.getElementById('memoTag').value     = '';
  renderMemoList(currentProjId);
});

// Ctrl+Enter → 메모 저장 (Enter는 줄바꿈)
document.getElementById('memoContent').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
    e.preventDefault();
    document.getElementById('btnAddMemo').click();
  }
});

// ═══════════════════════════════════════════════════════════
// 3주 스케줄 뷰
// ═══════════════════════════════════════════════════════════

// 주 시작(월) 기준 날짜 계산
function getWeekMonday(date, offset = 0) {
  const d   = new Date(date);
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;  // 월요일 기준
  d.setDate(d.getDate() + diff + offset * 7);
  d.setHours(0, 0, 0, 0);
  return d;
}

function addDays(date, n) {
  const d = new Date(date);
  d.setDate(d.getDate() + n);
  return d;
}

function fmtDate(date) {
  return `${date.getMonth() + 1}/${date.getDate()}`;
}

function fmtISO(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

// 날짜가 [weekStart, weekStart+6] 범위에 있는지 확인
function isInWeek(dateStr, weekStart) {
  if (!dateStr) return false;
  const d   = parseLocalDate(dateStr);
  const end = addDays(weekStart, 6);
  return d >= weekStart && d <= end;
}

// "YYYY-MM-DD" 문자열을 로컬 자정으로 파싱 (new Date(str)는 UTC로 파싱되어 KST와 9시간 차이 발생)
function parseLocalDate(str) {
  const [y, m, d] = str.split('-').map(Number);
  return new Date(y, m - 1, d);
}

// ── 간트 바 위치 계산 (21일 윈도우 내 퍼센트) ─────────────────
function calcBarPct(startStr, endStr, firstDay) {
  if (!startStr && !endStr) return null;
  const dayMs = 86400000;
  const totalMs = 21 * dayMs;
  const firstMs = firstDay.getTime();

  const startMs = startStr ? parseLocalDate(startStr).getTime() : firstMs;
  const endMs   = endStr   ? parseLocalDate(endStr).getTime() + dayMs : firstMs + totalMs;

  if (startMs >= firstMs + totalMs || endMs <= firstMs) return null;

  const visStart = Math.max(startMs, firstMs);
  const visEnd   = Math.min(endMs,   firstMs + totalMs);

  const left  = ((visStart - firstMs) / totalMs * 100).toFixed(1);
  const width = ((visEnd - visStart)  / totalMs * 100).toFixed(1);
  return { left: left + '%', width: width + '%' };
}

// 공정이 3주 윈도우 내에 표시할 바(계획 or 실시)가 있는지 여부
function hasBarInWindow(proc, firstDay) {
  const planVis = calcBarPct(proc.plan_start, proc.plan_end, firstDay) !== null;
  const actualEnd = proc.actual_end || (proc.actual_start ? fmtISO(new Date()) : null);
  const actualVis = calcBarPct(proc.actual_start, actualEnd, firstDay) !== null;
  return planVis || actualVis;
}

// ── 간트 그리드 빌더 ──────────────────────────────────────────
function buildGanttGrid(weeks, todayISO) {
  const grid = document.createElement('div');
  grid.className = 'sched-gantt-grid';
  weeks.forEach(weekStart => {
    const wk = document.createElement('div');
    wk.className = 'sched-gantt-week';
    for (let d = 0; d < 7; d++) {
      const day = document.createElement('div');
      const cls = ['sched-gantt-day'];
      if (d >= 5) cls.push('weekend');
      if (fmtISO(addDays(weekStart, d)) === todayISO) cls.push('today-col');
      day.className = cls.join(' ');
      wk.appendChild(day);
    }
    grid.appendChild(wk);
  });
  return grid;
}

// ── 공정 행 빌더 ──────────────────────────────────────────────
function buildProcRow(proc, weeks, firstDay, todayISO, projId) {
  const row = document.createElement('div');
  row.className = 'sched-proc-row';

  const spacer = document.createElement('div');
  spacer.className = 'sched-proc-spacer';
  row.appendChild(spacer);

  const label = document.createElement('div');
  label.className = 'sched-proc-label';
  label.textContent = proc.name;
  label.title = proc.name;
  row.appendChild(label);

  const gantt = document.createElement('div');
  gantt.className = 'sched-gantt';
  gantt.appendChild(buildGanttGrid(weeks, todayISO));

  const barWrap = document.createElement('div');
  barWrap.className = 'sched-bar-wrap';

  if (proc.plan_start || proc.plan_end) {
    const s = calcBarPct(proc.plan_start, proc.plan_end, firstDay);
    if (s) {
      const b = document.createElement('div');
      b.className = 'sched-gantt-bar sched-bar-plan';
      b.style.left = s.left; b.style.width = s.width;
      b.addEventListener('click', () => openProjectModal(projId));
      barWrap.appendChild(b);
    }
  }
  if (proc.actual_start || proc.actual_end) {
    const actualEnd = proc.actual_end || fmtISO(new Date());
    const s = calcBarPct(proc.actual_start, actualEnd, firstDay);
    if (s) {
      const b = document.createElement('div');
      const done = proc.status === '완료' || proc.status === '청구완료';
      b.className = 'sched-gantt-bar sched-bar-actual ' + (done ? 'sched-bar-done' : 'sched-bar-active');
      b.style.left = s.left; b.style.width = s.width;
      b.addEventListener('click', () => openProjectModal(projId));
      barWrap.appendChild(b);
    }
  }

  gantt.appendChild(barWrap);
  row.appendChild(gantt);
  return row;
}

// ── 프로젝트 그룹 빌더 ────────────────────────────────────────
function buildProjGroup(proj, procs, weeks, firstDay, todayISO) {
  const actualProcs = procs.filter(p => !p.is_group);
  const done  = actualProcs.filter(p => p.status === '완료').length;
  const total = actualProcs.length;
  const pct   = total > 0 ? Math.round(done / total * 100) : 0;

  const grp = document.createElement('div');
  grp.className = 'sched-proj-group';
  grp.id = 'spg-' + proj.id;

  // ── 절대 위치 프로젝트 정보 셀 (공정 행만큼 병합) ─────────────
  const infoAbs = document.createElement('div');
  infoAbs.className = 'sched-proj-info-abs';
  infoAbs.addEventListener('click', () => grp.classList.toggle('collapsed'));

  const toggleRow = document.createElement('div');
  toggleRow.className = 'sched-proj-toggle-row';
  const chevron = document.createElement('div');
  chevron.className = 'sched-proj-chevron';
  chevron.textContent = '▾';
  const nameEl = document.createElement('div');
  nameEl.className = 'sched-proj-name';
  nameEl.textContent = proj.name;
  nameEl.title = proj.name;
  nameEl.addEventListener('click', e => { e.stopPropagation(); openProjectModal(proj.id); });
  toggleRow.appendChild(chevron);
  toggleRow.appendChild(nameEl);
  infoAbs.appendChild(toggleRow);

  const badgeMap = { '진행중': 'sched-badge-active', '완료': 'sched-badge-done', '대기': 'sched-badge-wait', '청구완료': 'sched-badge-billed' };
  const badge = document.createElement('span');
  badge.className = 'sched-status-badge ' + (badgeMap[proj.status] || 'sched-badge-wait');
  badge.textContent = proj.status;
  infoAbs.appendChild(badge);
  grp.appendChild(infoAbs);

  // ── 프로젝트 헤더 행 (infoAbs 아래 공간 확보용 플레이스홀더) ───
  const projRow = document.createElement('div');
  projRow.className = 'sched-proj-row';
  projRow.addEventListener('click', () => grp.classList.toggle('collapsed'));

  const projPlaceholder = document.createElement('div');
  projPlaceholder.className = 'sched-proj-placeholder';
  projRow.appendChild(projPlaceholder);

  const lEmpty = document.createElement('div');
  lEmpty.className = 'sched-label-empty';
  projRow.appendChild(lEmpty);

  // 간트 + 접힌 요약
  const gantt = document.createElement('div');
  gantt.className = 'sched-gantt';
  gantt.appendChild(buildGanttGrid(weeks, todayISO));

  const summColor = proj.status === '완료' ? '#16a34a' : 'var(--accent)';
  const summ = document.createElement('div');
  summ.className = 'sched-collapsed-summary';
  summ.innerHTML = `
    <div class="sched-summary-bar-wrap">
      <div class="sched-summary-bar-fill" style="width:${pct}%;background:${summColor}"></div>
    </div>
    <span class="sched-summary-text">${done}/${total} 완료</span>`;
  gantt.appendChild(summ);
  projRow.appendChild(gantt);

  grp.appendChild(projRow);

  // ── 공정 행들
  const procRows = document.createElement('div');
  procRows.className = 'sched-proc-rows';

  if (isGunjinProject(proj.id)) {
    procs.filter(p => !p.parent_id && !p.is_group && hasBarInWindow(p, firstDay)).forEach(p =>
      procRows.appendChild(buildProcRow(p, weeks, firstDay, todayISO, proj.id)));
    procs.filter(p => p.is_group).forEach(grpProc => {
      const visibleChildren = procs.filter(p => p.parent_id === grpProc.id && hasBarInWindow(p, firstDay));
      if (visibleChildren.length === 0) return; // 3주 내 공정 없으면 그룹 숨김
      const sRow = document.createElement('div');
      sRow.className = 'sched-subgrp-row';
      sRow.innerHTML = `
        <div class="sched-subgrp-spacer"></div>
        <div class="sched-subgrp-label">
          <span class="sched-subgrp-dot"></span>${escapeHtml(grpProc.name)}
        </div>
        <div class="sched-subgrp-gantt sched-gantt"></div>`;
      procRows.appendChild(sRow);
      visibleChildren.forEach(child =>
        procRows.appendChild(buildProcRow(child, weeks, firstDay, todayISO, proj.id)));
    });
  } else {
    procs.filter(p => !p.is_group && hasBarInWindow(p, firstDay)).forEach(p =>
      procRows.appendChild(buildProcRow(p, weeks, firstDay, todayISO, proj.id)));
  }

  grp.appendChild(procRows);
  return grp;
}

// ── 대분류 그룹 빌더 ──────────────────────────────────────────
async function buildCatGroup(cat, catProjects, weeks, firstDay, todayISO) {
  const catDiv = document.createElement('div');
  catDiv.className = 'sched-cat-group';

  const header = document.createElement('div');
  header.className = 'sched-cat-header';
  header.innerHTML = `
    <div class="sched-col-proj sched-cat-toggle-col">
      <div class="sched-cat-icon">▾</div>
      <span class="sched-cat-name">${escapeHtml(cat.name)}</span>
      <span class="sched-cat-count">${catProjects.length}</span>
    </div>
    <div class="sched-col-label"></div>
    <div class="sched-weeks"></div>`;
  header.addEventListener('click', () => catDiv.classList.toggle('collapsed'));
  catDiv.appendChild(header);

  for (const proj of catProjects) {
    const procs = processCache[proj.id] || await window.api.getProcesses(proj.id);
    processCache[proj.id] = procs;
    catDiv.appendChild(buildProjGroup(proj, procs, weeks, firstDay, todayISO));
  }
  return catDiv;
}

// ── 스케줄 렌더링 (전면 교체) ─────────────────────────────────
async function renderSchedule() {
  const schedBodyEl = document.querySelector('.schedule-body');
  const savedTop  = schedBodyEl ? schedBodyEl.scrollTop  : 0;

  const today      = new Date();
  const lastMonday = getWeekMonday(today, scheduleOffset - 1);
  const thisMonday = getWeekMonday(today, scheduleOffset);
  const nextMonday = getWeekMonday(today, scheduleOffset + 1);
  const weeks      = [lastMonday, thisMonday, nextMonday];
  const weekLabels = ['LAST WEEK', 'THIS WEEK', 'NEXT WEEK'];
  const DAY_KR     = ['월','화','수','목','금','토','일'];
  const todayISO   = fmtISO(today);
  const firstDay   = lastMonday;

  document.getElementById('weekLabel').textContent =
    `${fmtDate(lastMonday)} ~ ${fmtDate(addDays(nextMonday, 6))} (${today.getFullYear()})`;

  const content = document.getElementById('scheduleContent');
  content.innerHTML = '';

  // ── 고정 헤더 빌드
  const header = document.createElement('div');
  header.className = 'sched-header-row';

  const hProj = document.createElement('div');
  hProj.className = 'sched-col-proj sched-hdr-lbl';
  hProj.textContent = '프로젝트';
  header.appendChild(hProj);

  const hLabel = document.createElement('div');
  hLabel.className = 'sched-col-label sched-hdr-lbl';
  hLabel.textContent = '공정';
  header.appendChild(hLabel);

  const hWeeks = document.createElement('div');
  hWeeks.className = 'sched-weeks';

  weeks.forEach((weekStart, wi) => {
    const wg = document.createElement('div');
    wg.className = 'sched-week-group';

    const wt = document.createElement('div');
    wt.className = 'sched-week-title' + (wi === 1 ? ' this' : '');
    wt.textContent = `${weekLabels[wi]}  ${fmtDate(weekStart)} ~ ${fmtDate(addDays(weekStart, 6))}`;
    wg.appendChild(wt);

    const wd = document.createElement('div');
    wd.className = 'sched-week-days';
    for (let d = 0; d < 7; d++) {
      const date = addDays(weekStart, d);
      const dc = document.createElement('div');
      const cls = ['sched-day-cell'];
      if (fmtISO(date) === todayISO) cls.push('today');
      if (d >= 5) cls.push('weekend');
      dc.className = cls.join(' ');
      dc.innerHTML = `<span class="day-num">${date.getDate()}</span><span class="day-name">${DAY_KR[d]}</span>`;
      wd.appendChild(dc);
    }
    wg.appendChild(wd);
    hWeeks.appendChild(wg);
  });

  header.appendChild(hWeeks);
  content.appendChild(header);

  // ── 프로젝트 렌더
  const searchFiltered = scheduleSearch
    ? allProjects.filter(p => p.name.toLowerCase().includes(scheduleSearch.toLowerCase()))
    : allProjects;

  // 3주 윈도우 내 표시할 공정이 하나라도 있는 프로젝트만 표시
  const schedProjects = searchFiltered.filter(p => {
    const procs = processCache[p.id] || [];
    if (isGunjinProject(p.id)) {
      const topVis   = procs.some(q => !q.parent_id && !q.is_group && hasBarInWindow(q, firstDay));
      const childVis = procs.some(q => q.parent_id && hasBarInWindow(q, firstDay));
      return topVis || childVis;
    }
    return procs.some(q => !q.is_group && hasBarInWindow(q, firstDay));
  });

  if (schedProjects.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'sched-empty';
    empty.textContent = scheduleSearch
      ? `"${scheduleSearch}" 검색 결과가 없습니다.`
      : '이 기간에 계획·실시 일정이 있는 공정이 없습니다.';
    content.appendChild(empty);
    return;
  }

  const level1Cats    = allCategories.filter(c => c.level === 1);
  const uncategorized = schedProjects.filter(p => !p.category_id);

  for (const cat of level1Cats) {
    const catProjs = schedProjects.filter(p => {
      const l1 = getCatLevel1(p.category_id);
      return l1 && l1.id === cat.id;
    });
    if (catProjs.length === 0) continue;
    content.appendChild(await buildCatGroup(cat, catProjs, weeks, firstDay, todayISO));
  }

  if (uncategorized.length > 0) {
    content.appendChild(await buildCatGroup({ id: '_uncat', name: '미분류' }, uncategorized, weeks, firstDay, todayISO));
  }

  if (schedBodyEl) schedBodyEl.scrollTop = savedTop;
}

// 스케줄 네비게이션
document.getElementById('btnPrevWeek').addEventListener('click', () => { scheduleOffset--; renderSchedule(); });
document.getElementById('btnNextWeek').addEventListener('click', () => { scheduleOffset++; renderSchedule(); });
document.getElementById('btnGoToday').addEventListener('click',  () => { scheduleOffset = 0; renderSchedule(); });

// 스케줄 프로젝트 검색
document.getElementById('schedSearchInput').addEventListener('input', (e) => {
  scheduleSearch = e.target.value.trim();
  const clearBtn = document.getElementById('btnSchedSearchClear');
  clearBtn.style.display = scheduleSearch ? '' : 'none';
  renderSchedule();
});
document.getElementById('btnSchedSearchClear').addEventListener('click', () => {
  document.getElementById('schedSearchInput').value = '';
  document.getElementById('btnSchedSearchClear').style.display = 'none';
  scheduleSearch = '';
  renderSchedule();
});

// ═══════════════════════════════════════════════════════════
// 이번주 브리핑
// ═══════════════════════════════════════════════════════════
async function renderBriefing() {
  const today     = new Date();
  const weekStart = getWeekMonday(today, 0);
  const weekEnd   = addDays(weekStart, 6);
  const body      = document.getElementById('briefingBody');
  const weekLabel = document.getElementById('briefingWeekLabel');

  weekLabel.textContent = `${fmtDate(weekStart)} (월) ~ ${fmtDate(weekEnd)} (일)`;
  body.innerHTML = '';

  const activeProjects = allProjects.filter(p => p.status !== '완료' && p.status !== '청구완료');

  // 이번주 포함 여부 체크
  const inThisWeek = (p) => {
    if (p.is_group) return false;
    const ps = p.plan_start ? new Date(p.plan_start) : null;
    const pe = p.plan_end   ? new Date(p.plan_end)   : null;
    if (!ps) return false;
    return ps <= weekEnd && (pe || ps) >= weekStart;
  };

  const groups = [];
  for (const proj of activeProjects) {
    const procs  = processCache[proj.id] || await window.api.getProcesses(proj.id);
    const gunjin = isGunjinProject(proj.id);

    if (gunjin) {
      const topProcs     = procs.filter(p => !p.is_group && !p.parent_id && inThisWeek(p));
      const gunjinGroups = [];
      for (const grp of procs.filter(p => p.is_group)) {
        const children = procs.filter(p => p.parent_id === grp.id && inThisWeek(p));
        if (children.length > 0) gunjinGroups.push({ grp, children });
      }
      const total = topProcs.length + gunjinGroups.reduce((s, g) => s + g.children.length, 0);
      if (total > 0) groups.push({ proj, gunjin: true, gunjinGroups, topProcs, total });
    } else {
      const thisWeekProcs = procs.filter(inThisWeek);
      if (thisWeekProcs.length > 0) groups.push({ proj, gunjin: false, procs: thisWeekProcs, total: thisWeekProcs.length });
    }
  }

  // 요약 집계
  const flatAll  = (g) => g.gunjin
    ? [...g.topProcs, ...g.gunjinGroups.flatMap(gg => gg.children)]
    : g.procs;
  const totalProcs = groups.reduce((s, g) => s + g.total, 0);
  const doneCnt    = groups.reduce((s, g) => s + flatAll(g).filter(p => p.status === '완료').length, 0);
  const inProgCnt  = groups.reduce((s, g) => s + flatAll(g).filter(p => p.status === '진행').length, 0);
  const waitCnt    = totalProcs - doneCnt - inProgCnt;

  // 요약 바
  const summaryEl = document.createElement('div');
  summaryEl.className = 'briefing-summary-bar';
  summaryEl.innerHTML = `
    <div class="briefing-summary-item"><span class="briefing-summary-num">${groups.length}</span><span>개 프로젝트</span></div>
    <span class="briefing-summary-sep">|</span>
    <div class="briefing-summary-item"><span class="briefing-summary-num" style="color:var(--text-sec)">${waitCnt}</span><span>대기</span></div>
    <div class="briefing-summary-item"><span class="briefing-summary-num" style="color:var(--status-active-fg)">${inProgCnt}</span><span>진행중</span></div>
    <div class="briefing-summary-item"><span class="briefing-summary-num" style="color:var(--status-done-fg)">${doneCnt}</span><span>완료</span></div>`;
  body.appendChild(summaryEl);

  if (groups.length === 0) {
    const emptyEl = document.createElement('div');
    emptyEl.className = 'briefing-empty';
    emptyEl.innerHTML = `<div class="briefing-empty-icon">📋</div><p>이번주 진행 예정인 공정이 없습니다.</p>`;
    body.appendChild(emptyEl);
    return;
  }

  // 테이블 헤더
  const hdrEl = document.createElement('div');
  hdrEl.className = 'briefing-table-header';
  hdrEl.innerHTML = `<span>공정명</span><span>계획 시작</span><span>계획 종료</span><span>상태</span><span>상태 변경</span>`;
  body.appendChild(hdrEl);

  // 공정 행 생성 헬퍼
  const makeProcRow = (p, projId, extraClass = '') => {
    const isOverdue = p.plan_end && new Date(p.plan_end) < today && p.status !== '완료';
    const row = document.createElement('div');
    row.className = `briefing-proc-row${extraClass ? ' ' + extraClass : ''}`;
    row.innerHTML = `
      <span class="briefing-proc-name">${p.name}</span>
      <span class="briefing-proc-date">${p.plan_start || '-'}</span>
      <span class="briefing-proc-date${isOverdue ? ' overdue' : ''}">${p.plan_end || '-'}${isOverdue ? ' ⚠' : ''}</span>
      <span class="status-badge status-${p.status}">${p.status}</span>
      <select class="briefing-status-sel" data-id="${p.id}" data-proj="${projId}">
        <option value="대기"${p.status === '대기' ? ' selected' : ''}>대기</option>
        <option value="진행"${p.status === '진행' ? ' selected' : ''}>진행</option>
        <option value="완료"${p.status === '완료' ? ' selected' : ''}>완료</option>
      </select>`;
    row.querySelector('.briefing-status-sel').addEventListener('change', async (e) => {
      await window.api.updateProcess(p.id, { status: e.target.value });
      processCache[projId] = await window.api.getProcesses(projId);
      allProjects = await window.api.getProjects();
      renderBriefing();
      renderDashboard();
    });
    return row;
  };

  for (const item of groups) {
    const { proj } = item;
    const groupEl  = document.createElement('div');
    groupEl.className = 'briefing-group';

    // 프로젝트 헤더
    const projHdr = document.createElement('div');
    projHdr.className = 'briefing-group-header';
    const doneProjCnt = flatAll(item).filter(p => p.status === '완료').length;
    projHdr.innerHTML = `
      <span class="briefing-group-name">📁 ${proj.name}</span>
      <span class="briefing-group-cat">${getCategoryBreadcrumb(proj.category_id)}</span>
      <span class="briefing-group-count">${doneProjCnt}/${item.total}</span>
      <span class="briefing-group-arrow">▾</span>`;
    projHdr.addEventListener('click', () => groupEl.classList.toggle('collapsed'));
    groupEl.appendChild(projHdr);

    const procList = document.createElement('div');
    procList.className = 'briefing-proc-list';

    if (item.gunjin) {
      // 최상위 공정 (계약 등)
      item.topProcs.forEach(p => procList.appendChild(makeProcRow(p, proj.id)));

      // 공종별 그룹
      item.gunjinGroups.forEach(({ grp, children }) => {
        const grpEl  = document.createElement('div');
        grpEl.className = 'briefing-gunjin-group';

        const grpHdr = document.createElement('div');
        grpHdr.className = 'briefing-gunjin-header';
        const doneGrpCnt = children.filter(p => p.status === '완료').length;
        grpHdr.innerHTML = `
          <span class="briefing-gunjin-name">📂 ${grp.name}</span>
          <span class="briefing-gunjin-badge">${doneGrpCnt}/${children.length}</span>
          <span class="briefing-gunjin-arrow">▾</span>`;
        grpHdr.addEventListener('click', (e) => {
          e.stopPropagation();
          grpEl.classList.toggle('gunjin-collapsed');
        });
        grpEl.appendChild(grpHdr);
        children.forEach(p => grpEl.appendChild(makeProcRow(p, proj.id, 'briefing-proc-row-sub')));
        procList.appendChild(grpEl);
      });
    } else {
      item.procs.forEach(p => procList.appendChild(makeProcRow(p, proj.id)));
    }

    groupEl.appendChild(procList);
    body.appendChild(groupEl);
  }
}

document.getElementById('btnRefreshBriefing').addEventListener('click', renderBriefing);

// ═══════════════════════════════════════════════════════════
// 휴지통 (삭제된 프로젝트)
// ═══════════════════════════════════════════════════════════
async function renderTrash() {
  const deleted   = await window.api.getDeletedProjects();
  const container = document.getElementById('trash-container');
  if (deleted.length === 0) {
    container.innerHTML = '<div class="empty-state"><div class="empty-icon">🗑️</div><p>휴지통이 비어 있습니다.</p></div>';
    return;
  }
  container.innerHTML = deleted.map(p => `
    <div class="project-row" style="opacity:.7">
      <div class="row-name" style="color:var(--text-dim)">${p.name}</div>
      <div class="row-cat">${getCategoryBreadcrumb(p.category_id)}</div>
      <div class="row-prog" style="font-size:11px;color:var(--text-muted)">
        삭제일: ${new Date(p.updated_at).toLocaleDateString('ko-KR')}
      </div>
      <div class="row-actions">
        <button class="btn-secondary" style="font-size:11px;padding:5px 10px" data-restore="${p.id}">복구</button>
        <button class="btn-danger"    style="font-size:11px;padding:5px 10px" data-hard="${p.id}" data-name="${p.name}">영구삭제</button>
      </div>
    </div>
  `).join('');

  container.querySelectorAll('[data-restore]').forEach(btn => {
    btn.addEventListener('click', async () => {
      await window.api.restoreProject(btn.dataset.restore);
      allProjects = await window.api.getProjects();
      renderTrash();
      renderDashboard();
    });
  });

  container.querySelectorAll('[data-hard]').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (!confirm(`"${btn.dataset.name}" 프로젝트를 완전히 삭제할까요?\n이 작업은 되돌릴 수 없습니다.`)) return;
      await window.api.hardDeleteProject(btn.dataset.hard);
      allProjects = await window.api.getProjects();
      await preloadProcesses();
      renderTrash();
      renderDashboard();
    });
  });
}

function showToast(msg) {
  let toast = document.getElementById('toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'toast';
    document.body.appendChild(toast);
  }
  toast.textContent = msg;
  toast.style.opacity = '1';
  clearTimeout(toast._hideTimer);
  toast._hideTimer = setTimeout(() => { toast.style.opacity = '0'; }, 2500);
}

async function renderSettings() {
  const s = await window.api.getSettings();
  document.getElementById('set-briefingTime').value  = s.briefingTime   || '09:00';
  document.getElementById('set-alarmDays').value     = s.alarmDaysBefore ?? 7;
  document.getElementById('set-defaultView').value   = s.defaultView    || 'card';
  document.getElementById('set-autoStart').checked   = !!s.autoStart;

  // 테마 버튼 활성 상태
  document.querySelectorAll('.theme-btn').forEach(b =>
    b.classList.toggle('active', b.dataset.theme === (s.theme || 'dark'))
  );

  // 자동로그인 상태
  const autoLoginUser = s.autoLogin ? s.autoLoginUser : null;
  const desc = document.getElementById('autoLoginDesc');
  const btn  = document.getElementById('btnClearAutoLogin');
  if (autoLoginUser) {
    desc.textContent    = `사용 중 (${autoLoginUser})`;
    desc.style.color    = 'var(--accent)';
    btn.style.display   = '';
  } else {
    desc.textContent    = '사용 안 함';
    desc.style.color    = '';
    btn.style.display   = 'none';
  }

  renderCategoryTree();

  // AI 설정 로드
  try {
    const aiCfg = await window.api.getAiSettings();
    document.getElementById('set-aiWidgetEnabled').checked = aiCfg.aiWidgetEnabled !== false;
    document.getElementById('set-aiProvider').value        = aiCfg.aiProvider || 'claude';
    const keyEl = document.getElementById('set-aiApiKey');
    if (aiCfg.aiApiKey) {
      keyEl.value = aiCfg.aiApiKey;
      document.getElementById('aiKeyStatus').innerHTML =
        '<span style="color:var(--accent)">✅ API 키 저장됨</span>';
    } else {
      document.getElementById('aiKeyStatus').textContent = '키 미입력';
    }
  } catch(e) { /* AI 설정 없으면 기본값 유지 */ }
}

document.getElementById('btnClearAutoLogin').addEventListener('click', async () => {
  await window.api.clearAutoLogin();
  showToast('자동로그인이 해제되었습니다.');
  renderSettings();
});

document.getElementById('btnSaveSettings').addEventListener('click', async () => {
  await window.api.updateSettings({
    briefingTime:    document.getElementById('set-briefingTime').value,
    alarmDaysBefore: Number(document.getElementById('set-alarmDays').value),
    defaultView:     document.getElementById('set-defaultView').value,
    autoStart:       document.getElementById('set-autoStart').checked,
  });
  showToast('설정이 저장되었습니다.');
});

// AI 설정 — API 키 보기/숨기기 토글
document.getElementById('btnToggleApiKeyVis').addEventListener('click', () => {
  const inp = document.getElementById('set-aiApiKey');
  const btn = document.getElementById('btnToggleApiKeyVis');
  if (inp.type === 'password') {
    inp.type = 'text';
    btn.textContent = '🙈 숨기기';
  } else {
    inp.type = 'password';
    btn.textContent = '👁 보기';
  }
});

// AI 설정 저장
document.getElementById('btnSaveAiSettings').addEventListener('click', async () => {
  const provider  = document.getElementById('set-aiProvider').value;
  const apiKey    = document.getElementById('set-aiApiKey').value.trim();
  const enabled   = document.getElementById('set-aiWidgetEnabled').checked;

  await window.api.saveAiSettings({ aiProvider: provider, aiApiKey: apiKey, aiWidgetEnabled: enabled });

  const statusEl = document.getElementById('aiKeyStatus');
  if (apiKey) {
    statusEl.innerHTML = '<span style="color:var(--accent)">✅ API 키 저장됨</span>';
  } else {
    statusEl.textContent = '키 미입력';
  }
  showToast('AI 설정이 저장되었습니다.');

  // 위젯에게 설정 변경 알림
  if (window.api.notifyAiSettingsChanged) window.api.notifyAiSettingsChanged();
});

// ─── 분류 트리 ───────────────────────────────────────────────
function openCatDialog(parentId, level) {
  document.getElementById('dlgCatParentId').value = parentId || '';
  document.getElementById('dlgCatLevel').value    = level;
  document.getElementById('dlgCatName').value     = '';
  document.getElementById('catDialogTitle').textContent = level === 1 ? '대분류 추가' : '중분류 추가';
  openDialog('catDialog');
}

async function deleteCat(id) {
  if (!confirm('이 분류와 하위 분류를 삭제할까요?\n(연결된 프로젝트 데이터에는 영향 없음)')) return;
  await window.api.deleteCategory(id);
  allCategories = await window.api.getCategories();
  renderCategoryTree();
  populateCategoryFilters();
  showToast('분류가 삭제되었습니다.');
}

function renderCategoryTree() {
  const tree   = document.getElementById('catTree');
  if (!tree) return;
  const level1 = allCategories.filter(c => c.level === 1).sort((a,b) => a.order_index - b.order_index);

  if (level1.length === 0) {
    tree.innerHTML = '<div style="font-size:12px;color:var(--text-muted);padding:8px 4px">등록된 분류가 없습니다.</div>';
    return;
  }

  tree.innerHTML = level1.map(cat => {
    const children = allCategories.filter(c => c.parent_id === cat.id).sort((a,b) => a.order_index - b.order_index);
    return `
      <div class="cat-l1">
        <div class="cat-l1-header">
          <span class="cat-l1-name">▸ ${cat.name}</span>
          <button class="icon-btn btn-cat-add" data-parent="${cat.id}" title="중분류 추가">＋</button>
          <button class="icon-btn del btn-cat-del" data-id="${cat.id}" title="대분류 삭제">🗑</button>
        </div>
        <div class="cat-l2">
          ${children.map(c2 => `
            <div class="cat-l2-item">
              <span class="cat-l2-name">${c2.name}</span>
              <button class="icon-btn del btn-cat-del" data-id="${c2.id}" title="중분류 삭제">🗑</button>
            </div>
          `).join('')}
          <div class="cat-add-btn btn-cat-add" data-parent="${cat.id}">+ 중분류 추가</div>
        </div>
      </div>`;
  }).join('');

  // CSP 대응: onclick 대신 addEventListener 사용
  tree.querySelectorAll('.btn-cat-add').forEach(el => {
    el.addEventListener('click', () => openCatDialog(el.dataset.parent, 2));
  });
  tree.querySelectorAll('.btn-cat-del').forEach(el => {
    el.addEventListener('click', () => deleteCat(el.dataset.id));
  });
}

document.getElementById('btnAddCat1').addEventListener('click', () => openCatDialog(null, 1));

document.getElementById('btnCatDlgCancel').addEventListener('click', () => closeDialog('catDialog'));
document.getElementById('btnCatDlgSave').addEventListener('click', async () => {
  const name  = document.getElementById('dlgCatName').value.trim();
  if (!name)  { alert('분류명을 입력하세요.'); return; }
  const parentId = document.getElementById('dlgCatParentId').value || null;
  const level    = Number(document.getElementById('dlgCatLevel').value);
  await window.api.createCategory({ name, parent_id: parentId, level });
  allCategories = await window.api.getCategories();
  renderCategoryTree();
  populateCategoryFilters();
  closeDialog('catDialog');
  showToast(`"${name}" 분류가 추가되었습니다.`);
});

// ═══════════════════════════════════════════════════════════
// 다이얼로그 유틸
// ═══════════════════════════════════════════════════════════
function openDialog(id) {
  document.getElementById(id).classList.add('open');
  // 다이얼로그 내 첫 번째 text/textarea 입력란에 포커스
  setTimeout(() => {
    const first = document.querySelector(`#${id} input[type="text"], #${id} textarea`);
    if (first) first.focus();
  }, 50);
}
function closeDialog(id) { document.getElementById(id).classList.remove('open'); }

// 오버레이 클릭으로 닫기
['projectDialog', 'processDialog', 'catDialog'].forEach(id => {
  document.getElementById(id).addEventListener('click', (e) => {
    if (e.target === e.currentTarget) closeDialog(id);
  });
});

// ═══════════════════════════════════════════════════════════
// 메모 페이지 — 단기 작업 관리 (v3)
// ═══════════════════════════════════════════════════════════

// ── 상태 ────────────────────────────────────────────────────
let taskTab      = 'active';   // 'active' | 'done'
let taskPeriod   = 'daily';    // 'daily' | 'weekly' | 'monthly'
let taskPriority = '보통';     // 현재 선택된 우선순위

// 유형 → 아이콘 매핑
const TYPE_ICON = {
  '메일송부':  '📧', '자료검토': '📋', '자료요청': '📤',
  '보고서작성':'📄', '회의준비': '🗓', '전화/협의': '📞',
  '서명/결재': '✍', '기타':     '📌',
};

// ── 날짜 포맷 유틸 ──────────────────────────────────────────
function fmtTaskDT(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleString('ko-KR', {
    month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}
function fmtDateOnly(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return `${d.getMonth()+1}/${d.getDate()}`;
}
function isOverdue(due_date) {
  if (!due_date) return false;
  return new Date(due_date) < new Date(new Date().toDateString());
}

// ── 카드 HTML 생성 ──────────────────────────────────────────
function buildTaskCardHTML(task, isDone = false) {
  const icon = TYPE_ICON[task.type] || '📌';
  const overdue = !isDone && isOverdue(task.due_date);
  const dueText = task.due_date
    ? `<span class="task-due${overdue ? ' overdue' : ''}" title="처리 목표일">${overdue ? '⚠ ' : ''}${fmtDateOnly(task.due_date)} 까지</span>`
    : '';
  const doneText = isDone && task.done_at
    ? `<span class="task-meta">완료 ${fmtTaskDT(task.done_at)}</span>`
    : `<span class="task-meta">등록 ${fmtTaskDT(task.created_at)}</span>`;

  const actionBtns = isDone
    ? `<button class="btn-task-del" data-id="${task.id}" title="삭제">✕</button>`
    : `<button class="btn-task-complete" data-id="${task.id}">✅ 처리완료</button>
       <button class="btn-task-edit"    data-id="${task.id}">✏ 수정</button>
       <button class="btn-task-del"     data-id="${task.id}" title="삭제">✕</button>`;

  return `
    <div class="task-card priority-${task.priority}${isDone ? ' done-card' : ''}" data-id="${task.id}">
      <!-- 뷰 모드 -->
      <div class="task-view-mode">
        <div class="task-card-top">
          <div class="task-badges">
            <span class="task-badge-type">${icon} ${task.type || '기타'}</span>
            <span class="task-badge-priority p-${task.priority}">${task.priority || '보통'}</span>
          </div>
          <div class="task-content-text">${escapeHtml(task.content)}</div>
        </div>
        <div class="task-card-bottom">
          ${doneText}
          ${dueText}
          <div class="task-actions">${actionBtns}</div>
        </div>
      </div>
      <!-- 편집 모드 (초기 숨김) -->
      <div class="task-edit-form" style="display:none">
        <div class="task-edit-row">
          <input type="text" class="task-edit-input" value="">
          <select class="task-edit-select">
            ${Object.keys(TYPE_ICON).map(t =>
              `<option value="${t}"${t === task.type ? ' selected' : ''}>${TYPE_ICON[t]} ${t}</option>`
            ).join('')}
          </select>
        </div>
        <div class="task-edit-row">
          <div class="priority-group">
            <span class="priority-label">우선순위</span>
            <button type="button" class="priority-btn${task.priority==='긴급' ? ' active' : ''}" data-p="긴급">🔴 긴급</button>
            <button type="button" class="priority-btn${task.priority==='보통' ? ' active' : ''}" data-p="보통">🟡 보통</button>
            <button type="button" class="priority-btn${task.priority==='낮음' ? ' active' : ''}" data-p="낮음">🟢 낮음</button>
          </div>
          <input type="date" class="task-edit-select" style="flex:0;min-width:140px" value="${task.due_date || ''}">
        </div>
        <div class="task-edit-actions">
          <button class="btn-task-cancel" data-id="${task.id}">취소</button>
          <button class="btn-task-save"   data-id="${task.id}">저장</button>
        </div>
      </div>
    </div>`;
}

function escapeHtml(str) {
  return (str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ── 미완료 목록 렌더 ────────────────────────────────────────
async function renderTaskActive() {
  const tasks = await window.api.getQuickMemosActive();
  const list  = document.getElementById('taskActiveList');
  const badge = document.getElementById('activeTaskCount');
  if (!list) return;

  if (badge) badge.textContent = tasks.length;

  if (tasks.length === 0) {
    list.innerHTML = '<div class="empty-state"><div class="empty-icon">✅</div><p>처리할 작업이 없습니다.</p></div>';
    return;
  }

  list.innerHTML = tasks.map(t => buildTaskCardHTML(t, false)).join('');

  // 편집 모드에서 input value 설정 (XSS 방지)
  list.querySelectorAll('.task-card').forEach(card => {
    const task  = tasks.find(t => t.id === card.dataset.id);
    const input = card.querySelector('.task-edit-input');
    if (task && input) input.value = task.content;
  });

  // 처리완료 버튼
  list.querySelectorAll('.btn-task-complete').forEach(btn => {
    btn.addEventListener('click', async () => {
      await window.api.completeQuickMemo(btn.dataset.id);
      await renderTaskActive();
      // 완료 탭이 열려 있으면 갱신
      if (taskTab === 'done') await renderTaskDone();
      showToast('처리 완료로 이동했습니다.');
    });
  });

  // 삭제 버튼
  list.querySelectorAll('.btn-task-del').forEach(btn => {
    btn.addEventListener('click', async () => {
      await window.api.deleteQuickMemo(btn.dataset.id);
      await renderTaskActive();
      showToast('작업을 삭제했습니다.');
    });
  });

  // 수정 버튼 → 편집 모드 전환
  list.querySelectorAll('.btn-task-edit').forEach(btn => {
    btn.addEventListener('click', () => {
      const card = btn.closest('.task-card');
      card.querySelector('.task-view-mode').style.display = 'none';
      card.querySelector('.task-edit-form').style.display = 'flex';
      card.querySelector('.task-edit-input').focus();
    });
  });

  // 편집 모드: 우선순위 버튼
  list.querySelectorAll('.task-edit-form .priority-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const form = btn.closest('.task-edit-form');
      form.querySelectorAll('.priority-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
    });
  });

  // 취소 버튼
  list.querySelectorAll('.btn-task-cancel').forEach(btn => {
    btn.addEventListener('click', () => {
      const card = btn.closest('.task-card');
      card.querySelector('.task-view-mode').style.display = '';
      card.querySelector('.task-edit-form').style.display = 'none';
    });
  });

  // 저장 버튼
  list.querySelectorAll('.btn-task-save').forEach(btn => {
    btn.addEventListener('click', async () => {
      const card    = btn.closest('.task-card');
      const content = card.querySelector('.task-edit-input').value.trim();
      if (!content) return;
      const type     = card.querySelector('.task-edit-select').value;
      const priority = card.querySelector('.priority-btn.active')?.dataset.p || '보통';
      const due_date = card.querySelectorAll('.task-edit-select')[1]?.value || null;
      await window.api.updateQuickMemo(btn.dataset.id, { content, type, priority, due_date: due_date || null });
      await renderTaskActive();
      showToast('작업을 수정했습니다.');
    });
  });
}

// ── 완료 이력 렌더 ──────────────────────────────────────────
async function renderTaskDone() {
  const tasks   = await window.api.getQuickMemosDonePeriod(taskPeriod);
  const list    = document.getElementById('taskDoneList');
  const stats   = document.getElementById('doneStatsText');
  if (!list) return;

  const periodLabel = { daily: '오늘', weekly: '이번 주', monthly: '이번 달' }[taskPeriod];
  if (stats) stats.textContent = `${periodLabel} 완료 ${tasks.length}건`;

  if (tasks.length === 0) {
    list.innerHTML = `<div class="empty-state"><div class="empty-icon">📋</div><p>${periodLabel} 완료된 작업이 없습니다.</p></div>`;
    return;
  }

  // 날짜별 그룹핑 (월간/주간 시 날짜 구분선 표시)
  if (taskPeriod === 'daily') {
    list.innerHTML = tasks.map(t => buildTaskCardHTML(t, true)).join('');
  } else {
    const groups = {};
    tasks.forEach(t => {
      const key = new Date(t.done_at).toLocaleDateString('ko-KR', { month: 'long', day: 'numeric', weekday: 'short' });
      if (!groups[key]) groups[key] = [];
      groups[key].push(t);
    });
    list.innerHTML = Object.entries(groups).map(([date, items]) => `
      <div class="done-date-group-label">${date} · ${items.length}건</div>
      ${items.map(t => buildTaskCardHTML(t, true)).join('')}
    `).join('');
  }

  // 완료 탭 삭제 버튼
  list.querySelectorAll('.btn-task-del').forEach(btn => {
    btn.addEventListener('click', async () => {
      await window.api.deleteQuickMemo(btn.dataset.id);
      await renderTaskDone();
      showToast('작업 이력을 삭제했습니다.');
    });
  });
}

// ── 메모 페이지 전체 렌더 ───────────────────────────────────
async function renderMemoPage() {
  await renderTaskActive();
  if (taskTab === 'done') await renderTaskDone();
}

// ── 등록 버튼 ───────────────────────────────────────────────
document.getElementById('btnAddTask').addEventListener('click', async () => {
  const content = document.getElementById('taskTitleInput').value.trim();
  if (!content) { showToast('작업 내용을 입력해주세요.'); return; }
  const type    = document.getElementById('taskTypeSelect').value;
  const due_date= document.getElementById('taskDueDate').value || null;
  await window.api.createQuickMemo({ content, type, priority: taskPriority, due_date });
  document.getElementById('taskTitleInput').value = '';
  document.getElementById('taskDueDate').value = '';
  await renderTaskActive();
  showToast('작업이 등록되었습니다.');
});

// Enter: 줄바꿈 (기본 동작) / Ctrl+Enter: 등록
document.getElementById('taskTitleInput').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
    e.preventDefault();
    document.getElementById('btnAddTask').click();
  }
});

// ── 우선순위 버튼 (입력 폼) ─────────────────────────────────
document.querySelectorAll('.task-input-panel .priority-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.task-input-panel .priority-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    taskPriority = btn.dataset.p;
  });
});

// ── 탭 전환 ─────────────────────────────────────────────────
document.querySelectorAll('.task-tab').forEach(tab => {
  tab.addEventListener('click', async () => {
    document.querySelectorAll('.task-tab').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    taskTab = tab.dataset.tab;
    document.getElementById('panel-active').style.display = taskTab === 'active' ? '' : 'none';
    document.getElementById('panel-done').style.display   = taskTab === 'done'   ? '' : 'none';
    if (taskTab === 'done') await renderTaskDone();
  });
});

// ── 기간 필터 버튼 ──────────────────────────────────────────
document.querySelectorAll('.period-btn').forEach(btn => {
  btn.addEventListener('click', async () => {
    document.querySelectorAll('.period-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    taskPeriod = btn.dataset.period;
    await renderTaskDone();
  });
});

// ═══════════════════════════════════════════════════════════
// 완료업무 페이지
// ═══════════════════════════════════════════════════════════

// 기간 버튼 활성 상태 표시
function setQuickDateActive(period) {
  document.getElementById('btnWeekRange')?.classList.toggle('active', period === 'week');
  document.getElementById('btnMonthRange')?.classList.toggle('active', period === 'month');
}

function matchCompletedFilter(p, proj, searchVal, dateFrom, dateTo, grp = null) {
  if (searchVal) {
    const inProj = proj.name.toLowerCase().includes(searchVal);
    const inProc = p.name.toLowerCase().includes(searchVal);
    const inGrp  = grp ? grp.name.toLowerCase().includes(searchVal) : false;
    if (!inProj && !inProc && !inGrp) return false;
  }
  if (dateFrom && p.actual_end && p.actual_end < dateFrom) return false;
  if (dateTo   && p.actual_end && p.actual_end > dateTo)   return false;
  return true;
}

async function renderCompletedWork() {
  const area      = document.getElementById('completedArea');
  const searchVal = (document.getElementById('completedSearch')?.value || '').toLowerCase().trim();
  const dateFrom  = document.getElementById('completedDateFrom')?.value || '';
  const dateTo    = document.getElementById('completedDateTo')?.value   || '';

  area.innerHTML = '<div class="empty-state"><div class="empty-icon">⏳</div><p>불러오는 중...</p></div>';

  const groups = [];
  for (const proj of allProjects) {
    const procs  = processCache[proj.id] || await window.api.getProcesses(proj.id);
    processCache[proj.id] = procs;
    const gunjin = isGunjinProject(proj.id);

    if (gunjin) {
      const topCompleted = procs
        .filter(p => !p.is_group && !p.parent_id && p.status === '완료')
        .filter(p => matchCompletedFilter(p, proj, searchVal, dateFrom, dateTo));
      const gunjinGroups = [];
      for (const grp of procs.filter(p => p.is_group)) {
        const children = procs
          .filter(p => p.parent_id === grp.id && p.status === '완료')
          .filter(p => matchCompletedFilter(p, proj, searchVal, dateFrom, dateTo, grp));
        if (children.length > 0) gunjinGroups.push({ grp, children });
      }
      const total = topCompleted.length + gunjinGroups.reduce((s, g) => s + g.children.length, 0);
      if (total > 0) groups.push({ proj, gunjin: true, gunjinGroups, topCompleted, total });
    } else {
      const completed = procs.filter(p =>
        p.status === '완료' && matchCompletedFilter(p, proj, searchVal, dateFrom, dateTo)
      );
      if (completed.length > 0) groups.push({ proj, gunjin: false, completed, total: completed.length });
    }
  }

  area.innerHTML = '';

  // ── 요약 바
  const totalProcs = groups.reduce((s, g) => s + g.total, 0);
  const summEl = document.createElement('div');
  summEl.className = 'briefing-summary-bar';
  summEl.innerHTML = `
    <div class="briefing-summary-item">
      <span class="briefing-summary-num">${groups.length}</span><span>개 프로젝트</span>
    </div>
    <span class="briefing-summary-sep">|</span>
    <div class="briefing-summary-item">
      <span class="briefing-summary-num" style="color:var(--status-done-fg)">${totalProcs}</span>
      <span>건 완료</span>
    </div>`;
  area.appendChild(summEl);

  if (groups.length === 0) {
    const emptyEl = document.createElement('div');
    emptyEl.className = 'briefing-empty';
    emptyEl.innerHTML = `<div class="briefing-empty-icon">📋</div><p>조건에 맞는 완료 업무가 없습니다.</p>`;
    area.appendChild(emptyEl);
    return;
  }

  // ── 테이블 헤더
  const hdrEl = document.createElement('div');
  hdrEl.className = 'completed-table-header';
  hdrEl.innerHTML = `<span>공정명</span><span>계획 기간</span><span>완료일</span><span>분류</span>`;
  area.appendChild(hdrEl);

  // ── 프로젝트 그룹 렌더
  for (const item of groups) {
    const { proj } = item;
    const groupEl = document.createElement('div');
    groupEl.className = 'completed-group';

    // 프로젝트 헤더 (접기/펼치기)
    const hdr = document.createElement('div');
    hdr.className = 'completed-group-header';
    hdr.innerHTML = `
      <span class="completed-group-name">📁 ${escapeHtml(proj.name)}</span>
      <span class="completed-group-cat">${getCategoryBreadcrumb(proj.category_id)}</span>
      <span class="completed-group-badge">${item.total}건 완료</span>
      <span class="completed-group-arrow">▾</span>`;
    hdr.addEventListener('click', () => groupEl.classList.toggle('collapsed'));
    groupEl.appendChild(hdr);

    const procList = document.createElement('div');
    procList.className = 'completed-proc-list';

    if (item.gunjin) {
      // 최상위 공정 (계약 등)
      item.topCompleted.forEach(p => procList.appendChild(makeCompletedProcRow(p, proj)));
      // 건진법 공종 그룹
      item.gunjinGroups.forEach(({ grp, children }) => {
        const grpEl = document.createElement('div');
        grpEl.className = 'completed-gunjin-group';
        const grpHdr = document.createElement('div');
        grpHdr.className = 'completed-gunjin-header';
        grpHdr.innerHTML = `
          <span class="completed-gunjin-name">📂 ${escapeHtml(grp.name)}</span>
          <span class="completed-gunjin-badge">${children.length}건</span>
          <span class="completed-gunjin-arrow">▾</span>`;
        grpHdr.addEventListener('click', (e) => {
          e.stopPropagation();
          grpEl.classList.toggle('gunjin-collapsed');
        });
        grpEl.appendChild(grpHdr);
        children.forEach(p => {
          const row = makeCompletedProcRow(p, proj);
          row.classList.add('completed-proc-row-sub');
          grpEl.appendChild(row);
        });
        procList.appendChild(grpEl);
      });
    } else {
      item.completed.forEach(p => procList.appendChild(makeCompletedProcRow(p, proj)));
    }

    groupEl.appendChild(procList);
    area.appendChild(groupEl);
  }
}

// 공정 행 빌더 (공정명 | 계획기간 | 완료일 | 분류)
function makeCompletedProcRow(p, proj) {
  const row = document.createElement('div');
  row.className = 'completed-proc-row';

  const planStr = p.plan_start
    ? (p.plan_end && p.plan_end !== p.plan_start
        ? `${fmtDateOnly(p.plan_start)} ~ ${fmtDateOnly(p.plan_end)}`
        : fmtDateOnly(p.plan_start))
    : '-';
  const doneStr = p.actual_end
    ? new Date(p.actual_end).toLocaleDateString('ko-KR', { month: 'numeric', day: 'numeric' })
    : (p.actual_start
        ? new Date(p.actual_start).toLocaleDateString('ko-KR', { month: 'numeric', day: 'numeric' })
        : '-');
  const catParts = getCategoryBreadcrumb(proj.category_id).split(' › ');
  const catShort = catParts[catParts.length - 1] || '-';

  row.innerHTML = `
    <span class="completed-proc-name">${escapeHtml(p.name)}</span>
    <span class="completed-proc-date">${planStr}</span>
    <span class="completed-proc-date">${doneStr}</span>
    <span class="completed-proc-cat">${escapeHtml(catShort)}</span>`;
  return row;
}

// ─── 완료업무 이벤트 리스너 ────────────────────────────────
['completedSearch','completedDateFrom','completedDateTo'].forEach(id => {
  document.getElementById(id)?.addEventListener('input', () => {
    setQuickDateActive(null); // 직접 입력 시 버튼 활성 해제
    renderCompletedWork();
  });
});
document.getElementById('btnWeekRange')?.addEventListener('click', () => {
  const today = new Date();
  const mon   = getWeekMonday(today, 0);
  const sun   = addDays(mon, 6);
  document.getElementById('completedDateFrom').value = fmtISO(mon);
  document.getElementById('completedDateTo').value   = fmtISO(sun);
  setQuickDateActive('week');
  renderCompletedWork();
});
document.getElementById('btnMonthRange')?.addEventListener('click', () => {
  const today = new Date();
  const first = new Date(today.getFullYear(), today.getMonth(), 1);
  const last  = new Date(today.getFullYear(), today.getMonth() + 1, 0);
  document.getElementById('completedDateFrom').value = fmtISO(first);
  document.getElementById('completedDateTo').value   = fmtISO(last);
  setQuickDateActive('month');
  renderCompletedWork();
});
document.getElementById('btnClearCompleted')?.addEventListener('click', () => {
  document.getElementById('completedSearch').value   = '';
  document.getElementById('completedDateFrom').value = '';
  document.getElementById('completedDateTo').value   = '';
  setQuickDateActive(null);
  renderCompletedWork();
});

// ═══════════════════════════════════════════════════════════
// Cloud Sync (Supabase) 설정 UI
// ═══════════════════════════════════════════════════════════
(function setupCloudSync() {
  const badge       = document.getElementById('cloudStatusBadge');
  const dot         = document.getElementById('cloudStatusDot');
  const statusText  = document.getElementById('cloudStatusText');
  const formArea    = document.getElementById('cloudFormArea');
  const connArea    = document.getElementById('cloudConnectedArea');
  const authStatus  = document.getElementById('cloudAuthStatus');
  const migrResult  = document.getElementById('cloudMigrateResult');

  // ── 상태 UI 갱신 ────────────────────────────────────────
  function setConnected(email) {
    badge.textContent = '연결됨';
    badge.classList.add('connected');
    dot.className = 'cloud-status-dot ok';
    statusText.textContent = `${email || ''} 로그인됨 · 자동 동기화 활성`;
    formArea.style.display  = 'none';
    connArea.style.display  = '';
  }
  function setDisconnected(msg) {
    badge.textContent = '미연결';
    badge.classList.remove('connected');
    dot.className = 'cloud-status-dot';
    statusText.textContent = msg || 'Supabase에 연결되어 있지 않습니다.';
    formArea.style.display  = '';
    connArea.style.display  = 'none';
  }
  function setBusy(msg) {
    dot.className = 'cloud-status-dot busy';
    statusText.textContent = msg;
  }

  // ── 저장된 설정으로 상태 복원 ───────────────────────────
  async function refreshStatus() {
    try {
      const s = await window.api.getSettings();
      // URL·Key 입력란 복원
      if (s.supabaseUrl)      document.getElementById('cloud-url').value      = s.supabaseUrl;
      if (s.supabaseAnonKey)  document.getElementById('cloud-anon-key').value = '••••••••';
      if (s.supabaseEmail)    document.getElementById('cloud-email').value     = s.supabaseEmail;

      const status = await window.api.cloudGetStatus();
      if (status.authenticated && status.syncEnabled) {
        setConnected(s.supabaseEmail);
      } else {
        setDisconnected();
      }
    } catch(e) {
      setDisconnected();
    }
  }

  // 설정 탭 진입 시마다 상태 갱신
  const origNavigateTo = window.navigateToHook;
  document.querySelectorAll('.nav-item').forEach(item => {
    item.addEventListener('click', () => {
      if (item.dataset.page === 'settings') setTimeout(refreshStatus, 100);
    });
  });

  // ── 로그인 버튼 ─────────────────────────────────────────
  document.getElementById('btnCloudConnect').addEventListener('click', async () => {
    const url      = document.getElementById('cloud-url').value.trim();
    const anonKey  = document.getElementById('cloud-anon-key').value.trim();
    const email    = document.getElementById('cloud-email').value.trim();
    const password = document.getElementById('cloud-password').value;

    if (!url || !anonKey || !email || !password) {
      authStatus.innerHTML = '<span style="color:#dc2626">모든 항목을 입력해주세요.</span>';
      return;
    }
    authStatus.innerHTML = '⏳ 연결 중...';
    setBusy('로그인 중...');
    try {
      await window.api.cloudConnect({ url, anonKey, email, password });
      authStatus.innerHTML = '';
      setConnected(email);
      showToast('☁ Supabase 연결 완료!');
    } catch(e) {
      authStatus.innerHTML = `<span style="color:#dc2626">❌ ${e.message}</span>`;
      setDisconnected();
    }
  });

  // ── 신규 가입 버튼 ───────────────────────────────────────
  document.getElementById('btnCloudSignUp').addEventListener('click', async () => {
    const url      = document.getElementById('cloud-url').value.trim();
    const anonKey  = document.getElementById('cloud-anon-key').value.trim();
    const email    = document.getElementById('cloud-email').value.trim();
    const password = document.getElementById('cloud-password').value;

    if (!url || !anonKey || !email || !password) {
      authStatus.innerHTML = '<span style="color:#dc2626">모든 항목을 입력해주세요.</span>';
      return;
    }
    if (password.length < 6) {
      authStatus.innerHTML = '<span style="color:#dc2626">비밀번호는 6자 이상이어야 합니다.</span>';
      return;
    }
    authStatus.innerHTML = '⏳ 계정 생성 중...';
    setBusy('계정 생성 중...');
    try {
      await window.api.cloudSignUp({ url, anonKey, email, password });
      authStatus.innerHTML = '<span style="color:var(--accent)">✅ 가입 완료! 이메일 인증 후 로그인해주세요.</span>';
      setDisconnected('가입 완료. 이메일 인증 후 로그인하세요.');
    } catch(e) {
      authStatus.innerHTML = `<span style="color:#dc2626">❌ ${e.message}</span>`;
      setDisconnected();
    }
  });

  // ── 데이터 업로드 버튼 ───────────────────────────────────
  document.getElementById('btnCloudMigrate').addEventListener('click', async () => {
    const btn = document.getElementById('btnCloudMigrate');
    btn.disabled = true;
    btn.textContent = '업로드 중...';
    migrResult.textContent = '';
    setBusy('데이터 업로드 중...');
    try {
      const result = await window.api.cloudMigrate();
      migrResult.innerHTML =
        `✅ 업로드 완료 — 프로젝트 ${result.projects}건 · 공정 ${result.processes}건 · ` +
        `메모 ${result.memos}건 · 단기작업 ${result.quickMemos}건`;
      setConnected(document.getElementById('cloud-email').value || '');
      showToast('☁ 데이터 업로드 완료!');
    } catch(e) {
      migrResult.innerHTML = `<span style="color:#dc2626">❌ ${e.message}</span>`;
      dot.className = 'cloud-status-dot err';
      statusText.textContent = '업로드 중 오류 발생';
    } finally {
      btn.disabled = false;
      btn.textContent = '데이터 업로드';
    }
  });

  // ── 클라우드 → 로컬 데이터 가져오기 버튼 ─────────────────
  document.getElementById('btnCloudPull').addEventListener('click', async () => {
    const btn        = document.getElementById('btnCloudPull');
    const pullResult = document.getElementById('cloudPullResult');
    if (!confirm('클라우드의 데이터를 이 PC로 가져옵니다.\n기존 로컬 데이터와 병합됩니다. 계속하시겠습니까?')) return;
    btn.disabled = true;
    btn.textContent = '불러오는 중...';
    pullResult.textContent = '';
    setBusy('클라우드에서 데이터 가져오는 중...');
    try {
      const result = await window.api.cloudPull();
      pullResult.innerHTML =
        `✅ 가져오기 완료 — 프로젝트 ${result.projects}건 · 공정 ${result.processes}건 · ` +
        `메모 ${result.memos}건 · 단기작업 ${result.quickMemos}건`;
      setConnected(document.getElementById('cloud-email')?.value || '');
      showToast('☁ 클라우드 데이터 가져오기 완료! 새로고침합니다...');
      // 데이터 갱신 후 대시보드 리로드
      setTimeout(() => {
        allProjects = [];
        loadAll();
      }, 1200);
    } catch(e) {
      pullResult.innerHTML = `<span style="color:#dc2626">❌ ${e.message}</span>`;
    } finally {
      btn.disabled = false;
      btn.textContent = '데이터 가져오기';
    }
  });

  // ── 연결 해제 버튼 ───────────────────────────────────────
  document.getElementById('btnCloudDisconnect').addEventListener('click', async () => {
    await window.api.cloudSignOut();
    setDisconnected();
    showToast('Cloud Sync 연결이 해제되었습니다.');
  });

  // 초기 상태 확인
  refreshStatus();
})();

// ═══════════════════════════════════════════════════════════
// Phase C — 알림 센터
// ═══════════════════════════════════════════════════════════
(function setupNotifications() {
  const badge    = document.getElementById('notifBadge');
  const bell     = document.getElementById('btnNotifBell');
  const dropdown = document.getElementById('notifDropdown');
  const overlay  = document.getElementById('notifOverlay');
  const list     = document.getElementById('notifList');

  function typeLabel(type) {
    return { overdue:'지연', d0:'오늘마감', d1:'D-1', d3:'D-3' }[type] || type;
  }
  function timeFmt(iso) {
    const d = new Date(iso);
    return d.toLocaleString('ko-KR', { month:'numeric', day:'numeric', hour:'2-digit', minute:'2-digit' });
  }

  async function refreshBadge() {
    try {
      const count = await window.api.getNotifUnread();
      badge.textContent = count > 9 ? '9+' : count;
      badge.style.display = count > 0 ? '' : 'none';
    } catch(e) {}
  }

  async function renderNotifList() {
    try {
      const notifs = await window.api.getNotifications();
      if (!notifs.length) {
        list.innerHTML = '<div class="notif-empty">새 알림이 없습니다.</div>';
        return;
      }
      list.innerHTML = notifs.slice(0, 30).map(n => `
        <div class="notif-item${n.is_read ? '' : ' unread'}" data-id="${n.id}" data-proj="${n.project_id}">
          <div class="notif-item-title notif-type-${n.type}">${typeLabel(n.type)} — ${escapeHtml(n.project_name)}</div>
          <div class="notif-item-body">${escapeHtml(n.process_name)} · 마감 ${n.plan_end || '-'}</div>
          <div class="notif-item-time">${timeFmt(n.created_at)}</div>
        </div>`).join('');
      list.querySelectorAll('.notif-item[data-proj]').forEach(el => {
        el.addEventListener('click', () => {
          openProjectModal(el.dataset.proj);
          closeDropdown();
        });
      });
    } catch(e) {}
  }

  function openDropdown()  { dropdown.style.display = ''; overlay.style.display = ''; renderNotifList(); }
  function closeDropdown() { dropdown.style.display = 'none'; overlay.style.display = 'none'; }

  bell.addEventListener('click', async () => {
    if (dropdown.style.display === 'none') {
      openDropdown();
      await window.api.markNotifsRead();
      refreshBadge();
    } else {
      closeDropdown();
    }
  });
  overlay.addEventListener('click', closeDropdown);

  document.getElementById('btnMarkAllRead').addEventListener('click', async () => {
    await window.api.markNotifsRead();
    refreshBadge();
    renderNotifList();
  });
  document.getElementById('btnClearNotifs').addEventListener('click', async () => {
    await window.api.clearNotifications();
    refreshBadge();
    renderNotifList();
  });

  // 메인 프로세스에서 새 알림 발생 시 뱃지 업데이트
  if (window.api.onNotifUpdate) {
    window.api.onNotifUpdate((count) => {
      badge.textContent = count > 9 ? '9+' : count;
      badge.style.display = count > 0 ? '' : 'none';
    });
  }

  // 초기 로드
  refreshBadge();
})();

// ═══════════════════════════════════════════════════════════
// Phase D — 변경 이력 타임라인
// ═══════════════════════════════════════════════════════════
async function renderHistory() {
  const body = document.getElementById('historyBody');
  const search = (document.getElementById('historySearch')?.value || '').toLowerCase().trim();
  const filter = document.getElementById('historyFilter')?.value || '';
  body.innerHTML = '<div class="history-empty">불러오는 중...</div>';

  const ACTION_LABEL = {
    create:'등록', update:'수정', delete:'삭제', restore:'복구',
    status_change:'상태변경', date_change:'날짜변경', hard_delete:'영구삭제',
  };
  const DATE_FIELD_LABEL = {
    plan_start:'계획시작', plan_end:'계획종료', actual_start:'실시시작', actual_end:'실시종료',
  };

  let logs = await window.api.getChangeLogs();
  if (filter)  logs = logs.filter(l => l.action === filter);
  if (search)  logs = logs.filter(l =>
    (l.target_name||'').toLowerCase().includes(search) ||
    (l.new_value||'').toLowerCase().includes(search)
  );

  body.innerHTML = '';
  if (!logs.length) {
    body.innerHTML = '<div class="history-empty"><div style="font-size:32px;opacity:.3">📜</div><p>변경 이력이 없습니다.</p></div>';
    return;
  }

  // 날짜별 그룹핑
  const groups = {};
  logs.forEach(l => {
    const key = new Date(l.created_at).toLocaleDateString('ko-KR', { year:'numeric', month:'long', day:'numeric', weekday:'short' });
    if (!groups[key]) groups[key] = [];
    groups[key].push(l);
  });

  Object.entries(groups).forEach(([date, items]) => {
    const grp = document.createElement('div');
    grp.className = 'history-date-group';
    grp.innerHTML = `<div class="history-date-label">${date} · ${items.length}건</div>`;

    items.forEach((l, idx) => {
      const isLast  = idx === items.length - 1;
      const timeStr = new Date(l.created_at).toLocaleTimeString('ko-KR', { hour:'2-digit', minute:'2-digit' });

      // 프로젝트 - 공정 표기
      const isProcess  = l.target_type === 'process';
      const projLabel  = escapeHtml(l.project_name || '-');
      const procLabel  = isProcess ? escapeHtml(l.target_name || '') : '';
      const nameHTML   = isProcess
        ? `<span class="history-proj-label">${projLabel}</span><span class="history-name-sep"> › </span><span class="history-target-name">${procLabel}</span>`
        : `<span class="history-target-name">${projLabel}</span>`;

      // 변경 전 → 변경 후 표기
      let detail = '';
      if (l.action === 'status_change') {
        detail = `<span class="history-before">${escapeHtml(l.old_value||'')}</span> → <span class="history-after">${escapeHtml(l.new_value||'')}</span>`;
      } else if (l.action === 'date_change') {
        const fLabel = DATE_FIELD_LABEL[l.field_changed] || l.field_changed;
        detail = `${fLabel}: <span class="history-before">${escapeHtml(l.old_value||'')}</span> → <span class="history-after">${escapeHtml(l.new_value||'')}</span>`;
      }

      const item = document.createElement('div');
      item.className = 'history-item';
      item.innerHTML = `
        <div class="history-dot-col">
          <div class="history-dot action-${l.action}"></div>
          ${!isLast ? '<div class="history-dot-line"></div>' : ''}
        </div>
        <div class="history-content">
          <div style="display:flex;align-items:center;flex-wrap:wrap;gap:4px">
            <span class="history-action-badge action-${l.action}">${ACTION_LABEL[l.action]||l.action}</span>
            ${nameHTML}
          </div>
          ${detail ? `<div class="history-detail">${detail}</div>` : ''}
          <div class="history-time">${timeStr} · ${isProcess ? '공정' : '프로젝트'}</div>
        </div>`;
      grp.appendChild(item);
    });
    body.appendChild(grp);
  });
}

document.getElementById('historySearch')?.addEventListener('input', renderHistory);
document.getElementById('historyFilter')?.addEventListener('change', renderHistory);
document.getElementById('btnRefreshHistory')?.addEventListener('click', renderHistory);

// ═══════════════════════════════════════════════════════════
// Phase E — 주간 리포트
// ═══════════════════════════════════════════════════════════
async function renderReport() {
  const body      = document.getElementById('reportBody');
  const today     = new Date();
  const dow       = today.getDay();
  const weekStart = new Date(today); weekStart.setDate(today.getDate() - ((dow+6)%7)); weekStart.setHours(0,0,0,0);
  const weekEnd   = new Date(weekStart); weekEnd.setDate(weekStart.getDate() + 6); weekEnd.setHours(23,59,59,999);
  const nextStart = new Date(weekStart); nextStart.setDate(weekStart.getDate() + 7);
  const nextEnd   = new Date(nextStart);  nextEnd.setDate(nextStart.getDate() + 6); nextEnd.setHours(23,59,59,999);

  const fmt  = d => `${d.getMonth()+1}/${d.getDate()}`;
  const fmtD = iso => iso ? (() => { const [,m,d] = iso.split('-'); return `${Number(m)}/${Number(d)}`; })() : '-';

  const activeProjs = allProjects.filter(p => p.status !== '완료' && p.status !== '청구완료');
  const allProcs = [];
  for (const p of activeProjs) {
    const procs = processCache[p.id] || await window.api.getProcesses(p.id);
    procs.filter(pr => !pr.is_group).forEach(pr => allProcs.push({ ...pr, projName: p.name, projId: p.id }));
  }

  const inRange  = (pr, s, e) => { const ps = pr.plan_start||pr.actual_start; if (!ps) return false; const pe = pr.plan_end||pr.actual_end||ps; return new Date(ps)<=e && new Date(pe)>=s; };
  const isOvd    = pr => pr.plan_end && new Date(pr.plan_end) < today && pr.status !== '완료';
  const thisWeek = allProcs.filter(pr => inRange(pr, weekStart, weekEnd));
  const nextWeek = allProcs.filter(pr => inRange(pr, nextStart, nextEnd));
  const overdue  = allProcs.filter(isOvd);
  const doneThis = allProcs.filter(pr => pr.status==='완료' && pr.actual_end && new Date(pr.actual_end)>=weekStart && new Date(pr.actual_end)<=weekEnd);

  body.innerHTML = '';

  // ── 헬퍼: 섹션 빌더 (접기/펼치기 포함) ──────────────────────
  function buildSection(icon, title, contentEl, defaultOpen = true) {
    const sec = document.createElement('div');
    sec.className = 'report-section';
    const hdr = document.createElement('div');
    hdr.className = 'report-section-title report-section-toggle';
    hdr.innerHTML = `${icon} ${title} <span class="report-toggle-arrow">${defaultOpen ? '▾' : '▸'}</span>`;
    const body = document.createElement('div');
    body.className = 'report-section-body';
    if (!defaultOpen) body.style.display = 'none';
    hdr.addEventListener('click', () => {
      const open = body.style.display !== 'none';
      body.style.display = open ? 'none' : '';
      hdr.querySelector('.report-toggle-arrow').textContent = open ? '▸' : '▾';
    });
    sec.appendChild(hdr);
    sec.appendChild(body);
    if (contentEl) body.appendChild(contentEl);
    return sec;
  }

  // ── 헬퍼: 프로젝트별 그룹 테이블 ────────────────────────────
  function buildGroupedTable(procs, cols) {
    // {header:[...], row: fn(pr)=>tr}
    const wrap = document.createElement('div');
    const byProj = {};
    procs.forEach(pr => {
      if (!byProj[pr.projId]) byProj[pr.projId] = { name: pr.projName, procs: [] };
      byProj[pr.projId].procs.push(pr);
    });
    Object.values(byProj).forEach(({ name, procs: plist }) => {
      const projHdr = document.createElement('div');
      projHdr.className = 'report-proj-header';
      projHdr.innerHTML = `📁 ${escapeHtml(name)} <span style="font-size:10px;color:var(--text-muted);margin-left:6px">${plist.length}건</span>`;
      wrap.appendChild(projHdr);
      const tbl = document.createElement('table');
      tbl.className = 'report-table';
      tbl.innerHTML = `<thead><tr>${cols.headers.map(h=>`<th>${h}</th>`).join('')}</tr></thead><tbody>${plist.map(cols.row).join('')}</tbody>`;
      wrap.appendChild(tbl);
    });
    return wrap;
  }

  // ── 요약 섹션 ────────────────────────────────────────────────
  const summDiv = document.createElement('div');
  summDiv.innerHTML = `
    <div style="font-size:11px;color:var(--text-sec);margin-bottom:12px">
      생성일: ${today.toLocaleDateString('ko-KR', { year:'numeric', month:'long', day:'numeric', weekday:'short' })}
      &nbsp;|&nbsp; 이번주: ${fmt(weekStart)} ~ ${fmt(weekEnd)}
      &nbsp;|&nbsp; 다음주: ${fmt(nextStart)} ~ ${fmt(nextEnd)}
    </div>
    <div class="report-summary-row">
      <div class="report-stat"><div class="report-stat-num">${allProjects.length}</div><div class="report-stat-label">전체 프로젝트</div></div>
      <div class="report-stat"><div class="report-stat-num">${allProjects.filter(p=>p.status==='진행중').length}</div><div class="report-stat-label">진행중</div></div>
      <div class="report-stat"><div class="report-stat-num" style="color:#f59e0b">${overdue.length}</div><div class="report-stat-label">지연 공정</div></div>
      <div class="report-stat"><div class="report-stat-num" style="color:#16a34a">${doneThis.length}</div><div class="report-stat-label">이번주 완료</div></div>
    </div>`;
  body.appendChild(buildSection('📋', '전체 현황 요약', summDiv, true));

  // ── 이번주 일정 ──────────────────────────────────────────────
  if (thisWeek.length) {
    const tbl = buildGroupedTable(thisWeek, {
      headers: ['공정명', '계획기간', '상태'],
      row: pr => `<tr>
        <td>${escapeHtml(pr.name)}</td>
        <td>${fmtD(pr.plan_start)}${pr.plan_end && pr.plan_end !== pr.plan_start ? ' ~ '+fmtD(pr.plan_end) : ''}</td>
        <td><span class="status-badge status-${pr.status}">${pr.status}</span></td>
      </tr>`,
    });
    body.appendChild(buildSection('📅', `이번주 일정  ${fmt(weekStart)} ~ ${fmt(weekEnd)}`, tbl, true));
  }

  // ── 이번주 완료 ──────────────────────────────────────────────
  if (doneThis.length) {
    const tbl = buildGroupedTable(doneThis, {
      headers: ['공정명', '계획기간', '완료일'],
      row: pr => `<tr>
        <td>${escapeHtml(pr.name)}</td>
        <td>${fmtD(pr.plan_start)} ~ ${fmtD(pr.plan_end)}</td>
        <td>${fmtD(pr.actual_end)}</td>
      </tr>`,
    });
    body.appendChild(buildSection('✅', `이번주 완료  ${doneThis.length}건`, tbl, true));
  }

  // ── 다음주 예정 ──────────────────────────────────────────────
  if (nextWeek.length) {
    const tbl = buildGroupedTable(nextWeek, {
      headers: ['공정명', '계획기간', '상태'],
      row: pr => `<tr>
        <td>${escapeHtml(pr.name)}</td>
        <td>${fmtD(pr.plan_start)}${pr.plan_end && pr.plan_end !== pr.plan_start ? ' ~ '+fmtD(pr.plan_end) : ''}</td>
        <td><span class="status-badge status-${pr.status}">${pr.status}</span></td>
      </tr>`,
    });
    body.appendChild(buildSection('🔜', `다음주 예정  ${fmt(nextStart)} ~ ${fmt(nextEnd)}`, tbl, false));
  }

  // ── 지연 중인 공정 ───────────────────────────────────────────
  if (overdue.length) {
    const tbl = buildGroupedTable(overdue, {
      headers: ['공정명', '계획종료', '경과'],
      row: pr => {
        const days = Math.floor((today - new Date(pr.plan_end)) / 86400000);
        return `<tr>
          <td>${escapeHtml(pr.name)}</td>
          <td class="report-overdue">${pr.plan_end}</td>
          <td class="report-overdue">+${days}일</td>
        </tr>`;
      },
    });
    body.appendChild(buildSection('⚠️', `지연 중인 공정  ${overdue.length}건`, tbl, true));
  }
}

document.getElementById('btnOpenReport')?.addEventListener('click', async () => {
  document.getElementById('reportModal').style.display = '';
  await renderReport();
});
document.getElementById('btnCloseReport')?.addEventListener('click', () => {
  document.getElementById('reportModal').style.display = 'none';
});
document.getElementById('btnPrintReport')?.addEventListener('click', () => {
  // 인쇄 전 모든 섹션 강제 펼치기
  document.querySelectorAll('#reportBody .report-section-body').forEach(el => {
    el.style.display = '';
  });
  document.querySelectorAll('#reportBody .report-toggle-arrow').forEach(el => {
    el.textContent = '▾';
  });
  window.print();
});

// ═══════════════════════════════════════════════════════════
// 사이드바 글로벌 프로젝트 검색
// ═══════════════════════════════════════════════════════════
(function setupGlobalSearch() {
  const input   = document.getElementById('globalSearchInput');
  const results = document.getElementById('globalSearchResults');
  if (!input || !results) return;

  function renderResults(keyword) {
    const q = keyword.trim().toLowerCase();
    if (!q) { results.style.display = 'none'; return; }

    const matched = allProjects.filter(p =>
      p.name.toLowerCase().includes(q) ||
      getCategoryBreadcrumb(p.category_id).toLowerCase().includes(q)
    );

    if (matched.length === 0) {
      results.innerHTML = '<div class="gs-no-result">검색 결과 없음</div>';
    } else {
      results.innerHTML = matched.slice(0, 8).map(p => {
        const cat = getCategoryBreadcrumb(p.category_id);
        return `
          <div class="gs-result-item" data-id="${p.id}">
            <div class="gs-result-name">${p.name}</div>
            <div class="gs-result-meta">${cat}
              <span class="status-badge status-${p.status} gs-result-status" style="font-size:9px;padding:1px 5px">${p.status}</span>
            </div>
          </div>`;
      }).join('');

      results.querySelectorAll('.gs-result-item').forEach(el => {
        el.addEventListener('click', () => {
          openProjectModal(el.dataset.id);
          input.value = '';
          results.style.display = 'none';
          // 전체 현황 페이지로 이동
          navigateTo('dashboard');
        });
      });
    }
    results.style.display = '';
  }

  input.addEventListener('input', () => renderResults(input.value));
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { input.value = ''; results.style.display = 'none'; }
  });

  // 검색창 외부 클릭 시 닫기
  document.addEventListener('click', (e) => {
    if (!input.contains(e.target) && !results.contains(e.target)) {
      results.style.display = 'none';
    }
  });
})();

