const { app, BrowserWindow, Tray, Menu, ipcMain, nativeImage, screen } = require('electron');
const path = require('path');
const fs   = require('fs');
const db       = require('./db');
const notifier = require('./notifier');
const { setupIpcHandlers, setCurrentUser } = require('./ipcHandlers');

// 이전 버전 데이터를 현재 앱 경로로 자동 마이그레이션 (최초 1회)
function migrateFromV2() {
  try {
    const appData  = app.getPath('appData');
    const fileName = 'jae-vis-v2-data.json';
    const destDir  = app.getPath('userData');
    const destFile = path.join(destDir, fileName);

    // 마이그레이션 후보 경로 (최신 데이터 우선)
    const candidates = [
      path.join(appData, 'jae-vis-v3',          fileName),
      path.join(appData, 'jae-vis-v2-prototype', fileName),
    ];

    const destSize = fs.existsSync(destFile) ? fs.statSync(destFile).size : 0;

    for (const src of candidates) {
      if (!fs.existsSync(src)) continue;
      const srcSize = fs.statSync(src).size;
      if (srcSize > destSize) {
        if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true });
        fs.copyFileSync(src, destFile);
        console.log(`[JAE-VIS] 데이터 마이그레이션 완료: ${src}`);
      }
      break; // 가장 최신 후보 하나만 처리
    }
  } catch (e) {
    console.error('[JAE-VIS] 마이그레이션 실패:', e.message);
  }
}

const ICON_PATH = path.join(__dirname, '../../assets/icon.ico');

const WIN = {
  login:     { width: 480, height: 580 },
  dashboard: { width: 1280, height: 820, minW: 960, minH: 640 },
  aiWidget:  { collapsed: { w: 90, h: 110 }, expanded: { w: 360, h: 520 } },
};

let loginWin     = null;
let dashWin      = null;
let aiWin        = null;
let tray         = null;
let aiWinOrigPos = null; // 채팅창 펼치기 전 접힌 위치 저장

