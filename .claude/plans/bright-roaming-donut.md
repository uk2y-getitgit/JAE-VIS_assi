# JAE-VIS v3 — Feature 2 (소분류 3단계 분류) / Feature 1 (팀원 계정·관리자 대시보드) 상세 설계

> 이 문서는 `.claude/skills/jae-vis-orchestrator/SKILL.md`와 `.claude/agents/orchestrator.md`가 참조하는
> "상세 설계" 문서다. 실제 코드(`v3/src/main/db.js`, `ipcHandlers.js`, `supabase.js`,
> `v3/src/renderer/dashboard/dashboard.js`, `v3/supabase-schema.sql`)를 조사해 작성했으며,
> SKILL.md의 기존 계획과 다른 부분은 **[SKILL.md 수정 필요]** 로 표시했다.

## 0. 조사로 확인한 현재 아키텍처 (중요 — 계획의 전제)

- **로컬 인증**: `db.js`의 `users` 는 `{id, name, pin(sha256 해시)}` 뿐. `role` 필드 없음. 로그인은
  이름 드롭다운 선택 + PIN 4자리 (`login.js`). (db.js:126-147)
- **클라우드 인증(Supabase)은 로컬 사용자와 완전히 분리된 별개 시스템**이다. `supabase.js`의
  `auth.signIn/signUp`은 **기기(설치본) 단위 1계정**이며, `currentUid`는 전역 변수 하나뿐이다
  (supabase.js:16-17, 87-95). 즉 지금 구조에서 "팀원 계정"은 Supabase Auth 계정이 아니라
  **로컬 `users` 레코드**를 의미한다.
- **RLS는 전부 `auth.uid() = user_id` 소유자 전용 정책**이다 (`supabase-schema.sql:133,149,153`).
  `projects.username`, `quick_memos.username` 컬럼은 이미 존재하며 로컬 사용자 이름을 그대로 저장한다
  (챗봇 호환용으로 이미 만들어둔 필드, supabase-schema.sql:28).
- → **사용자 결정(확정)**: 팀 전체가 **공유 Supabase 계정 1개**로 클라우드 연결한다(추천안 채택).
  이 경우 기존 RLS 정책은 전혀 손댈 필요가 없다 — 같은 `user_id`(uid) 아래 `username` 컬럼으로
  이미 팀원별 데이터가 구분되기 때문이다. **[SKILL.md 수정 필요]**: `user_profiles`를 팀원별로
  덮어써서 재사용하지 않는다 (그 테이블은 "공유 계정 자체의 프로필" 1행 전용으로 이미 설계되어
  있음). 대신 아래 3장에서 신규 `team_members` 테이블을 정의한다.
- **카테고리는 이미 완전히 범용적인 트리 구조**다: `parent_id` + `level` + `order_index`
  (db.js:150-191). `categories.getChildren(parentId)`는 level 무관하게 자식을 반환하고,
  `categories.create/update`도 임의 `data`를 그대로 merge한다. **level 3 소분류를 만드는 데
  DB 레이어 변경이 필요 없다.** `get-categories/create-category/update-category/delete-category`
  IPC 채널도 이미 범용적이라 **신규 IPC 채널이 필요 없다.** **[SKILL.md 수정 필요]**:
  `categories.getChildrenLevel3()` 신규 함수, `get-category-children` 신규 IPC 채널은
  불필요한 중복 — 기존 `categories.getChildren()` / `get-categories`를 그대로 재사용한다.
- **공정 템플릿은 이미 존재하지만 하드코딩**되어 있다: `dashboard.js:186-191`의
  `AUTO_PROCESS_TEMPLATES = { '계획서': [...], '시특법': [...], '관리법': [...] }` (분류
  **이름** 문자열 키로 매칭) + 건진법 전용 그룹 로직(`GUNJIN_SUB_ITEMS`, dashboard.js:27,
  611-621, 하위 그룹 계층 구조라 완전히 별개 흐름). 프로젝트 생성 시 `catName`으로 조회해서
  공정을 자동 생성한다 (dashboard.js:594-630).
- **v3/CLAUDE.md는 이 프로젝트와 무관한 문서**(다른 프로젝트의 JARVIS 스타일 템플릿)이므로
  설계 참조에서 제외했다.

---

## 1. Feature 2 — 소분류(level 3) + 공정 템플릿 UI화

