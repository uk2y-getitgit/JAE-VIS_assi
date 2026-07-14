let selectedUser = null;

// ─── 탭 전환 ─────────────────────────────────────────────────
document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById(`tab-${btn.dataset.tab}`).classList.add('active');
    clearErrors();
  });
});

// ─── 사용자 목록 렌더링 ───────────────────────────────────────
async function renderUsers() {
  const users = await window.api.getUsers();
  const list  = document.getElementById('userList');

  if (users.length === 0) {
    list.innerHTML = '<div style="color:#6a8fa8;font-size:13px;text-align:center;padding:12px">등록된 사용자가 없습니다.<br>신규 등록 탭에서 계정을 만드세요.</div>';
    return;
  }

  list.innerHTML = users.map(u => `
    <button class="user-chip" data-name="${u.name}">
      <div class="avatar">${u.name[0].toUpperCase()}</div>
      <span>${u.name}</span>
    </button>
  `).join('');

  list.querySelectorAll('.user-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      list.querySelectorAll('.user-chip').forEach(c => c.classList.remove('selected'));
      chip.classList.add('selected');
      selectedUser = chip.dataset.name;
      document.getElementById('pinSection').style.display = 'block';
      document.getElementById('loginPin').focus();
    });
  });
}

// ─── 로그인 처리 ──────────────────────────────────────────────
document.getElementById('btnLogin').addEventListener('click', async () => {
  clearErrors();
  if (!selectedUser) { showError('loginError', '사용자를 선택하세요.'); return; }
  const pin = document.getElementById('loginPin').value.trim();
  if (!pin) { showError('loginError', 'PIN을 입력하세요.'); return; }

  const ok = await window.api.verifyUser(selectedUser, pin);
  if (ok) {
    const autoLogin = document.getElementById('chkAutoLogin')?.checked;
    if (autoLogin) {
      await window.api.setAutoLogin(selectedUser);
    } else {
      await window.api.clearAutoLogin();
    }
    window.api.loginSuccess(selectedUser);
  } else {
    showError('loginError', 'PIN이 올바르지 않습니다.');
    document.getElementById('loginPin').value = '';
  }
});

// PIN 입력 후 Enter 키 로그인
document.getElementById('loginPin').addEventListener('keydown', e => {
  if (e.key === 'Enter') document.getElementById('btnLogin').click();
});

// ─── 신규 등록 처리 ───────────────────────────────────────────
document.getElementById('btnRegister').addEventListener('click', async () => {
  clearErrors();
  const name       = document.getElementById('regName').value.trim();
  const pin        = document.getElementById('regPin').value.trim();
  const pinConfirm = document.getElementById('regPinConfirm').value.trim();

  if (!name)              { showError('regError', '이름을 입력하세요.'); return; }
  if (!/^\d{4}$/.test(pin)) { showError('regError', 'PIN은 4자리 숫자여야 합니다.'); return; }
  if (pin !== pinConfirm) { showError('regError', 'PIN이 일치하지 않습니다.'); return; }

  try {
    await window.api.createUser(name, pin);
    // 등록 후 로그인 탭으로 전환
    document.querySelector('[data-tab="login"]').click();
    renderUsers();
  } catch (err) {
    showError('regError', err.message || '등록 실패');
  }
});

// ─── 창 닫기 ─────────────────────────────────────────────────
document.getElementById('btnClose').addEventListener('click', () => window.api.close());

// ─── 유틸 ─────────────────────────────────────────────────────
function showError(id, msg) { document.getElementById(id).textContent = msg; }
function clearErrors() {
  document.getElementById('loginError').textContent = '';
  document.getElementById('regError').textContent   = '';
}

// ─── 설치 게이트 ────────────────────────────────────────────
// 로컬 사용자가 하나도 없고, 이 PC가 클라우드에 연결된 적도 없는 "진짜 최초 실행"일 때만
// 신규 등록 탭 진입 전에 "팀 합류 vs 최초 설치" 선택지를 보여준다.
function showGate() {
  document.getElementById('setupGate').style.display = 'block';
  document.getElementById('mainTabs').style.display   = 'none';
}
function showMainTabs() {
  document.getElementById('setupGate').style.display        = 'none';
  document.getElementById('cloudConnectGate').style.display = 'none';
  document.getElementById('mainTabs').style.display         = 'block';
}

document.getElementById('btnFreshInstall').addEventListener('click', () => {
  showMainTabs();
  renderUsers();
});

document.getElementById('btnJoinTeam').addEventListener('click', () => {
  document.getElementById('setupGate').style.display        = 'none';
  document.getElementById('cloudConnectGate').style.display = 'block';
});

document.getElementById('btnGateBack').addEventListener('click', () => {
  document.getElementById('cloudConnectGate').style.display = 'none';
  document.getElementById('gateError').textContent = '';
  showGate();
});

document.getElementById('btnGateConnect').addEventListener('click', async () => {
  const gateError = document.getElementById('gateError');
  gateError.textContent = '';

  const url      = document.getElementById('gateSupabaseUrl').value.trim();
  const anonKey  = document.getElementById('gateSupabaseAnonKey').value.trim();
  const email    = document.getElementById('gateEmail').value.trim();
  const password = document.getElementById('gatePassword').value.trim();

  if (!url || !anonKey || !email || !password) {
    gateError.textContent = '모든 항목을 입력하세요.';
    return;
  }

  try {
    await window.api.cloudConnect({ url, anonKey, email, password });
    let created = 0;
    try {
      const result = await window.api.cloudPullTeamMembers();
      created = result?.created || 0;
    } catch (e) {
      console.warn('[팀원 동기화] 연결은 성공했지만 팀원 목록 조회 실패:', e.message);
    }
    showMainTabs();
    renderUsers();
    if (created > 0) {
      showError('loginError', `팀원 계정 ${created}명을 가져왔습니다. 목록에서 본인 이름을 선택하세요.`);
    }
  } catch (e) {
    gateError.textContent = e.message || '클라우드 연결에 실패했습니다.';
  }
});

// 초기 로드
(async () => {
  try {
    const users  = await window.api.getUsers();
    const status = await window.api.cloudGetStatus();

    if (users.length === 0 && !status?.connected) {
      // 이 PC에서 처음 실행되고, 클라우드 연결 이력도 없는 경우에만 게이트를 보여준다.
      showGate();
      return;
    }

    // 그 외(로컬 사용자가 있거나, 이미 클라우드 연결된 적 있는 PC)는 기존 흐름 그대로.
    showMainTabs();
    if (status?.connected && status?.authenticated) {
      try {
        await window.api.cloudPullTeamMembers();
      } catch (e) {
        console.warn('[팀원 동기화] 건너뜀:', e.message);
      }
    }
  } catch (e) {
    console.warn('[초기 로드] 게이트 판단 실패, 기본 화면으로 진행:', e.message);
    showMainTabs();
  }
  renderUsers();
})();
