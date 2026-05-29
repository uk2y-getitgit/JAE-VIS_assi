/**
 * ai-widget.js — JAE-VIS AI 위젯 동작 + 채팅 로직
 * preload: window.aiApi (ai-preload.js)
 */

// ── 상태 변수 ──────────────────────────────────────────────────
let isExpanded    = false;
let isThinking    = false;
const MAX_MESSAGES = 20;

// 드래그 상태
let dragging    = false;
let dragStartX  = 0;
let dragStartY  = 0;
let winStartX   = 0;
let winStartY   = 0;

// 리사이즈 상태
let isResizing = false;
let resizeDir  = '';
let rsStartX   = 0, rsStartY = 0;

// ── DOM ────────────────────────────────────────────────────────
const collapsedView = document.getElementById('collapsed-view');
const expandedView  = document.getElementById('expanded-view');
const orbWrapper    = document.getElementById('orbWrapper');
const chatMessages  = document.getElementById('chatMessages');
const chatInput     = document.getElementById('chatInput');
const btnSend       = document.getElementById('btnSend');
const btnClose      = document.getElementById('btnClose');
const btnReset      = document.getElementById('btnReset');
const styleSelect   = document.getElementById('styleSelect');
const chatStatus    = document.getElementById('chatStatus');

// ── 초기화 ─────────────────────────────────────────────────────
window.addEventListener('DOMContentLoaded', () => {
  addWelcomeMessage();
  loadStyle();
  setupDrag();
  setupResize();
  setupEvents();
});

function addWelcomeMessage() {
  addAiMessage('안녕하세요! JAE-VIS AI입니다.\n이번주 일정 브리핑, 공정 상태 변경, 일정 등록 등을 도와드립니다.');
}

// 저장된 답변 스타일 불러오기
async function loadStyle() {
  try {
    const style = await window.aiApi.chatGetStyle();
    if (styleSelect && style) styleSelect.value = style;
  } catch(e) {}
}

// ── 드래그 (접힌/펼친 상태 공통) ───────────────────────────────
function setupDrag() {
  // 접힌 상태: collapsedView 전체 드래그
  collapsedView.addEventListener('mousedown', startDrag);

  // 펼친 상태: 헤더(chat-header)만 드래그
  const header = document.querySelector('.chat-header');
  if (header) header.addEventListener('mousedown', startDrag);

  document.addEventListener('mousemove', onDragMove);
  document.addEventListener('mouseup', onDragEnd);
}

function startDrag(e) {
  // 버튼 또는 리사이즈 핸들은 드래그 아님
  if (e.target.closest('button')) return;
  if (e.target.closest('.resize-handle')) return;
  if (e.button !== 0) return;

  dragging   = true;
  dragStartX = e.screenX;
  dragStartY = e.screenY;
  winStartX  = window.screenX;
  winStartY  = window.screenY;
  e.preventDefault();
}

function onDragMove(e) {
  if (!dragging) return;
  const newX = winStartX + (e.screenX - dragStartX);
  const newY = winStartY + (e.screenY - dragStartY);
  window.aiApi.moveTo(newX, newY);
}

function onDragEnd() {
  if (!dragging) return;
  dragging = false;
  // 이동 완료 후 위치 저장
  setTimeout(() => {
    window.aiApi.savePos(window.screenX, window.screenY);
  }, 100);
}

// ── 리사이즈 (펼친 상태 가장자리 드래그) ───────────────────────
function setupResize() {
  document.querySelectorAll('.resize-handle').forEach(handle => {
    handle.addEventListener('mousedown', (e) => {
      if (!isExpanded) return;
      isResizing = true;
      resizeDir  = handle.dataset.dir;
      rsStartX   = e.screenX;
      rsStartY   = e.screenY;
      // 메인 프로세스가 현재 창의 실제 bounds를 캡처
      window.aiApi.resizeStart();
      e.preventDefault();
      e.stopPropagation();
    });
  });

  document.addEventListener('mousemove', (e) => {
    if (!isResizing) return;
    const dx = e.screenX - rsStartX;
    const dy = e.screenY - rsStartY;
    // 메인 프로세스가 getBounds()로 실제 크기 기반 계산
    window.aiApi.resizeByDelta(resizeDir, dx, dy);
  });

  document.addEventListener('mouseup', () => {
    if (!isResizing) return;
    isResizing = false;
    // 메인 프로세스가 최종 크기/위치 저장
    window.aiApi.resizeEnd();
  });
}