### 1.1 목표
현재 이름 문자열로 하드코딩된 `AUTO_PROCESS_TEMPLATES`를,
**대분류 → 중분류 → 소분류(신규 level 3)** 트리에서 **소분류별로 사용자가 직접 편집 가능한
공정 템플릿**으로 대체한다. 건진법의 동적 그룹 입력 흐름은 구조가 근본적으로 다르므로
이번 범위에서 제외하고 그대로 유지한다.

### 1.2 데이터 모델
새 테이블/키를 만들지 않는다. **level-3 카테고리 레코드 자체에 필드를 추가**한다.

```js
// db.js categories.create()가 이미 받는 data를 그대로 사용
{
  id: 'cat_xxx',
  parent_id: 'cat_21',      // 중분류(level 2) id
  name: '정기점검',          // 소분류명
  level: 3,                  // 신규
  order_index: 0,
  template_processes: ['현장조사', '보고서작성', '제출', '청구'],  // 신규 필드, 순서 있는 배열
}
```

`categories.update(id, { template_processes: [...] })` 로 템플릿만 수정 — 기존 함수 그대로 사용.

### 1.3 DB / IPC 레이어 — **신규 코드 없음 (재사용만)**
- `db.js`: 변경 없음. `categories.create/update/getChildren/getAll`이 이미 level 3 +
  `template_processes`를 그대로 통과시킨다.
- `ipcHandlers.js` / `preload.js`: 변경 없음. `create-category`, `update-category`,
  `get-categories`를 그대로 쓴다.
- 단, `create-category`/`update-category` 핸들러는 이미 `fireSync(() => cloud.sync.category(...))`
  를 호출한다 (ipcHandlers.js:69,75). `cloud.sync.category()`가 `template_processes`를
  Supabase에 올리도록 **payload에 필드 추가**가 필요하다 (아래 1.5).

### 1.4 UI 변경 (`dashboard.js` / `dashboard.html` / `dashboard.css`) — 이번 Feature의 실제 작업량
1. **`renderCategoryTree()` 확장** (dashboard.js:1775-1813): 중분류(`cat-l2-item`) 옆에
   "공정템플릿 ✎" 버튼 추가 → `openTemplatePanel(cat2Id, cat2Name)`.
2. **`openTemplatePanel(cat2Id, cat2Name)` 신규 함수**: 모달에서
   - 해당 중분류의 소분류 목록(`allCategories.filter(c => c.parent_id === cat2Id && c.level === 3)`) 표시
   - 소분류 추가/삭제 (`createCategory({parent_id: cat2Id, level: 3, name})` / `deleteCategory`)
   - 소분류 선택 시 그 소분류의 `template_processes` 배열을 텍스트 리스트(줄 단위 입력, 이미
     건진법 다중 항목 입력에 쓰는 `createProcItemRow` 패턴 재사용 가능)로 편집 → 저장 시
     `updateCategory(cat3Id, { template_processes })`
3. **`dashboard.html`**: `catDialog` 근처에 `templatePanel` 오버레이 dialog 신규 마크업 추가
   (기존 dialog-overlay 패턴 그대로 사용, dashboard.html:712 참조).
4. **프로젝트 생성 다이얼로그 확장** (`dlgCat1`/`dlgCat2`, dashboard.js:328-336, 566-584):
   중분류 선택 시 소분류 드롭다운(`dlgCat3`, 신규 `<select>`)을 추가로 채운다. 소분류가 없는
   중분류는 기존처럼 중분류 자체가 `category_id`가 된다(하위 호환).
5. **`btnDlgSave` 자동공정 로직 교체** (dashboard.js:610-629):
   - 우선순위: `category_id`가 level-3이고 `template_processes`가 있으면 그것으로 공정 생성.
   - **레거시 폴백**: level-3 템플릿이 없는 경우(기존 프로젝트/기존 분류) 기존
     `AUTO_PROCESS_TEMPLATES[catName]` 이름 매칭 로직을 그대로 둔다 — 기존 데이터를 깨지
     않기 위한 하위 호환. 건진법 분기는 그대로 유지.
6. **`dashboard.css`**: `cat-l2-item`에 템플릿 버튼 스타일, 템플릿 패널 모달 스타일 추가.

### 1.5 Supabase 스키마 변경
`categories` 테이블에 컬럼 추가 (사용자가 Supabase SQL Editor에서 1회 실행):
```sql
ALTER TABLE categories ADD COLUMN IF NOT EXISTS template_processes JSONB DEFAULT NULL;
```
`supabase.js`의 `sync.category()` (supabase.js:134-144)와 `sync.bulkUpload()`의 categories
매핑(supabase.js:276-279)에 `template_processes: cat.template_processes || null` 필드 추가.

