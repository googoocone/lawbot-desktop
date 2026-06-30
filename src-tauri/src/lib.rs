use tauri::Manager;
use tauri_plugin_autostart::MacosLauncher;
use tauri_plugin_sql::{Migration, MigrationKind};

// dev 빌드는 별도 DB 파일을 써서 설치된 릴리스 앱과 DB(=마이그레이션 체크섬)를
// 공유하지 않게 한다. (CRLF/LF 차이 등으로 인한 "migration ... has been modified" 충돌 방지)
#[cfg(debug_assertions)]
const DB_URL: &str = "sqlite:caseflow_dev.db";
#[cfg(not(debug_assertions))]
const DB_URL: &str = "sqlite:caseflow.db";

// 로컬 미러 DB 파일을 삭제한다. 마이그레이션 체크섬 충돌 등으로 plugin-sql이
// DB를 못 여는 경우(예: 0.1.8→0.1.9 줄바꿈 CRLF→LF 전환) 프론트(db.ts)에서 호출.
// 원본은 Supabase에 있어 다음 풀 싱크로 복구되므로 로컬 파일은 버려도 안전하다.
// 안전장치: 경로 조작을 막기 위해 단순 파일명만 허용한다.
#[tauri::command]
fn reset_local_db(app: tauri::AppHandle, name: String) -> Result<(), String> {
    if name.contains('/') || name.contains('\\') || name.contains("..") {
        return Err("invalid db name".into());
    }
    let dir = app.path().app_config_dir().map_err(|e| e.to_string())?;
    // 본체 + WAL/SHM 동반 파일까지 함께 제거
    for suffix in ["", "-wal", "-shm"] {
        let p = dir.join(format!("{name}{suffix}"));
        if p.exists() {
            std::fs::remove_file(&p).map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let migrations = vec![
        Migration {
            version: 1,
            description: "init schema",
            sql: include_str!("../migrations/0001_init.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 2,
            description: "add notifications",
            sql: include_str!("../migrations/0002_notifications.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 3,
            description: "add local_meta",
            sql: include_str!("../migrations/0003_local_meta.sql"),
            kind: MigrationKind::Up,
        },
    ];

    let mut builder = tauri::Builder::default();

    // 데스크탑 전용 — 자동 업데이트 (모바일 타깃에는 플러그인이 없음)
    #[cfg(desktop)]
    {
        builder = builder
            .plugin(tauri_plugin_updater::Builder::new().build())
            .plugin(tauri_plugin_process::init());
    }

    builder
        .invoke_handler(tauri::generate_handler![reset_local_db])
        .plugin(tauri_plugin_opener::init())
        .plugin(
            tauri_plugin_sql::Builder::default()
                .add_migrations(DB_URL, migrations)
                .build(),
        )
        .plugin(tauri_plugin_autostart::init(
            MacosLauncher::LaunchAgent,
            None,
        ))
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