// 로그인 창
function createLoginWindow() {
  loginWin = new BrowserWindow({
    width: WIN.login.width,
    height: WIN.login.height,
    frame: false,
    resizable: false,
    transparent: true,
    center: true,
    icon: ICON_PATH,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  loginWin.loadFile(path.join(__dirname, '../renderer/login/login.html'));
}

// 대시보드 창
function createDashboardWindow(username) {
  dashWin = new BrowserWindow({
    width: WIN.dashboard.width,
    height: WIN.dashboard.height,
    minWidth: WIN.dashboard.minW,
    minHeight: WIN.dashboard.minH,
    frame: false,
    backgroundColor: '#0a0e1a',
    center: true,
    icon: ICON_PATH,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  dashWin.loadFile(path.join(__dirname, '../renderer/dashboard/dashboard.html'));
  dashWin.webContents.once('did-finish-load', () => {
    dashWin.webContents.send('set-user', username);
  });
  dashWin.on('closed', () => { dashWin = null; });
}

// AI 위젯 창
function createAIWidget() {
  const aiSettings = db.settings.getAiSettings();
  if (!aiSettings.aiWidgetEnabled) return;

  const { width: sw, height: sh } = screen.getPrimaryDisplay().workAreaSize;
  const savedX = aiSettings.widgetX != null ? aiSettings.widgetX : (sw - WIN.aiWidget.collapsed.w - 30);
  const savedY = aiSettings.widgetY != null ? aiSettings.widgetY : (sh - WIN.aiWidget.collapsed.h - 30);

  aiWin = new BrowserWindow({
    width:       WIN.aiWidget.collapsed.w,
    height:      WIN.aiWidget.collapsed.h,
    x:           savedX,
    y:           savedY,
    frame:       false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable:   false,
    webPreferences: {
      preload:          path.join(__dirname, 'ai-preload.js'),
      contextIsolation: true,
      nodeIntegration:  false,
    },
  });
  // floating: 일반 창 위에 표시, 전체화면 앱보다는 아래
  aiWin.setAlwaysOnTop(true, 'floating');
  aiWin.loadFile(path.join(__dirname, '../renderer/ai-widget/ai-widget.html'));
  aiWin.on('closed', () => { aiWin = null; });
}

// 창 크기 전환 (접힘 <-> 펼침)
ipcMain.on('ai-widget-resize', (_, isExpanded) => {
  if (!aiWin) return;
  const { collapsed } = WIN.aiWidget;
  const aiCfg = db.settings.getAiSettings();
  const expandedW = aiCfg.widgetExpandedW || WIN.aiWidget.expanded.w;
  const expandedH = aiCfg.widgetExpandedH || WIN.aiWidget.expanded.h;

  if (isExpanded) {
    const [cx, cy] = aiWin.getPosition();
    aiWinOrigPos = { x: cx, y: cy };

    const { width: sw, height: sh } = screen.getPrimaryDisplay().workAreaSize;
    let newY = cy - (expandedH - collapsed.h);
    newY = Math.max(0, Math.min(newY, sh - expandedH));
    let newX = Math.max(0, Math.min(cx, sw - expandedW));

    // 리사이즈 가능 설정 (축소도 허용)
    aiWin.setResizable(true);
    aiWin.setMinimumSize(RESIZE_MIN_W, RESIZE_MIN_H);
    aiWin.setMaximumSize(RESIZE_MAX_W, RESIZE_MAX_H);
    aiWin.setSize(expandedW, expandedH);
    aiWin.setPosition(newX, newY);
  } else {
    // 접힐 때 리사이즈 잠금
    aiWin.setResizable(false);
    aiWin.setMinimumSize(collapsed.w, collapsed.h);
    aiWin.setMaximumSize(collapsed.w, collapsed.h);
    aiWin.setSize(collapsed.w, collapsed.h);
    if (aiWinOrigPos) {
      aiWin.setPosition(aiWinOrigPos.x, aiWinOrigPos.y);
      aiWinOrigPos = null;
    }
  }
});

// 위젯 실시간 이동 (드래그)
ipcMain.on('ai-widget-move', (_, pos) => {
  if (!aiWin) return;
  aiWin.setPosition(Math.round(pos.x), Math.round(pos.y));
});

// 위젯 위치 저장
ipcMain.on('save-widget-pos', (_, pos) => {
  db.settings.saveAiSetting('widgetX', pos.x);
  db.settings.saveAiSetting('widgetY', pos.y);
});

// 리사이즈 시작 — 현재 창 bounds 캡처
let resizeStartBounds = null;
const RESIZE_MIN_W = 260, RESIZE_MAX_W = 700;
const RESIZE_MIN_H = 320, RESIZE_MAX_H = 900;

ipcMain.on('ai-widget-resize-start', () => {
  if (!aiWin) return;
  resizeStartBounds = aiWin.getBounds(); // 실제 창 크기/위치 캡처
});

// 리사이즈 델타 적용 — 메인이 직접 계산하여 창 크기 변경
ipcMain.on('ai-widget-resize-delta', (_, { dir, dx, dy }) => {
  if (!aiWin || !resizeStartBounds) return;
  const { x: bx, y: by, width: bw, height: bh } = resizeStartBounds;

  let newW = bw, newH = bh, newX = bx, newY = by;

  if (dir.includes('e')) newW = Math.max(RESIZE_MIN_W, Math.min(RESIZE_MAX_W, bw + dx));
  if (dir.includes('s')) newH = Math.max(RESIZE_MIN_H, Math.min(RESIZE_MAX_H, bh + dy));
  if (dir.includes('w')) {
    newW = Math.max(RESIZE_MIN_W, Math.min(RESIZE_MAX_W, bw - dx));
    newX = bx + (bw - newW);
  }
  if (dir.includes('n')) {
    newH = Math.max(RESIZE_MIN_H, Math.min(RESIZE_MAX_H, bh - dy));
    newY = by + (bh - newH);
  }

  aiWin.setSize(Math.round(newW), Math.round(newH));
  aiWin.setPosition(Math.round(newX), Math.round(newY));
});

// 리사이즈 완료 — 크기/위치 저장 + min/max 범위 유지
ipcMain.on('ai-widget-resize-end', () => {
  if (!aiWin) return;
  const [wx, wy] = aiWin.getPosition();
  const [ww, wh] = aiWin.getSize();
  // 새 크기를 기준으로 min/max 재설정 (이후 추가 조절 가능하도록)
  aiWin.setMinimumSize(RESIZE_MIN_W, RESIZE_MIN_H);
  aiWin.setMaximumSize(RESIZE_MAX_W, RESIZE_MAX_H);
  db.settings.saveAiSetting('widgetX', wx);
  db.settings.saveAiSetting('widgetY', wy);
  db.settings.saveAiSetting('widgetExpandedW', ww);
  db.settings.saveAiSetting('widgetExpandedH', wh);
  resizeStartBounds = null;
});

// AI 설정 변경 -> 위젯 재시작
ipcMain.on('ai-settings-changed', () => {
  if (aiWin) {
    aiWin.close();
    setTimeout(() => createAIWidget(), 300);
  } else {
    createAIWidget();
  }
});

// 트레이
function createTray() {
  const icon = nativeImage.createFromPath(ICON_PATH);
  tray = new Tray(icon.isEmpty() ? nativeImage.createEmpty() : icon);
  tray.setToolTip('JAE-VIS v4');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: '전체 현황 열기', click: () => dashWin && dashWin.show() },
    { label: '3주 스케줄', click: () => {
      if (dashWin) { dashWin.show(); dashWin.webContents.send('navigate', 'schedule'); }
    }},
    { label: '이번주 브리핑', click: () => {
      if (dashWin) { dashWin.show(); dashWin.webContents.send('navigate', 'briefing'); }
    }},
    { type: 'separator' },
    { label: '설정', click: () => {
      if (dashWin) { dashWin.show(); dashWin.webContents.send('navigate', 'settings'); }
    }},
    { type: 'separator' },
    { label: '종료', click: () => app.exit(0) },
  ]));
  tray.on('double-click', () => { if (dashWin) dashWin.show(); });
}