### 1.6 검증 시나리오
1. 설정 > 분류관리 → 중분류(예: "시특법") 옆 "공정템플릿 ✎" 클릭 → 패널 오픈
2. 소분류 "정기점검" 추가 → 템플릿에 공정명 3~4개 입력 → 저장
3. 새 프로젝트 등록 → 시특법 > 정기점검 선택 → 저장 → 공정 목록에 템플릿 항목이 순서대로 생성됐는지 확인
4. 기존 방식대로 소분류 없이 중분류만 선택한 프로젝트를 생성해 레거시 `AUTO_PROCESS_TEMPLATES`
   경로가 여전히 동작하는지 확인 (회귀 방지)

---

## 2. Feature 1 — 팀원 계정 / 관리자 대시보드

### 2.1 인증 모델 (확정)
팀 전체가 **공유 Supabase 계정 1개**로 클라우드 연결한다. 로컬 로그인(이름+PIN)은 그대로 유지된다.
"팀원 계정"은 **로컬 `users` 레코드 + role**을 의미하며, 관리자가 팀원을 등록하면
그 정보가 공유 계정 아래 클라우드에 동기화되어 **다른 기기에서도 팀원 목록을 볼 수 있게** 한다.

### 2.2 로컬 스키마 변경 (`db.js`)
```js
users.create(name, pin, role = 'member')  // role 파라미터 추가
```
- 마이그레이션: `initializeData()`에 기존 users에 `role: 'member'` 없으면 채우고,
  **가장 먼저 생성된 사용자(createdAt 최소)를 'admin'** 으로 지정 (1회성, 플래그로 재실행 방지 —
  기존 `categoriesV2` 패턴과 동일하게 `usersRoleV1` 플래그 사용).
- `users.getAll()`이 `role`도 반환하도록 수정 (현재 `{id, name}`만 반환, db.js:127).
- 신규: `users.setRole(id, role)`, `users.getAllWithRole()` (또는 `getAll()` 자체에 role 포함해도 됨 —
  기존 호출부가 `role`을 쓰지 않으므로 하위 호환 안전. **`getAll()`을 그대로 확장**하는 편을 권장,
  별도 함수 안 만들어도 됨. **[SKILL.md 단순화]**).

### 2.3 신규 IPC 채널 (`ipcHandlers.js` + `preload.js`)
| 채널 | 동작 |
|---|---|
| `create-team-member` | `db.users.create(name, pin, role)` 호출 → `fireSync(() => cloud.sync.teamMember({...}))` |
| `get-team-members` | `db.users.getAll()` (role 포함) + 각 팀원의 프로젝트 통계(`db.projects.getAll(username).length`, 상태별 카운트) 조합 반환 |
| `cloud-pull-team-members` | `cloud.pull.teamMembers()` 로 클라우드의 `team_members` 전체를 가져와, 로컬에 없는 이름은 임시 PIN(`'0000'`, `needsPinReset:true`)으로 로컬 `users`에 생성 |

`preload.js`에 `createTeamMember`, `getTeamMembers`, `cloudPullTeamMembers` 노출.

### 2.4 Supabase 스키마 (신규 테이블, 기존 테이블/RLS 변경 없음)
`user_profiles`는 "공유 계정 자체의 프로필 1행" 전용으로 이미 설계돼 있어 재활용하지 않는다
(재활용 시 `id = auth.uid()` PK 제약과 충돌). **신규 테이블**:
```sql
CREATE TABLE IF NOT EXISTS team_members (
  id         TEXT PRIMARY KEY,        -- 로컬 db.js generateId('user') 값 그대로 재사용
  owner_uid  UUID REFERENCES auth.users ON DELETE CASCADE NOT NULL,
  username   TEXT NOT NULL,
  role       TEXT DEFAULT 'member',   -- 'admin' | 'member'
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(owner_uid, username)
);
ALTER TABLE team_members ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own_team_members" ON team_members
  FOR ALL USING (auth.uid() = owner_uid);
CREATE INDEX IF NOT EXISTS idx_team_members_owner ON team_members(owner_uid);
```
`supabase.js`에 추가:
```js
sync.teamMember(tm)   // upsert to team_members, onConflict: 'id'
pull.teamMembers()    // select * from team_members where owner_uid = currentUid
```

