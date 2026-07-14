# JAE-VIS 다중 사용자 공유 + 관리자 현황 + 소분류 기능 실행 계획

> 작성일: 2026-07-14
> 상태: **계획 확정, 구현 착수 전 (다음 작업 대기)**

## Context (배경)

현재 JAE-VIS는 **1인 사용 전제의 로컬 우선(local-first)** 구조다.

- **v3(Electron)**: 로컬 로그인(이름+PIN, electron-store)과 Supabase 인증(설정에 저장된 이메일/비번 **단 1개 계정**)이 서로 **분리**되어 있다. 모든 클라우드 데이터가 **하나의 Supabase user_id** 아래에 쌓이고, 사용자는 `projects.username` 컬럼으로만 구분된다.
- **categories(분류)**: `user_id`가 없는 **전역 공용** 테이블. `대분류(level 1)`, `중분류(level 2)` 2단계만 존재.
- **mobile(Next.js PWA)**: Supabase를 직접 조회.
- **RLS**: 현재 사실상 미적용(한 계정만 쓰므로 불필요했음).

**목표**: (1) 관리자 계정이 전체 사용자 데이터를 취합해 보는 현황 화면, (2) 각 사용자가 자기 계정으로 로그인해 자기 프로젝트만 관리, (3) 설정→분류관리에서 중분류 아래 **소분류(사용자 자유 입력)** 추가.

**확정된 방향** (사용자 결정):
- 관리자 현황 = **웹 페이지**(mobile에 `/admin` 추가)
- 분류 = **중분류까지 조직 공용 + 소분류는 사용자 개인**
- 계정 = **관리자가 생성/배포**
- 기존 실사용 데이터 존재 → **마이그레이션 필요**

---

## 핵심 아키텍처

**하나의 Supabase 프로젝트 + 사용자별 Auth 계정 + `role` 기반 RLS.**

- 실제 사용자 1명 = Supabase Auth 계정 1개(이메일+비번). `user_profiles.role`로 `admin` / `member` 구분.
- `projects.user_id` = 소유자. RLS로 member는 본인 것만, admin은 전체 조회.
- 분류: `대/중분류`는 `categories.user_id = NULL`(공용, 관리자만 수정), `소분류`는 `user_id = 소유자`(개인).
- 데스크탑 로그인 = Supabase 로그인(이메일/비번)으로 통일. 로그인 후 `user_profiles.username`을 받아 `currentUsername`에 세팅 → 로컬 DB 필터링이 계정과 일치.
- 관리자 웹 페이지는 RLS의 admin 정책 덕분에 전체 데이터를 읽어 집계.

---

## Phase 1 — Supabase 스키마 & RLS (기반)

> Supabase SQL 에디터에서 실행. **작업 전 DB 백업/스냅샷 필수.**

**1-1. 스키마 변경**
```sql
-- 역할 컬럼
ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS role  text DEFAULT 'member';
ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS email text;

-- 소분류(개인) 지원: NULL = 공용(대/중분류), 값 있으면 개인 소분류
ALTER TABLE categories ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES auth.users(id);
```

**1-2. admin 판별 헬퍼**(RLS 재귀 방지 위해 SECURITY DEFINER)
```sql
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean LANGUAGE sql SECURITY DEFINER STABLE AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_profiles
    WHERE id = auth.uid() AND role = 'admin'
  );
$$;
```

**1-3. RLS 정책** (모든 테이블 `ENABLE ROW LEVEL SECURITY` 후 정책 부여). 패턴:
- `projects`, `quick_memos`, `user_settings` — 소유자(`user_id = auth.uid()`) CRUD + admin은 SELECT 전체.
- `processes`, `memos` — user_id가 없으므로 **소속 프로젝트 소유권**으로 판정:
  ```sql
  CREATE POLICY memos_rw ON memos USING (
    EXISTS (SELECT 1 FROM projects p
            WHERE p.id = memos.project_id
              AND (p.user_id = auth.uid() OR public.is_admin()))
  );
  ```
