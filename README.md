# law-bot 사건관리 프로그램

한국 법률사무소(개인회생/파산)용 사건관리 데스크탑 앱.
법원 "나의사건검색" 사이트를 중앙 크롤러 서버가 크롤링해 사건 진행내역·보정명령·기한을 자동 추적한다.

- 프론트엔드: React 19 + TypeScript + Vite 7 + Tailwind CSS 4 (`src/`)
- 데스크탑 셸: Tauri 2 (`src-tauri/`) — 로컬 SQLite 미러, 자동시작, 자동 업데이트
- 데이터: Supabase가 원본(source of truth), 로컬 SQLite는 읽기용 미러 (실시간 반영 + 로그인 시 증분 동기화)
- 크롤러: 별도 레포 `lawbot-crawler` (FastAPI). 매일 KST 22:00 전체 크롤링 + 앱에서 HTTP 트리거

## 시작하기

패키지 매니저는 **pnpm**.

```powershell
pnpm install
cp .env.example .env    # Supabase / 크롤러 서버 값 입력
pnpm tauri dev          # 개발 모드 (Vite + Tauri, 포트 1420)
pnpm build              # tsc + vite build — 유일한 검증 수단 (테스트/린터 없음)
pnpm test:dates         # 날짜 유틸(KST) 단위 테스트
pnpm tauri build        # 프로덕션 인스톨러
```

`pnpm dev`(Vite 단독)는 Tauri API가 없어 로그인 후 동작하지 않는다. 반드시 `pnpm tauri dev`를 쓸 것.

## 환경변수 (`.env`)

| 변수 | 설명 |
|------|------|
| `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` | Supabase 프로젝트 |
| `VITE_CRAWLER_URL` | 중앙 크롤러 서버 주소 (인증은 로그인 세션 토큰으로 자동 처리) |

## 문서

- 아키텍처·데이터 흐름·스키마 변경 절차: [CLAUDE.md](CLAUDE.md)
- 릴리스·자동 업데이트 절차: [RELEASE.md](RELEASE.md)