### 2.5 `login.js` 변경
- 기존 이름+PIN 검증 흐름은 **변경하지 않는다**.
- 앱 시작 시 (`getUsers()` 호출 직전) `cloud.isReady()`면 **먼저 `cloudPullTeamMembers()`를
  조용히 시도**해서 로컬에 없는 팀원을 자동 프로비저닝한 뒤 사용자 목록을 렌더링한다.
  실패해도 로그인 화면은 정상 동작해야 한다(오프라인 대비, try/catch로 무시).
  **[SKILL.md 수정]**: "Supabase fallback 인증"이 아니라 "로그인 화면 진입 전 팀원 목록 동기화"로
  정정 — PIN 인증 자체는 로컬에서만 이루어진다(공유 계정 모델에서는 Supabase Auth 자체가
  개인별이 아니므로 인증 fallback 대상이 될 수 없음).

### 2.6 `dashboard.js` / `dashboard.html` / `dashboard.css` — 관리자 대시보드
1. 로그인 성공 시 `currentUserRole = db.users 조회 결과.role` 저장(메인 프로세스 `currentUsername`과
   함께 렌더러로 전달 — `onSetUser` 콜백 페이로드에 role 포함하도록 IPC 확장).
2. 사이드바에 `nav-item data-page="team"` "팀 현황" 탭 추가 — **role !== 'admin'이면 렌더링 자체를
   생략**(dashboard.html:32-64 nav-item 목록 근처).
3. `dashboard.html`에 `<section class="page" id="page-team">` 신규(dashboard.html:294 `page-settings`
   패턴 참고): 팀원 목록 테이블(이름/역할/프로젝트 수/진행중/완료), "+ 팀원 추가" 버튼.
4. `renderTeamDashboard()` 신규 함수: `getTeamMembers()` 호출 → 테이블 렌더링.
5. 팀원 추가 다이얼로그: 이름/PIN/역할(admin·member) 입력 → `createTeamMember()` 호출.
6. `dashboard.css`: 팀 현황 테이블/역할 배지 스타일 추가.

### 2.7 검증 시나리오
1. 최초 사용자로 로그인 → role이 자동으로 'admin'인지 확인(마이그레이션)
2. admin 로그인 → 사이드바 "팀 현황" 탭 노출 확인
3. 팀 현황 탭 > 팀원 추가(이름/PIN/역할=member) → 로컬 `users`와 Supabase `team_members`
   양쪽에 등록됐는지 확인
4. 신규 팀원 role로 로그인 → "팀 현황" 탭이 보이지 않는지 확인
5. (클라우드 연결된 두 번째 기기 시뮬레이션 가능하면) 다른 기기에서 로그인 화면 진입 시
   `cloudPullTeamMembers()`로 방금 추가한 팀원이 로컬 사용자 목록에 나타나는지 확인

---

## 3. 실행 순서 (오케스트레이터 Phase 갱신)

Feature 2는 DB/IPC 신규 작업이 없으므로 **data-agent/ipc-agent 단계를 건너뛰고 ui-agent부터
시작**한다 (Supabase 컬럼 추가 SQL은 사용자가 직접 1회 실행하거나 data-agent가 안내 문구로 제공).

```
[Feature 2]
  → (data-agent 생략 — 재사용) Supabase categories.template_processes 컬럼 SQL 안내만 제공
  → (ipc-agent 생략 — 재사용, sync.category() payload 필드 1줄만 추가는 data-agent가 겸함)
  → ui-agent   (템플릿 패널 + 소분류 드롭다운 + 자동공정 로직 교체)
  → validate-agent

[Feature 1]
  → data-agent  (users.role 마이그레이션, team_members 테이블 SQL, supabase.js sync/pull 함수)
  → ipc-agent   (create-team-member / get-team-members / cloud-pull-team-members + preload)
  → ui-agent    (login.js 동기화 훅, 팀 현황 페이지, role 기반 사이드바 분기)
  → validate-agent
```

## 4. 리스크 / 열린 이슈

