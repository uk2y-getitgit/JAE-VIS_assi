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
| 2026-07-14 | "팀 진행 현황 대시보드" 신규 추가 + 관련 안전장치 | supabase.js, ipcHandlers.js, preload.js, dashboard.css/html/js | 관리자가 각 팀원의 프로젝트 보유 건수·진행 단계를 조회하고, 프로젝트 클릭 시 기존 "전체현황"과 동일한 상세 모달(소분류 그룹 드릴인 + 일정표)을 열람할 수 있는 신규 사이드바 메뉴. 데이터는 Supabase에서 팀 전체(공유 계정) 프로젝트+공정을 그 자리에서 조회(`cloud.pull.teamProjects/projectMemos`, `get-team-progress`/`get-team-project-memos` IPC 신규) — 로컬 store에는 쓰지 않음. 열람 시 편집/공정추가/상태변경/삭제는 막고 메모 작성만 허용(`teamModalMode` + `applyTeamReadOnlyLock`). 건진법류(공정 그룹 "동바리1차" 등)가 있는 프로젝트는 카드 요약에서 진행중인 그룹만 대표 표시(`buildMiniStepper`). 기존 "팀 현황" 요약 탭은 그대로 유지, 신규 메뉴로 별도 공존. 부수적으로 `cloud-migrate`(설정 페이지 "데이터 업로드")는 분류(카테고리) 트리를 admin만 올리도록 가드 추가(팀원 PC가 각자 업로드 시 소분류 랜덤 ID 중복 방지), 로그인 시 2초 후 클라우드 준비돼 있으면 자동으로 로컬→클라우드 재동기화(`autoResyncOnLogin`)해 오프라인 중 놓친 변경사항을 캐치업. 계약금액/청구액/수금액, 담당자별 프로젝트 이관 기능은 이번 범위에서 보류. |
