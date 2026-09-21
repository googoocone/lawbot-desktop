# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 프로젝트 개요

**law-bot 사건관리 프로그램** — 한국 법률사무소(개인회생/파산)용 사건관리 데스크탑 앱.
법원 "나의사건검색" 사이트를 크롤링해 사건 진행내역·보정명령·기한을 자동 추적한다.

구성:

1. **프론트엔드** (`src/`) — React 19 + TypeScript + Vite 7 + Tailwind CSS 4
2. **Tauri 셸** (`src-tauri/`) — Tauri 2 (Rust). 로컬 SQLite, 자동시작 담당

크롤링은 **중앙 크롤러 서버**(별도 레포 `lawbot-crawler`, `VITE_CRAWLER_URL`)가 담당한다. 매일 KST 22:00 자동 전체 크롤링 + 앱에서 HTTP 트리거(`src/lib/crawler.ts`). 과거 사이드카 방식의 잔재인 `python-crawler/` 폴더와 `src-tauri/binaries/`는 더 이상 사용·번들되지 않는다.

## 명령어

패키지 매니저는 **pnpm** (npm 아님).

```powershell
pnpm install            # 의존성 설치
pnpm tauri dev          # 데스크탑 앱 개발 모드 (Vite + Tauri 동시 실행, 포트 1420)
pnpm tauri build        # 프로덕션 빌드 (tsc → vite build → Rust 빌드 → 인스톨러)
pnpm build              # tsc + vite build만 (타입체크 겸용 — 테스트/린터 없음, 이게 유일한 검증)
```

- `pnpm dev` (Vite 단독)는 Tauri API(`plugin-sql`, sidecar 등)가 없어 로그인 후 동작하지 않음 — 반드시 `pnpm tauri dev` 사용.
- 테스트 프레임워크·ESLint 설정 없음. 변경 검증은 `pnpm build`(tsc) 통과 + 실제 실행.

### 환경변수

루트 `.env` (`.env.example` 참고):
- `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` — Supabase
- `VITE_CRAWLER_URL` — 중앙 크롤러 서버 주소 (인증은 로그인 세션의 Supabase JWT를 Bearer로 전송 — 앱에 공유 시크릿을 넣지 않는다)

## 아키텍처

### 데이터 흐름 (핵심)

**Supabase = 진실의 원천(source of truth), 로컬 SQLite = 읽기용 미러.**

```
[읽기]  SQLite (caseflow.db) → React state
[쓰기]  Supabase 먼저 mutation → 성공 시 SQLite에도 반영 (src/lib/actions/local.ts)
[동기화] 로그인 시 syncAll() 풀 싱크 (src/lib/sync.ts, 테이블별 last_synced_at 증분)
[실시간] Supabase Realtime postgres_changes 구독 → SQLite upsert/delete → UI 리로드 (src/lib/realtime.ts)
[크롤러] 중앙 서버에 HTTP 트리거 (src/lib/crawler.ts → POST /trigger/case·/trigger/batch) → 서버 크롤러가 Supabase에 직접 쓰기(service_role) → Realtime으로 앱에 반영. 매일 KST 22:00 서버가 자동 전체 크롤링.
```

- Supabase 테이블: `cf_cases`, `cf_case_corrections`, `cf_correction_extensions`, `cf_notifications`, `cf_crawl_logs`, `profiles`, `law_firms`. 스키마·트리거·RLS 원본은 웹앱 레포 `../flow/supabase/migrations/`.
- 가시성(RLS, `20260921_staff_case_visibility.sql`): 관리자(super_admin/firm_admin)는 firm 전체, staff는 `assigned_to = 본인` 사건만 SELECT. 로컬 미러에도 그만큼만 내려온다. `src/lib/caseflow/visibility.ts`는 2차 안전망(fail-closed). staff가 firm 전체를 봐야 하는 채번·중복검사는 SECURITY DEFINER RPC(`cf_next_seq_number`, `cf_find_duplicate_cases`)로 처리하고, RPC 미배포 시 직접 조회로 폴백한다.
- 로컬 SQLite 테이블은 **`cf_` 접두사가 없음** (`cases`, `case_corrections`, `correction_extensions`, `profiles`, `notifications`, `sync_state`). 스키마는 `src-tauri/migrations/*.sql`.
- **스키마 변경 시 4곳을 함께 수정**: ① Supabase(원격), ② `src-tauri/migrations/`에 새 마이그레이션 SQL 추가 + `src-tauri/src/lib.rs`의 migrations vec에 등록 (기존 마이그레이션 수정 금지, 버전 증가), ③ `src/lib/sync.ts`의 컬럼 목록, ④ `src/lib/realtime.ts`의 upsert 컬럼 목록.