- **[해결됨 — 2026-07-14] 멀티 PC 배포 시 "최초 계정 = admin" 규칙의 허점**
  (2026-07-14 실기기 검증 중 사용자 질문으로 발견, 같은 날 수정 완료):
  `db.js`의 `users.create()`에 있는 "시스템 최초 계정은 무조건 admin" 규칙(로컬 스토어 신규
  설치 시 아무도 admin이 될 수 없는 문제를 막기 위해 추가함)은 **PC(로컬 electron-store)
  단위로 판단**한다. 관리자가 자기 PC에서 가입해 admin이 된 뒤, 이 앱을 다른 직원 PC에
  배포하면 — 그 직원의 로컬 `users`도 비어있는 상태이므로 "신규 등록"으로 계정을 만드는 순간
  **그 PC 안에서는 그 직원도 admin이 되어버린다.**
  **근본 원인**: `cloudPullTeamMembers()`(로그인 화면 진입 시 팀원 로스터를 클라우드에서
  당겨오는 로직, login.js)는 `cloud.isReady()`(Supabase 연결+인증 완료) 상태여야 실행되는데,
  Supabase 연결/인증은 대시보드 안의 **설정 페이지**에서만 가능하고, 설정 페이지는 로그인해야만
  들어갈 수 있다 — 즉 "로그인 전에 팀원 여부를 확인할 방법이 없는" 닭-달걀 문제.
  **해결 방향(사용자와 논의됨, 아직 미구현)**: `login.html`/`login.js`에 로컬 계정 생성 전
  단계로 클라우드 연결 옵션(Supabase URL/Anon Key/이메일/비밀번호 입력 → 인증 →
  `cloudPullTeamMembers()` 선실행)을 추가한다. 이 인증이 성공한 적 있는 PC에서만
  "신규 등록 = admin" 폴백을 비활성화하거나, 애초에 클라우드 연결 이력이 있는 PC는 로컬
  "신규 등록" 자체를 감추고 클라우드 팀원 목록에만 의존하도록 한다.
  **사용자 결정**: Supabase 설정을 먼저 마친 뒤, 실제 배포 전에 이 부분을 수정하기로 함.
  **적용된 수정**:
  1. `db.js` `users.create()`: 최초 계정 자동 admin 승격 조건을 `list.length === 0` 단독 판단에서
     `list.length === 0 && !store.get('settings', {}).supabaseUrl`로 변경 — 클라우드 연결 이력이
     있는 PC(로컬 users가 비어 있어도)는 더 이상 자동 admin 승격되지 않음. `create-team-member`/
     `cloud-pull-team-members`처럼 role을 명시적으로 넘기는 호출은 영향 없음.
  2. `login.html`/`login.js`/`login.css`: 로컬 users가 비어있고 이 PC가 클라우드에 연결된 적이
     없을 때만 "이 PC에서 처음 사용하시나요?" 설치 게이트(`#setupGate`)를 표시. "이미 사용 중인
     팀에 합류합니다" 선택 시 클라우드 연결 폼(`#cloudConnectGate` — URL/anon key/이메일/비밀번호,
     기존 `cloud-connect`/`cloud-pull-team-members` IPC 재사용)으로 전환해 팀원 로스터를 먼저
     받아온 뒤 로그인 탭으로 진입. "첫 설치입니다" 선택 시 기존 신규 등록 흐름 그대로 진행.
  3. 신규 IPC 채널 없음 — 기존 `cloud-connect`/`cloud-pull-team-members`/`cloud-get-status`/
     `get-users` 채널만 재사용.
  검증: `_workspace/validate-agent-result-loginfix.md` — 정적 검증 전체 PASS, 실기기(`npm start`)로
  기존 PC 재실행 회귀 없음 확인. 신규 PC의 게이트 최초 노출·클라우드 연결 플로우는 실기기 조건상
  미검증(코드 정적 검토로만 확인) — 실제 배포 전 팀원 PC 또는 초기화한 테스트 환경에서 1회 육안
  확인 권장.

- **PIN 배포**: `cloud-pull-team-members`로 프로비저닝된 신규 로컬 계정의 임시 PIN(`'0000'`)을
  팀원에게 어떻게 전달할지는 운영 절차(구두 전달 등)로 남겨둠 — 자동 이메일 발송 등은 범위 밖.
  참고: 로컬 users.create()는 4자리 숫자만 허용하므로 `'0000'`을 그대로 사용해도 통과된다
  (db.js:132 정규식 `/^\d{4}$/`).
- **소분류 삭제 시 프로젝트 영향**: `categories.delete()`는 하위 분류까지 재귀 삭제하지만
  프로젝트의 `category_id`는 그대로 남는다(고아 참조, db.js:182-183 주석에 "ID 기반 참조이므로
  프로젝트 데이터는 영향 없음"이라 명시돼 있어 기존 설계 그대로 따름 — 별도 처리 불필요).
- **건진법 특수 흐름**은 이번 Feature 2 범위에서 제외(그룹 계층 구조 재설계는 별도 논의 필요).
