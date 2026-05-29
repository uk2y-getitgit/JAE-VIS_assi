const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  // 창 제어
  minimize:  () => ipcRenderer.send('win-minimize'),
  maximize:  () => ipcRenderer.send('win-maximize'),
  close:     () => ipcRenderer.send('win-close'),

  // 인증 흐름
  loginSuccess: (username) => ipcRenderer.send('login-success', username),
  logout:       () => ipcRenderer.send('logout'),

  // 사용자
  getUsers:   () => ipcRenderer.invoke('get-users'),
  createUser: (name, pin) => ipcRenderer.invoke('create-user', name, pin),
  verifyUser: (name, pin) => ipcRenderer.invoke('verify-user', name, pin),

  // 카테고리
  getCategories:  () => ipcRenderer.invoke('get-categories'),
  createCategory: (data) => ipcRenderer.invoke('create-category', data),
  updateCategory: (id, data) => ipcRenderer.invoke('update-category', id, data),
  deleteCategory: (id) => ipcRenderer.invoke('delete-category', id),
  getBreadcrumb:  (id) => ipcRenderer.invoke('get-breadcrumb', id),

  // 프로젝트
  getProjects:       () => ipcRenderer.invoke('get-projects'),
  getDeletedProjects:() => ipcRenderer.invoke('get-deleted-projects'),
  createProject:     (data) => ipcRenderer.invoke('create-project', data),
  updateProject:     (id, data) => ipcRenderer.invoke('update-project', id, data),
  deleteProject:     (id) => ipcRenderer.invoke('delete-project', id),
  restoreProject:    (id) => ipcRenderer.invoke('restore-project', id),
  hardDeleteProject: (id) => ipcRenderer.invoke('hard-delete-project', id),

  // 공정
  getProcesses:     (projectId) => ipcRenderer.invoke('get-processes', projectId),
  createProcess:    (data) => ipcRenderer.invoke('create-process', data),
  updateProcess:    (id, data) => ipcRenderer.invoke('update-process', id, data),
  deleteProcess:    (id) => ipcRenderer.invoke('delete-process', id),
  reorderProcesses: (projectId, ids) => ipcRenderer.invoke('reorder-processes', projectId, ids),

  // 메모
  getMemosByProject: (pid) => ipcRenderer.invoke('get-memos-project', pid),
  getMemosByProcess: (pid) => ipcRenderer.invoke('get-memos-process', pid),
  createMemo:        (data) => ipcRenderer.invoke('create-memo', data),
  updateMemo:        (id, data) => ipcRenderer.invoke('update-memo', id, data),
  deleteMemo:        (id) => ipcRenderer.invoke('delete-memo', id),

  // 빠른 메모 / 단기 작업
  getQuickMemosActive:     () => ipcRenderer.invoke('get-quick-memos-active'),
  getQuickMemosDone:       () => ipcRenderer.invoke('get-quick-memos-done'),
  getQuickMemosDonePeriod: (period) => ipcRenderer.invoke('get-quick-memos-done-period', period),
  createQuickMemo:         (data) => ipcRenderer.invoke('create-quick-memo', data),
  completeQuickMemo:       (id) => ipcRenderer.invoke('complete-quick-memo', id),
  deleteQuickMemo:         (id) => ipcRenderer.invoke('delete-quick-memo', id),
  updateQuickMemo:         (id, data) => ipcRenderer.invoke('update-quick-memo', id, data),

  // 설정
  getSettings:    () => ipcRenderer.invoke('get-settings'),
  updateSettings: (data) => ipcRenderer.invoke('update-settings', data),

  // 자동로그인
  setAutoLogin:   (username) => ipcRenderer.invoke('set-auto-login', username),
  clearAutoLogin: () => ipcRenderer.invoke('clear-auto-login'),
  getAutoLogin:   () => ipcRenderer.invoke('get-auto-login'),

  // AI 비서 설정
  getAiSettings:  () => ipcRenderer.invoke('get-ai-settings'),
  saveAiSettings: (data) => ipcRenderer.invoke('save-ai-settings', data),

  // AI 위젯 알림
  notifyAiSettingsChanged: () => ipcRenderer.send('ai-settings-changed'),

  // 대시보드 갱신 수신 (AI 액션 후 메인에서 보냄)
  onDashboardRefresh: (cb) => ipcRenderer.on('notify-dashboard', (_, page) => cb(page)),

  // 이벤트 수신
  onSetUser:  (cb) => ipcRenderer.on('set-user',  (_, u) => cb(u)),
  onNavigate: (cb) => ipcRenderer.on('navigate',  (_, p) => cb(p)),

  // ── Phase C: 알림 ────────────────────────────────────────
  getNotifications:   ()   => ipcRenderer.invoke('get-notifications'),
  getNotifUnread:     ()   => ipcRenderer.invoke('get-notif-unread'),
  markNotifsRead:     ()   => ipcRenderer.invoke('mark-notifs-read'),
  clearNotifications: ()   => ipcRenderer.invoke('clear-notifications'),
  checkNotifications: ()   => ipcRenderer.invoke('check-notifications'),
  getNotifSettings:   ()   => ipcRenderer.invoke('get-notif-settings'),
  onNotifUpdate: (cb) => ipcRenderer.on('notif-update', (_, count) => cb(count)),

  // ── Phase D: 변경 이력 ────────────────────────────────────
  getChangeLogs:        ()    => ipcRenderer.invoke('get-change-logs'),
  getChangeLogsProject: (id)  => ipcRenderer.invoke('get-change-logs-project', id),

  // ── AI 챗봇 고급 기능 ────────────────────────────────────
  chatReset:    ()        => ipcRenderer.invoke('ai-chat-reset'),
  chatGetStyle: ()        => ipcRenderer.invoke('ai-get-style'),
  chatSetStyle: (style)   => ipcRenderer.invoke('ai-set-style', style),

  // ── Supabase 클라우드 연동 ──────────────────────────────
  cloudGetStatus: ()                          => ipcRenderer.invoke('cloud-get-status'),
  cloudConnect:   (cfg)                       => ipcRenderer.invoke('cloud-connect', cfg),
  cloudSignUp:    (cfg)                       => ipcRenderer.invoke('cloud-sign-up', cfg),
  cloudSignOut:   ()                          => ipcRenderer.invoke('cloud-sign-out'),
  cloudMigrate:   ()                          => ipcRenderer.invoke('cloud-migrate'),
  cloudPull:      ()                          => ipcRenderer.invoke('cloud-pull'),
});
