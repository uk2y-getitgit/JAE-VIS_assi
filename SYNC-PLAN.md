# JAE-VIS 동기화 완성 작업 지침서

> 작성일: 2026-06-03  
> 현재 상태: PC→모바일 일부 실시간 / 역방향·PC간 미구현

---

## 1. 프로젝트 구조

```
JAE-VIS_assi/
├── mobile/        Next.js 16 PWA — https://mobile-nu-rose.vercel.app
│   ├── app/(app)/tasks/          기타작업 (quick_memos 테이블)
│   ├── app/(app)/project/[id]/   프로젝트 상세 + 메모 (memos, processes 테이블)
│   ├── app/(app)/page.tsx        프로젝트 목록 (realtime 없음)
│   ├── app/(app)/schedule/       스케줄 (realtime 없음)
│   └── lib/supabase.ts           createBrowserClient (@supabase/ssr)
└── v3/            Electron 데스크탑 앱
    └── src/main/supabase.js      push(업로드) + pull(일괄다운로드)만 있음
```

**Supabase 테이블 목록**

| 테이블 | 용도 |
|--------|------|
| `projects` | 프로젝트 |
| `categories` | 카테고리 계층 |
| `processes` | 공정 (is_deleted 소프트삭제) |
| `memos` | 프로젝트 메모 |
| `quick_memos` | 기타작업 |
| `user_profiles` | 사용자 프로필 |
| `user_settings` | 앱 설정 |

---

## 2. 현재 동기화 현황

### ✅ 실시간 동작 중

| 방향 | 대상 | 구현 위치 |
|------|------|-----------|
| PC → 모바일 | 기타작업 INSERT/UPDATE/DELETE | `TasksClient.tsx` useEffect |
| PC → 모바일 | 메모 INSERT/DELETE | `ProjectDetailClient.tsx` useEffect |
| PC → 모바일 | 공정 상태 UPDATE | `ProjectDetailClient.tsx` useEffect |

### ❌ 미구현 (추후 작업 대상)

| 방향 | 대상 | 원인 |
|------|------|------|
| 모바일 → PC | 전체 | v3 `supabase.js`에 Realtime 수신 없음 |
| PC → PC | 전체 | 동일 |
| 모바일 | 프로젝트 목록 변경 반영 | `ProjectListClient.tsx` realtime 미구현 |
| 모바일 | 스케줄 변경 반영 | `ScheduleClient.tsx` realtime 미구현 |

---

## 3. 추후 실시간 동기화 완성 작업 계획

### Phase A — 모바일 나머지 페이지 Realtime 추가 (난이도: 하)

**대상 파일**: `mobile/app/(app)/ProjectListClient.tsx`, `mobile/app/(app)/schedule/ScheduleClient.tsx`

**작업 내용**:
```
ProjectListClient.tsx
  - projects 테이블: INSERT, UPDATE, DELETE 구독
  - processes 테이블: UPDATE 구독 (완료율 재계산용)

ScheduleClient.tsx
  - processes 테이블: UPDATE 구독 (plan_end 변경 반영)
```

**구현 패턴** (기존 코드와 동일):
```typescript
useEffect(() => {
  const channel = supabase
    .channel('projects-realtime')
    .on('postgres_changes',
      { event: '*', schema: 'public', table: 'projects' },
      () => { /* 전체 재조회 또는 state 업데이트 */ }
    )
    .subscribe();
  return () => { supabase.removeChannel(channel); };
}, [supabase]);
```

---

### Phase B — PC(v3) Realtime 수신 추가 (난이도: 중)

**대상 파일**: `v3/src/main/supabase.js`, `v3/src/main/ipcHandlers.js`, `v3/src/renderer/dashboard/dashboard.js`

**작업 내용**:

**1. `supabase.js`에 realtime 구독 함수 추가**
```javascript
// supabase.js 하단에 추가
const realtime = {
  subscribe(onProjectChange, onProcessChange, onMemoChange, onQuickMemoChange) {
    if (!isReady()) return null;

    const channel = supabase
      .channel('pc-realtime')
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'projects',
          filter: `user_id=eq.${currentUid}` },
        (payload) => onProjectChange?.(payload)
      )
      .on('postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'processes' },
        (payload) => onProcessChange?.(payload)
      )
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'memos' },
        (payload) => onMemoChange?.(payload)
      )
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'quick_memos',
          filter: `user_id=eq.${currentUid}` },
        (payload) => onQuickMemoChange?.(payload)
      )
      .subscribe();

    return channel;
  },

  unsubscribe(channel) {
    if (channel) supabase.removeChannel(channel);
  },
};

// module.exports에 realtime 추가
module.exports = { init, getClient, isReady, getSyncStatus, auth, sync, pull, realtime };
```

**2. `ipcHandlers.js`에 IPC 채널 추가**
```javascript
// 로그인 성공 후 realtime 구독 시작
const channel = supabase.realtime.subscribe(
  (payload) => mainWindow.webContents.send('realtime:project', payload),
  (payload) => mainWindow.webContents.send('realtime:process', payload),
  (payload) => mainWindow.webContents.send('realtime:memo', payload),
  (payload) => mainWindow.webContents.send('realtime:quickMemo', payload),
);
// 로그아웃 시 channel 해제
```

**3. `dashboard.js` 렌더러에서 수신 처리**
```javascript
window.electronAPI.on('realtime:project', (payload) => {
  // payload.eventType: 'INSERT' | 'UPDATE' | 'DELETE'
  // 프로젝트 목록 UI 갱신
});
window.electronAPI.on('realtime:quickMemo', (payload) => {
  // 기타작업 목록 UI 갱신
});
```

**주의사항**:
- v3는 Node.js 환경이므로 `ws` 패키지로 WebSocket 처리 (이미 init()에 설정됨)
- Supabase Realtime filter의 DELETE 이벤트는 `REPLICA IDENTITY FULL` 없이 user_id 필터 미작동 → DELETE는 필터 제거 후 클라이언트 측 필터링
- 로컬 DB(electron-store)와 Supabase 간 충돌 방지: realtime 수신 데이터는 local DB에도 반영

---

### Phase C — PC 간 동기화 검증 (난이도: 하 / Phase B 완료 후)

Phase B 완료 시 자동으로 PC→PC 동기화도 됨.  
검증 항목:
- [ ] PC A에서 프로젝트 생성 → PC B 실시간 반영
- [ ] PC A에서 공정 상태 변경 → PC B 실시간 반영
- [ ] 모바일에서 메모 등록 → PC 실시간 반영

---

## 4. Supabase 설정 확인 사항 (작업 전 체크)

현재 `memos`, `quick_memos` 테이블의 `id` 컬럼에 `DEFAULT gen_random_uuid()`가 없어 클라이언트에서 UUID를 직접 생성 중.  
추후 DB 정리 시 아래 SQL 실행 권장:

```sql
ALTER TABLE memos      ALTER COLUMN id SET DEFAULT gen_random_uuid();
ALTER TABLE quick_memos ALTER COLUMN id SET DEFAULT gen_random_uuid();
```

DELETE Realtime 필터 정상 작동을 위해 아래 설정도 권장:
```sql
ALTER TABLE memos       REPLICA IDENTITY FULL;
ALTER TABLE quick_memos REPLICA IDENTITY FULL;
ALTER TABLE processes   REPLICA IDENTITY FULL;
```

---

## 5. 작업 우선순위 요약

| 순서 | Phase | 예상 소요 | 효과 |
|------|-------|-----------|------|
| 1 | Phase A — 모바일 목록/스케줄 Realtime | 1~2시간 | 모바일 완성도 향상 |
| 2 | Phase B — PC Realtime 수신 | 3~4시간 | 모바일↔PC 양방향 완성 |
| 3 | Phase C — 검증 | 30분 | 전체 동기화 완성 확인 |
| 4 | Supabase DB 정리 | 10분 | id DEFAULT + REPLICA IDENTITY |