// ── 이벤트 ─────────────────────────────────────────────────────
function setupEvents() {
  // 오브 클릭 → 패널 열기 (드래그와 구분: mouseup 직전에 이동 없었을 때만)
  let clickStartX = 0, clickStartY = 0;
  orbWrapper.addEventListener('mousedown', (e) => {
    clickStartX = e.screenX;
    clickStartY = e.screenY;
  });
  orbWrapper.addEventListener('mouseup', (e) => {
    const dx = Math.abs(e.screenX - clickStartX);
    const dy = Math.abs(e.screenY - clickStartY);
    if (dx < 5 && dy < 5) openPanel(); // 이동 없으면 클릭으로 처리
  });

  // 닫기 버튼
  btnClose.addEventListener('click', closePanel);

  // 새 대화 버튼 (히스토리 초기화)
  btnReset.addEventListener('click', async () => {
    await window.aiApi.chatReset();
    chatMessages.innerHTML = '';
    addWelcomeMessage();
    chatStatus.textContent = '새 대화 시작됨';
    setTimeout(() => { chatStatus.textContent = '준비됨'; }, 1500);
  });

  // 답변 스타일 변경
  styleSelect.addEventListener('change', async () => {
    await window.aiApi.chatSetStyle(styleSelect.value);
  });

  // 전송 버튼
  btnSend.addEventListener('click', sendMessage);

  // Enter 전송 / Shift+Enter 줄바꿈
  chatInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  });

  // 입력창 자동 높이 조절
  chatInput.addEventListener('input', () => {
    chatInput.style.height = 'auto';
    chatInput.style.height = Math.min(chatInput.scrollHeight, 80) + 'px';
  });

  // 빠른 버튼
  document.querySelectorAll('.quick-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const prompt = btn.dataset.prompt;
      if (prompt) { chatInput.value = prompt; sendMessage(); }
    });
  });
}

// ── 패널 열기/닫기 ─────────────────────────────────────────────
function openPanel() {
  if (isExpanded) return;
  isExpanded = true;
  collapsedView.style.display = 'none';
  expandedView.style.display  = 'flex';
  window.aiApi.resize(true);
  // 펼친 후 winStart 갱신 (위치가 바뀌므로)
  setTimeout(() => {
    winStartX = window.screenX;
    winStartY = window.screenY;
    chatInput.focus();
    scrollToBottom();
  }, 250);
}

function closePanel() {
  isExpanded = false;
  expandedView.style.display  = 'none';
  collapsedView.style.display = 'flex';
  window.aiApi.resize(false);
  // 접힌 후 winStart 갱신
  setTimeout(() => {
    winStartX = window.screenX;
    winStartY = window.screenY;
  }, 250);
}

// ── 채팅 메시지 처리 ───────────────────────────────────────────
async function sendMessage() {
  const text = chatInput.value.trim();
  if (!text || isThinking) return;

  addUserMessage(text);
  chatInput.value = '';
  chatInput.style.height = 'auto';

  setThinking(true);
  const typingEl = addTypingIndicator();

  try {
    const result = await window.aiApi.chat(text);
    removeTypingIndicator(typingEl);
    setThinking(false);
    addAiMessage(result && result.message ? result.message : '죄송합니다, 응답을 받지 못했습니다.');
  } catch (err) {
    removeTypingIndicator(typingEl);
    setThinking(false);
    addAiMessage('❌ 오류: ' + (err.message || err));
  }
}

function setThinking(val) {
  isThinking = val;
  btnSend.disabled = val;
  chatStatus.textContent = val ? '생각 중...' : '준비됨';
  chatStatus.className   = 'chat-status' + (val ? ' thinking' : '');
}

// ── 메시지 버블 ────────────────────────────────────────────────
function addUserMessage(text) { appendMessage('user', text); }
function addAiMessage(text)   { appendMessage('ai',   text); }

function appendMessage(role, text) {
  const items = chatMessages.querySelectorAll('.msg');
  if (items.length >= MAX_MESSAGES) items[0].remove();

  const time = new Date().toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' });
  const msgEl = document.createElement('div');
  msgEl.className = 'msg ' + role;
  msgEl.innerHTML =
    '<div class="msg-bubble">' + escapeHtml(text) + '</div>' +
    '<div class="msg-time">' + time + '</div>';
  chatMessages.appendChild(msgEl);
  scrollToBottom();
}

function addTypingIndicator() {
  const el = document.createElement('div');
  el.className = 'typing-indicator';
  el.innerHTML = '<div class="typing-dot"></div><div class="typing-dot"></div><div class="typing-dot"></div>';
  chatMessages.appendChild(el);
  scrollToBottom();
  return el;
}

function removeTypingIndicator(el) {
  if (el && el.parentNode) el.parentNode.removeChild(el);
}

function scrollToBottom() {
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
