import Database from "@tauri-apps/plugin-sql";
import { invoke } from "@tauri-apps/api/core";

// dev에선 별도 DB 파일(caseflow_dev.db)을 쓴다 — src-tauri/src/lib.rs의 DB_URL과 반드시 일치해야 함.
// (설치된 릴리스 앱과 DB를 분리해 마이그레이션 체크섬 충돌을 막기 위함)
const DB_FILE = import.meta.env.DEV ? "caseflow_dev.db" : "caseflow.db";
const DB_URL = `sqlite:${DB_FILE}`;

let dbPromise: Promise<Database> | null = null;

async function loadDb(): Promise<Database> {
  const db = await Database.load(DB_URL);
  // WAL 모드: write 중에도 read 가능 (lock 충돌 해소)
  await db.execute("PRAGMA journal_mode = WAL");
  await db.execute("PRAGMA synchronous = NORMAL");
  await db.execute("PRAGMA busy_timeout = 5000");
  return db;
}

export function getDb(): Promise<Database> {
  if (!dbPromise) {
    dbPromise = (async () => {
      try {
        return await loadDb();
      } catch (e) {
        // 마이그레이션 체크섬 불일치(예: 0.1.8→0.1.9의 .sql 줄바꿈 CRLF→LF 전환)로
        // plugin-sql이 "migration ... has been modified" 에러를 내며 DB를 못 여는 경우,
        // 로컬 미러를 버리고 새로 만든다. 원본은 Supabase에 있어 로그인 시 풀 싱크로 복구됨.
        const msg = String((e as { message?: string })?.message ?? e);
        if (/migration/i.test(msg)) {
          console.warn("[db] 마이그레이션 충돌 감지 — 로컬 DB 재생성:", msg);
          try {
            await invoke("reset_local_db", { name: DB_FILE });
          } catch (re) {
            console.error("[db] reset_local_db 실패:", re);
          }
          // 빈 DB로 재시도 — 이후 syncAll()이 다시 채운다
          return await loadDb();
        }
        throw e;
      }
    })();
  }
  return dbPromise;
}

// 조회: 행 배열 반환
export async function dbSelect<T = unknown>(
  sql: string,
  params: unknown[] = [],
): Promise<T[]> {
  const db = await getDb();
  return db.select<T[]>(sql, params);
}

// 실행: INSERT/UPDATE/DELETE 등. 영향받은 행 수 반환
export async function dbExecute(
  sql: string,
  params: unknown[] = [],
): Promise<{ rowsAffected: number; lastInsertId?: number }> {
  const db = await getDb();
  return db.execute(sql, params);
}

// 여러 INSERT를 순차 실행 (tauri-plugin-sql의 connection pool 특성상
// 명시적 BEGIN/COMMIT은 connection이 분리되어 작동 안 함 — WAL + busy_timeout으로 대체)
export async function dbTx(
  fn: (db: Database) => Promise<void>,
): Promise<void> {
  const db = await getDb();
  await fn(db);
}
