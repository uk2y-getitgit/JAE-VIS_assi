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

// 초기 로드
renderUsers();
