# 배포 & 자동 업데이트 가이드

이 앱은 **GitHub Releases + Tauri updater**로 자동 업데이트된다.
`v*` 태그를 push하면 GitHub Actions가 빌드·서명·릴리스까지 처리하고,
설치된 앱들은 다음 실행 때 새 버전을 감지해 자동으로 업데이트한다.

## 최초 1회 — GitHub Secrets 등록

저장소 → **Settings → Secrets and variables → Actions → New repository secret** 에서 아래를 등록한다.

| Secret 이름 | 값 |
|---|---|
| `TAURI_SIGNING_PRIVATE_KEY` | 서명 **private 키 파일 내용 전체** (아래 명령으로 클립보드 복사) |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | 비워둠 (키에 비밀번호 없음 — Secret을 안 만들어도 됨) |
| `VITE_SUPABASE_URL` | 루트 `.env`의 같은 값 |
| `VITE_SUPABASE_ANON_KEY` | 〃 |
| `VITE_CRAWLER_URL` | 〃 |
| `VITE_CRAWLER_SECRET` | 〃 |

private 키를 클립보드로 복사 (PowerShell):

```powershell
Get-Content "$env:USERPROFILE\.tauri\lawbot-desktop.key" -Raw | Set-Clipboard
```

> ⚠️ **private 키(`~/.tauri/lawbot-desktop.key`)는 절대 잃어버리거나 커밋하면 안 된다.**
> 이 키를 분실하면 기존 설치본들이 더 이상 자동 업데이트를 받을 수 없다 (새 키로 만든 빌드는 서명 검증에 실패). 안전한 곳에 백업해 둘 것.

## 배포할 때마다 (새 버전 내보내기)

`tauri.conf.json`의 version은 **건드릴 필요 없다** — 태그에서 자동으로 채워진다.

```powershell
# 1) 변경사항 커밋·푸시 (평소대로)
git add -A; git commit -m "..."; git push

# 2) 버전 태그를 찍어서 push  ← 이게 릴리스 트리거
git tag v0.2.0
git push origin v0.2.0
```

그러면:
1. GitHub Actions(`.github/workflows/release.yml`)가 Windows 러너에서 빌드·서명
2. `v0.2.0` Release가 생성되고 인스톨러 + `latest.json` 업로드
3. 실행 중인 앱들은 다음 시작 때 상단에 **"새 버전 v0.2.0이 있습니다"** 배너 → 클릭하면 다운로드·재시작

진행 상황은 저장소 **Actions** 탭에서 확인 (Windows Rust 빌드라 5~10분 소요).

## 동작 방식 (참고)

- 앱 시작 시 `src/lib/updater.ts`의 `checkForUpdate()`가
  `releases/latest/download/latest.json`을 조회 → 현재 버전보다 높으면 배너 표시.
- 다운로드한 패키지는 위 private 키로 만든 서명을, 앱에 내장된 public 키
  (`tauri.conf.json`의 `plugins.updater.pubkey`)로 검증한 뒤에만 설치.
- 첫 버전(예전에 수동 설치한 빌드)은 updater가 없으니, **이 변경이 들어간 버전을
  한 번은 수동으로 배포·설치**해야 그 다음부터 자동 업데이트가 작동한다.