### 프론트엔드 구조

- **라우터 없음.** `src/App.tsx`의 `View` 유니언(`list | changes | calendar | register | notices | detail | edit`) state로 화면 전환. 전역 상태는 App.tsx의 useState로 관리 (라우터·상태관리 라이브러리 없음)
- `src/components/layout/MainShell.tsx` — 헤더(탭, 동기화 버튼, 실시간 상태, 알림벨, 설정) 래퍼
- 주요 페이지: `CaseScheduleDashboard`(목록·통계), `CalendarPage`(기한/기일 달력), `RegisterPage`(단건+엑셀 일괄등록, 등록 후 크롤러 자동 호출), `CaseDetailPage`, `CaseEditPage`
- 도메인 로직: `src/lib/caseflow/` — `types.ts`(CaseStatus/CorrectionStatus 등), `case-row.ts`(목록용 비정규화 뷰), `calendar-events.ts`, `constants/`(법원 매핑, 상태 라벨/색), `utils/`(날짜, 보정 표시)
- 스타일: Tailwind 유틸리티 클래스 인라인만 사용(커스텀 CSS 없음), 아이콘은 lucide-react
- import alias: `@/` → `src/`

### 중앙 크롤러 서버 (별도 레포 `lawbot-crawler`)

- FastAPI + APScheduler. 엔드포인트: `GET /health`, `GET /status`(배치 진행률 포함), `POST /trigger`(전체), `POST /trigger/case`, `POST /trigger/batch`(큐잉). `/trigger/case`·`/trigger/batch`는 `Authorization: Bearer <Supabase 사용자 JWT>`(서버가 Supabase Auth에 검증 + 사건의 firm 일치 확인) 또는 `CRON_SECRET`. `/trigger`(전체)는 `CRON_SECRET` 전용.
- Selenium + Gemini 캡차 인식, SOCKS5 프록시 로테이션, service_role로 Supabase 직접 쓰기.
- 탐지 로직(diff/correction/status/notification)은 서버 레포가 원본. 로컬 `python-crawler/`는 구버전 잔재 — 수정하지 말 것.

### Tauri 셸 (`src-tauri/`)

- Rust 커스텀 커맨드 없음 — 플러그인만 사용: `tauri-plugin-sql`(sqlite, 마이그레이션), `tauri-plugin-autostart`, `tauri-plugin-opener`, `tauri-plugin-updater`+`tauri-plugin-process`(자동 업데이트, desktop 전용 `#[cfg(desktop)]`)
- 플러그인 권한은 `src-tauri/capabilities/default.json`에 선언됨. 새 플러그인/권한 추가 시 이 파일도 수정 필요.

### 자동 업데이트 / 배포

- **GitHub Releases 기반.** `v*` 태그 push → `.github/workflows/release.yml`이 빌드·서명·릴리스. 앱은 시작 시 `src/lib/updater.ts`로 `releases/latest/download/latest.json` 조회 → 새 버전이면 `src/components/layout/UpdateBanner.tsx` 배너 표시. 자세한 절차는 `RELEASE.md`.
- 서명 키: private은 `~/.tauri/lawbot-desktop.key`(절대 커밋 금지, `.gitignore`의 `*.key`), public은 `tauri.conf.json`의 `plugins.updater.pubkey`에 박혀 있음. CI는 키·VITE 환경변수를 GitHub Secrets에서 주입.
- 버전은 `tauri.conf.json`을 직접 고치지 말 것 — 릴리스 시 태그(`v0.2.0`)에서 workflow가 자동 주입.

## 도메인 용어

| 용어 | 의미 |
|------|------|
| 사건 (case) | 개인회생(`회`)/파산(`파`) 사건. status: pending→filed→commenced→approved→discharged 등 |
| 보정 (correction) | 법원이 송달한 보정명령·예납명령. deadline_date 기준 pending/approaching(3일 이내)/overdue/submitted |
| 연장 (extension) | 보정 기한연장 신청 (extension_number, new_deadline) |
| 기일 | 채권자집회 등 — `creditor_meeting` 텍스트 필드에서 날짜 파싱해 달력 표시 |
| progress_data | 크롤링한 사건 진행내역 JSON 배열 `{progress_date, content, result, notification}` |
