# JAE-VIS 프로젝트 지침

## 하네스: JAE-VIS 기능 구현

**목표:** Feature 2(소분류 3단계 분류) + Feature 1(팀원 계정/관리자 대시보드) 구현을 에이전트 팀으로 자동화

**트리거:** 소분류, 공정 템플릿, 팀원 로그인, 관리자 대시보드, 팀 현황, Feature 1, Feature 2 등 신규 기능 구현 요청 시 `jae-vis-orchestrator` 스킬을 사용하라. 단순 버그 수정·조회 질문은 직접 응답 가능.

**계획 파일:** `.claude/plans/bright-roaming-donut.md` (상세 설계)

**변경 이력:**
| 날짜 | 변경 내용 | 대상 | 사유 |
|------|----------|------|------|
| 2026-07-14 | 초기 하네스 구성 | 전체 | Feature 1, 2 구현 준비 |
| 2026-07-14 | Feature 1/2 구현 완료 + 실기기 검증 (npm start) | 전체 | 소분류/공정템플릿, 팀원/관리자 대시보드 1차 구현. 검증 중 "최초 계정=admin" 규칙이 PC 단위로 동작해 멀티 PC 배포 시 보안 허점 있음을 발견 — 미수정 상태로 `.claude/plans/bright-roaming-donut.md` 4장에 다음 작업으로 기록 |
| 2026-07-14 | 멀티 PC "최초 계정=admin" 보안 허점 수정 | db.js, login.html/js/css | Supabase 설정 완료 후 착수. 클라우드 연결 이력 있는 PC는 로컬 users가 비어있어도 자동 admin 승격 안 되도록 db.js 수정 + 로그인 화면에 "팀 합류 vs 첫 설치" 설치 게이트 추가(신규 IPC 없이 기존 cloud-connect/cloud-pull-team-members 재사용). 상세: `.claude/plans/bright-roaming-donut.md` 4장, `_workspace/*-loginfix.md` |
| 2026-07-15 | 공정 자동생성 템플릿 설정창 편집 + 항목(그룹) 전 분류 확대 (v4.2.0 빌드) | db.js, dashboard.css/html/js, package.json | **(1) 템플릿 편집**: 렌더러에 하드코딩돼 있던 분류별 자동생성 공정(`AUTO_PROCESS_TEMPLATES` 상수, 이름 문자열 키)을 제거하고 카테고리의 `template_processes`로 이관(`catTemplatesV2` 마이그레이션이 계획서/건진법/시특법/관리법 시드, 검토·기타는 빈 상태). 해석은 이름이 아닌 ID로 소분류→중분류→대분류를 거슬러 올라가며 첫 템플릿을 쓰는 `resolveTemplate()` 폴백 — 분류 이름을 바꿔도 자동생성이 안 끊김. 설정창 분류 트리의 **대분류 행에도** 공정템플릿 버튼 추가(기존엔 중분류만), 패널 상단에 "이 분류의 기본 공정" 편집기 신설. admin만 편집(`currentUserRole`). **(2) 항목 범용화**: 항목(그룹)은 원래 데이터 모델(`is_group`/`parent_id`)상 이미 범용이었고 `calcStatus`·`buildMiniStepper`도 구조 기반이었는데, 렌더러의 `isGunjinProject()`(분류명='건진법')가 6곳(공정목록/일정표×2/이번주/완료공정/항목추가)에서 게이트 역할을 하고 있었음 → 구조 판정 `usesGroups(procs)`로 교체. 이로써 모든 분류에서 항목 사용 가능 + 비건진법 프로젝트에 그룹이 생기면 일정표·완료공정이 깨지던 잠재 버그도 해소(실데이터 15개 프로젝트/118개 그룹에서 이름판정↔구조판정 불일치 0건 확인). 같은 프로젝트에서 공정 세트가 반복될 때(시특법 상반기/하반기, 계획서 보완작성) 기존 공정을 체크박스로 골라 항목으로 **묶기**, 분류 템플릿이 미리 채워진 **항목 추가**, 데이터를 남기는 **풀기**(⛓)와 하위까지 지우는 **삭제**(🗑) 분리. `GUNJIN_SUB_ITEMS` 상수도 건진법 분류 템플릿으로 통합('계약'은 항목 밖 공통공정이라 하드코딩 유지). **(3) 발견/수정한 문제**: 건진법+소분류 선택 시 그룹 입력칸이 떠도 저장은 그룹을 안 만들던 기존 UI 거짓말 수정. 항목명 입력에 `window.prompt()`를 썼다가 Electron 미지원으로 묶기가 무반응이던 것을 다이얼로그 재사용(`groupDialogMode` create/wrap)으로 수정 — **Electron에서 prompt()는 예외를 던지므로 절대 쓰지 말 것**. 검증은 격리된 `--user-data-dir`로 앱을 띄워 CDP(`ws`)로 묶기→항목추가→풀기 전 플로우를 실제 실행(실데이터 무영향 확인). **(4) 미해결**: Supabase `categories.template_processes` 컬럼이 실제 DB에 없어 템플릿이 클라우드 동기화 안 됨(`supabase-schema.sql` 하단에 주석 처리된 수동 ALTER가 실행된 적 없었음, `logError`가 삼켜 조용히 실패). 사용자가 2026-07-15 SQL 실행 완료. |
| 2026-07-14 | "팀 진행 현황 대시보드" 신규 추가 + 관련 안전장치 | supabase.js, ipcHandlers.js, preload.js, dashboard.css/html/js | 관리자가 각 팀원의 프로젝트 보유 건수·진행 단계를 조회하고, 프로젝트 클릭 시 기존 "전체현황"과 동일한 상세 모달(소분류 그룹 드릴인 + 일정표)을 열람할 수 있는 신규 사이드바 메뉴. 데이터는 Supabase에서 팀 전체(공유 계정) 프로젝트+공정을 그 자리에서 조회(`cloud.pull.teamProjects/projectMemos`, `get-team-progress`/`get-team-project-memos` IPC 신규) — 로컬 store에는 쓰지 않음. 열람 시 편집/공정추가/상태변경/삭제는 막고 메모 작성만 허용(`teamModalMode` + `applyTeamReadOnlyLock`). 건진법류(공정 그룹 "동바리1차" 등)가 있는 프로젝트는 카드 요약에서 진행중인 그룹만 대표 표시(`buildMiniStepper`). 기존 "팀 현황" 요약 탭은 그대로 유지, 신규 메뉴로 별도 공존. 부수적으로 `cloud-migrate`(설정 페이지 "데이터 업로드")는 분류(카테고리) 트리를 admin만 올리도록 가드 추가(팀원 PC가 각자 업로드 시 소분류 랜덤 ID 중복 방지), 로그인 시 2초 후 클라우드 준비돼 있으면 자동으로 로컬→클라우드 재동기화(`autoResyncOnLogin`)해 오프라인 중 놓친 변경사항을 캐치업. 계약금액/청구액/수금액, 담당자별 프로젝트 이관 기능은 이번 범위에서 보류. |
