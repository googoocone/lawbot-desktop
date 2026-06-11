import Database from "@tauri-apps/plugin-sql";

const DB_URL = "sqlite:caseflow.db";

let dbPromise: Promise<Database> | null = null;

export function getDb(): Promise<Database> {
  if (!dbPromise) {
    dbPromise = (async () => {
      const db = await Database.load(DB_URL);
      // WAL 모드: write 중에도 read 가능 (lock 충돌 해소)
      await db.execute("PRAGMA journal_mode = WAL");
      await db.execute("PRAGMA synchronous = NORMAL");
      await db.execute("PRAGMA busy_timeout = 5000");
      return db;
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