// 앱 초기화
app.whenReady().then(() => {
  migrateFromV2();   // v2 데이터 자동 이전 (v2 데이터가 더 클 때만 실행)
  db.initializeData();
  setupIpcHandlers();

  const savedSettings = db.settings.get();
  app.setLoginItemSettings({
    openAtLogin: !!savedSettings.autoStart,
    name: 'JAE-VIS v4',
  });

  ipcMain.on('win-minimize', (e) => {
    const w = BrowserWindow.fromWebContents(e.sender);
    if (w) w.minimize();
  });
  ipcMain.on('win-maximize', (e) => {
    const w = BrowserWindow.fromWebContents(e.sender);
    if (w) w.isMaximized() ? w.unmaximize() : w.maximize();
  });
  ipcMain.on('win-close', (e) => {
    const w = BrowserWindow.fromWebContents(e.sender);
    if (w) w.hide();
  });

  ipcMain.on('login-success', (_, username) => {
    setCurrentUser(username);
    if (loginWin) { loginWin.close(); loginWin = null; }
    createDashboardWindow(username);
    createTray();
    setTimeout(() => {
      createAIWidget();
      notifier.start(username, dashWin);
    }, 1500);
  });

  ipcMain.on('logout', () => {
    db.settings.clearAutoLogin();
    setCurrentUser(null);
    if (dashWin) { dashWin.close(); dashWin = null; }
    if (aiWin)   { aiWin.close();   aiWin   = null; }
    if (tray)    { tray.destroy();   tray    = null; }
    createLoginWindow();
  });

  const autoLoginUser = db.settings.getAutoLoginUser();
  if (autoLoginUser) {
    setCurrentUser(autoLoginUser);
    createDashboardWindow(autoLoginUser);
    createTray();
    setTimeout(() => {
      createAIWidget();
      notifier.start(autoLoginUser, dashWin);
    }, 1500);
  } else {
    createLoginWindow();
  }
});

app.on('window-all-closed', () => {
  if (!tray) app.quit();
});