- `categories` — SELECT: `user_id IS NULL OR user_id = auth.uid() OR is_admin()`. 공용(대/중, user_id NULL) 쓰기: `is_admin()`. 개인(소분류) 쓰기: `user_id = auth.uid()`.
- `user_profiles` — 본인 read/update, admin 전체 read.

> 완성된 SQL 전문은 구현 시 `supabase/migrations/` 하위에 별도 파일로 작성.

---

## Phase 2 — 기존 데이터 마이그레이션

현재 데이터는 단일 uid 아래 `username`으로만 구분됨. 사용자별 계정으로 재귀속.

1. **관리자가 사용자별 Auth 계정 생성**: 관리자 1명 + `SELECT DISTINCT username FROM projects` 각각에 대해 계정 생성. `service_role` 키를 쓰는 1회용 Node 스크립트(`scripts/provision-users.mjs`)로 `admin.createUser()` 호출, `username → 새 uid` 매핑 산출.
2. **소유권 재지정**:
   ```sql
   UPDATE projects    SET user_id = :new_uid WHERE username = :username;
   UPDATE quick_memos SET user_id = :new_uid WHERE username = :username;
   -- processes/memos는 project_id로 따라가므로 변경 불필요
   ```
3. **프로필 세팅**: 각 uid에 `user_profiles(id, username, email, role)` upsert. 관리자 계정만 `role='admin'`.
4. **분류**: 기존 대/중분류는 `user_id = NULL` 유지(공용).

> 반드시 **DB 사본에서 리허설** 후 운영 반영.

---

## Phase 3 — 데스크탑(v3): 계정 통합 + 소분류 관리

**3-1. 로그인 = Supabase 계정으로 통일**
- 로그인 성공 후 `user_profiles`에서 `username`을 읽어 `currentUsername`에 반영 (파일: `v3/src/main/ipcHandlers.js` 로그인 핸들러, `v3/src/main/supabase.js` `auth.signIn`).
- `auth.signIn` 반환값에 `username`, `role` 추가. 앱 시작 시 `restoreSession` 후에도 동일 세팅.
- 관리자 배포 편의를 위해 로그인 UI(`v3/src/renderer/login/`)에서 이메일/비번 입력을 받도록 정리(기존 PIN 방식은 유지하되 각 로컬 사용자를 Supabase 계정에 매핑).

**3-2. 소분류(level 3) 분류관리** — 데이터 모델은 이미 `parent_id`+`level` 지원(추가 스키마 불필요).
- `db.categories.create`는 그대로 사용. `create-category` IPC와 `sync.category`에 **`user_id` 전달** 추가(소분류만 currentUid, 대/중분류는 null). 파일: `v3/src/main/db.js`, `v3/src/main/ipcHandlers.js` L67-70, `v3/src/main/supabase.js` `sync.category` L134-144.
- 분류관리 트리 UI 확장 — `renderCategoryTree()`(`dashboard.js` L1781)에서 각 중분류(level 2) 아래에 level 3 자식 목록 + "＋ 소분류 추가" 버튼 렌더. `openCatDialog(parentId, 3)` 재사용, 다이얼로그 타이틀에 "소분류 추가" 케이스 추가(L1768). 저장 시 `level:3` 전달(L1829).
- **프로젝트 생성/수정 다이얼로그**: 중분류 선택 시 그 아래 소분류 드롭다운을 채워 최종 `category_id`로 선택 가능하게(`dashboard.js` L328-365, L573-612 대분류→중분류 로직에 3단계 확장). 소분류는 본인 것 + 공용만 노출.
- `getCategoryBreadcrumb`(L155)는 parent 체인을 따라가므로 3단계 자동 지원.

**3-3. pull/sync 정합성**
- `pull.all()`(`supabase.js` L352)의 categories 조회는 `select('*')` → RLS가 공용+본인 소분류로 자동 제한되므로 코드 변경 최소. sync.category 업서트에 user_id만 반영.

---

## Phase 4 — 모바일 웹: 관리자 현황 페이지

**4-1. 일반 사용자 페이지** — RLS 적용 시 세션 사용자 기준으로 자동 격리됨. 각 조회가 명시적 `user_id` 하드코딩 없이 세션 기반인지 점검(`mobile/app/(app)/*Client.tsx`, `mobile/lib/supabase*.ts`). 필요 시 불필요한 수동 필터 제거.

