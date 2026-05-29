/**
 * notifier.js — JAE-VIS Phase C 알림 시스템
 * - D-N 마감 알림 / 지연 알림
 * - Windows 토스트 (Electron Notification API)
 * - 앱 내 알림 센터 (bell icon badge)
 * - 30분 주기 자동 체크
 */

const { Notification } = require('electron');
const db = require('./db');

const INTERVAL_MS = 30 * 60 * 1000; // 30분

let _interval = null;
let _dashWin  = null;
let _username = null;

function setWindow(win) { _dashWin = win; }

function fmtDate(iso) {
  if (!iso) return '';
  const [, m, d] = iso.split('-');
  return `${Number(m)}/${Number(d)}`;
}

function checkAll(username) {
  if (!username) return;
  const s = db.settings.get();
  if (s.notifEnabled === false) return;

  const now      = new Date();
  const todayStr = now.toISOString().slice(0, 10);
  const hour     = now.getHours();

  // 제외 시간대 (기본 22:00~08:00)
  const excStart = s.notifExcludeStart ?? 22;
  const excEnd   = s.notifExcludeEnd   ?? 8;
  const excluded = excStart > excEnd
    ? (hour >= excStart || hour < excEnd)
    : (hour >= excStart && hour < excEnd);
  if (excluded) return;

  // 주말 제외 옵션
  if (s.notifExcludeWeekend && [0, 6].includes(now.getDay())) return;

  const remindDays = Array.isArray(s.notifRemindDays) ? s.notifRemindDays : [3, 1];
  const projects   = db.projects.getAll(username);
  const newNotifs  = [];

  // 오늘 자정 기준으로 daysLeft 계산
  const todayMidnight = new Date(now); todayMidnight.setHours(0, 0, 0, 0);

  projects.forEach(proj => {
    db.processes.getByProject(proj.id)
      .filter(p => !p.is_group && p.plan_end && p.status !== '완료')
      .forEach(proc => {
        const endDate  = new Date(proc.plan_end);
        const daysLeft = Math.round((endDate - todayMidnight) / 86400000);

        let type = null;
        if      (daysLeft < 0)                     type = 'overdue';
        else if (daysLeft === 0)                   type = 'd0';
        else if (remindDays.includes(daysLeft))    type = `d${daysLeft}`;
        if (!type) return;

        const logKey = `${proc.id}_${type}_${todayStr}`;
        if (db.notifLog.has(logKey)) return;
        db.notifLog.set(logKey);

        let title, body;
        if (type === 'overdue') {
          const days = Math.abs(daysLeft);
          title = `🔴 지연 — ${proj.name}`;
          body  = `${procDisplayName}  |  ${days}일 경과  마감 ${proc.plan_end}`;
        } else if (type === 'd0') {
          title = `⚠️ 오늘 마감 — ${proj.name}`;
          body  = `${procDisplayName}  마감 ${proc.plan_end}`;
        } else {
          title = `📅 D-${daysLeft} — ${proj.name}`;
          body  = `${procDisplayName}  마감 ${proc.plan_end}`;
        }

        // Windows 토스트 알림
        if (Notification.isSupported()) {
          try {
            const notif = new Notification({ title, body, urgency: 'normal' });
            notif.on('click', () => {
              if (_dashWin) {
                _dashWin.show();
                _dashWin.webContents.send('navigate', 'schedule');
              }
            });
            notif.show();
          } catch (e) { console.error('[Notifier] toast 오류:', e.message); }
        }

        // 부모 공정명 조회 (건진법 그룹: "동바리1차 - 청구" 형식)
        let procDisplayName = proc.name;
        if (proc.parent_id) {
          const parent = db.processes.getById(proc.parent_id);
          if (parent) procDisplayName = `${parent.name} - ${proc.name}`;
        }

        // 앱 내 알림 저장 (process_name에 부모 포함)
        const saved = db.notifications.add({
          id:           `notif_${Date.now()}_${Math.random().toString(36).substr(2, 4)}`,
          project_id:   proj.id,
          process_id:   proc.id,
          project_name: proj.name,
          process_name: procDisplayName,
          type,
          days_left:    daysLeft,
          plan_end:     proc.plan_end,
          is_read:      false,
          created_at:   new Date().toISOString(),
        });
        newNotifs.push(saved);
      });
  });

  // 대시보드에 뱃지 업데이트 신호 전송
  if (_dashWin) {
    try {
      const unreadCount = db.notifications.getUnread().length;
      _dashWin.webContents.send('notif-update', unreadCount);
    } catch (e) {}
  }
}

function start(username, dashWin) {
  _username = username;
  _dashWin  = dashWin;
  // 앱 시작 시 즉시 체크
  setTimeout(() => checkAll(_username), 3000);
  // 30분마다 체크
  if (_interval) clearInterval(_interval);
  _interval = setInterval(() => checkAll(_username), INTERVAL_MS);
}

function stop() {
  if (_interval) clearInterval(_interval);
  _interval = null;
}

module.exports = { start, stop, checkAll, setWindow };
