/**
 * ai-preload.js — AI 위젯 전용 preload
 * contextIsolation: true 환경에서 renderer ↔ main IPC 채널 노출
 */
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('aiApi', {
  // 위젯 창 크기 전환 (접힘/펼침)
  resize: (isExpanded) => ipcRenderer.send('ai-widget-resize', isExpanded),

  // 위젯 위치 실시간 이동 (드래그 중)
  moveTo: (x, y) => ipcRenderer.send('ai-widget-move', { x, y }),

  // 위젯 위치 저장 (드래그 완료 후)
  savePos: (x, y) => ipcRenderer.send('save-widget-pos', { x, y }),

  // 리사이즈 시작 — 메인이 현재 창 bounds를 캡처
  resizeStart: () => ipcRenderer.send('ai-widget-resize-start'),

  // 리사이즈 진행 — 방향 + 시작점 기준 델타 전달 (메인이 계산)
  resizeByDelta: (dir, dx, dy) => ipcRenderer.send('ai-widget-resize-delta', { dir, dx, dy }),

  // 리사이즈 완료 — 크기/위치 저장
  resizeEnd: () => ipcRenderer.send('ai-widget-resize-end'),

  // AI 채팅 (사용자 메시지 → AI 응답 + 액션 실행)
  chat: (message) => ipcRenderer.invoke('ai-chat', message),

  // 현재 컨텍스트 조회 (프로젝트/공정/단기작업)
  getContext: () => ipcRenderer.invoke('ai-get-context'),

  // AI 설정 조회
  getSettings: () => ipcRenderer.invoke('get-ai-settings'),

  // 대화 히스토리 초기화
  chatReset: () => ipcRenderer.invoke('ai-chat-reset'),

  // 답변 스타일 조회/변경
  chatGetStyle: ()        => ipcRenderer.invoke('ai-get-style'),
  chatSetStyle: (style)   => ipcRenderer.invoke('ai-set-style', style),
});