**4-2. `/admin` 신규 라우트** (읽기 전용 집계 대시보드)
- 경로: `mobile/app/admin/page.tsx` (+ `AdminClient.tsx`). 진입 시 `user_profiles.role !== 'admin'`이면 리다이렉트/차단.
- admin RLS 정책 덕분에 전체 `projects`/`processes`/`quick_memos` 조회 가능. 집계 항목:
  - 사용자별 프로젝트 수(상태별: 대기/진행중/완료/청구완료)
  - 사용자별 공정 완료율, 임박 마감(D-7) 목록
  - 전체 요약 카드 + 사용자별 드릴다운
- 타입은 `mobile/lib/types.ts` 재사용(+`Category.user_id`, `role` 필드 보강).

---

## Phase 5 — 계정 배포 워크플로우 (운영)

- 관리자가 새 사용자 추가 시: `scripts/provision-users.mjs`(service_role) 또는 Supabase 대시보드에서 Auth 계정 생성 → `user_profiles` 행 생성(username/email/role) → 사용자에게 이메일/초기비번 전달.
- 사용자는 데스크탑/모바일에서 해당 이메일/비번으로 로그인.

---

## 영향 파일 요약

| 영역 | 파일 |
|------|------|
| 스키마/RLS/마이그레이션 | `supabase/migrations/*.sql`(신규), `scripts/provision-users.mjs`(신규) |
| 데스크탑 인증 | `v3/src/main/supabase.js`, `v3/src/main/ipcHandlers.js`, `v3/src/renderer/login/*` |
| 데스크탑 소분류 | `v3/src/main/db.js`, `v3/src/renderer/dashboard/dashboard.js`(L1764~1835, L328~365, L573~612) |
| 모바일 관리자 | `mobile/app/admin/page.tsx`(신규), `mobile/app/admin/AdminClient.tsx`(신규), `mobile/lib/types.ts` |

---

## 검증 (Verification)

1. **격리 테스트**: 테스트 계정 2명(A, B) + 관리자 1명 생성. 데스크탑에서 A/B 각각 로그인 → 각자 프로젝트 생성 → 서로의 프로젝트가 **안 보이는지** 확인.
2. **관리자 집계**: 웹 `/admin` 관리자 로그인 → A, B 모두의 프로젝트/현황이 취합돼 보이는지 확인. member 계정으로 `/admin` 접근 시 차단되는지 확인.
3. **분류**: 관리자가 중분류 추가 → 전원에게 보임. 사용자 A가 소분류(예: 건진법 아래 "동바리1차") 추가 → A에게만 보이고 B에게는 안 보임. 프로젝트에 소분류 지정 후 breadcrumb "점검 › 건진법 › 동바리1차" 표기 확인.
4. **마이그레이션 리허설**: DB 사본에서 Phase 2 실행 후 각 username 데이터가 올바른 계정으로 귀속됐는지 카운트 비교.
5. **동기화 회귀**: 데스크탑에서 만든 프로젝트/메모가 모바일 본인 계정에 실시간 반영되는지(SYNC-PLAN 경로) 확인.

---

## 리스크 / 주의

- **RLS 켜는 순간** 잘못된 정책은 데이터가 안 보이거나 저장 실패로 이어짐 → 반드시 사본에서 정책 검증 후 운영 적용.
- 데스크탑은 electron-store 로컬 캐시가 있어, 계정 전환 시 **로컬 데이터 초기화/재pull** 흐름 필요(계정 섞임 방지).
- `service_role` 키는 절대 클라이언트(앱)에 포함 금지 — provision 스크립트는 관리자 로컬에서만 실행.

---

## 다음 작업 착수 순서 (권장)

1. Phase 1 SQL을 사본 DB에서 검증 → 운영 적용
2. Phase 2 마이그레이션 리허설 → 운영 적용
3. Phase 3 데스크탑 소분류 UI (사용자 눈에 바로 보이는 기능, 리스크 낮음 → 먼저 해도 좋음)
4. Phase 3 로그인 통합
5. Phase 4 관리자 웹 페이지
