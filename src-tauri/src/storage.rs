//! История тренировок в SQLite (`focusglass.sqlite3` в каталоге данных приложения).

use std::path::Path;
use std::sync::Mutex;

use rusqlite::{Connection, params};
use serde::{Deserialize, Serialize};

use crate::error::{AppError, AppResult};

const SCHEMA_VERSION: i32 = 1;
/// Максимум записей, отдаваемых фронтенду за один запрос.
pub const MAX_LIST_LIMIT: u32 = 1000;

/// Итог одной БОС-сессии. Совпадает с TS-контрактом `SessionRecord`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionRecord {
    pub id: String,
    pub started_at: String,
    pub ended_at: String,
    pub mode: String,
    pub device_source: String,
    pub threshold: f64,
    pub duration_seconds: f64,
    pub time_in_focus_seconds: f64,
    pub time_in_dimming_seconds: f64,
    pub distraction_events_count: u32,
    pub average_focus_score: f64,
    pub min_focus_score: f64,
    pub max_focus_score: f64,
    pub artifact_count: u32,
}

impl SessionRecord {
    fn validate(&self) -> AppResult<()> {
        if self.id.trim().is_empty() {
            return Err(AppError::InvalidArgument("session id is empty".to_string()));
        }
        if !matches!(self.mode.as_str(), "concentration" | "relaxation") {
            return Err(AppError::InvalidArgument(format!(
                "unknown training mode `{}`",
                self.mode
            )));
        }
        if !matches!(self.device_source.as_str(), "simulator" | "bluetooth") {
            return Err(AppError::InvalidArgument(format!(
                "unknown device source `{}`",
                self.device_source
            )));
        }
        let numbers = [
            self.threshold,
            self.duration_seconds,
            self.time_in_focus_seconds,
            self.time_in_dimming_seconds,
            self.average_focus_score,
            self.min_focus_score,
            self.max_focus_score,
        ];
        if numbers.iter().any(|n| !n.is_finite() || *n < 0.0) {
            return Err(AppError::InvalidArgument(
                "session metrics must be finite and non-negative".to_string(),
            ));
        }
        Ok(())
    }
}

pub struct SessionStore {
    conn: Mutex<Connection>,
}

impl SessionStore {
    pub fn open(path: &Path) -> AppResult<Self> {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        Self::from_connection(Connection::open(path)?)
    }

    #[cfg(test)]
    pub fn open_in_memory() -> AppResult<Self> {
        Self::from_connection(Connection::open_in_memory()?)
    }

    fn from_connection(conn: Connection) -> AppResult<Self> {
        let version: i32 = conn.query_row("PRAGMA user_version", [], |row| row.get(0))?;
        if version < 1 {
            conn.execute_batch(
                "BEGIN;
                 CREATE TABLE IF NOT EXISTS sessions (
                     id                       TEXT PRIMARY KEY NOT NULL,
                     started_at               TEXT NOT NULL,
                     ended_at                 TEXT NOT NULL,
                     mode                     TEXT NOT NULL,
                     device_source            TEXT NOT NULL,
                     threshold                REAL NOT NULL,
                     duration_seconds         REAL NOT NULL,
                     time_in_focus_seconds    REAL NOT NULL,
                     time_in_dimming_seconds  REAL NOT NULL,
                     distraction_events_count INTEGER NOT NULL,
                     average_focus_score      REAL NOT NULL,
                     min_focus_score          REAL NOT NULL,
                     max_focus_score          REAL NOT NULL,
                     artifact_count           INTEGER NOT NULL
                 );
                 CREATE INDEX IF NOT EXISTS idx_sessions_started_at ON sessions (started_at DESC);
                 COMMIT;",
            )?;
            conn.pragma_update(None, "user_version", SCHEMA_VERSION)?;
        }
        Ok(Self {
            conn: Mutex::new(conn),
        })
    }

    fn lock(&self) -> AppResult<std::sync::MutexGuard<'_, Connection>> {
        self.conn
            .lock()
            .map_err(|_| AppError::LockPoisoned("session store"))
    }

    /// Вставляет запись или обновляет существующую с тем же `id` (автосохранение).
    pub fn upsert(&self, record: &SessionRecord) -> AppResult<()> {
        record.validate()?;
        self.lock()?.execute(
            "INSERT INTO sessions (
                 id, started_at, ended_at, mode, device_source, threshold,
                 duration_seconds, time_in_focus_seconds, time_in_dimming_seconds,
                 distraction_events_count, average_focus_score, min_focus_score,
                 max_focus_score, artifact_count
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)
             ON CONFLICT(id) DO UPDATE SET
                 started_at = excluded.started_at,
                 ended_at = excluded.ended_at,
                 mode = excluded.mode,
                 device_source = excluded.device_source,
                 threshold = excluded.threshold,
                 duration_seconds = excluded.duration_seconds,
                 time_in_focus_seconds = excluded.time_in_focus_seconds,
                 time_in_dimming_seconds = excluded.time_in_dimming_seconds,
                 distraction_events_count = excluded.distraction_events_count,
                 average_focus_score = excluded.average_focus_score,
                 min_focus_score = excluded.min_focus_score,
                 max_focus_score = excluded.max_focus_score,
                 artifact_count = excluded.artifact_count",
            params![
                record.id,
                record.started_at,
                record.ended_at,
                record.mode,
                record.device_source,
                record.threshold,
                record.duration_seconds,
                record.time_in_focus_seconds,
                record.time_in_dimming_seconds,
                record.distraction_events_count,
                record.average_focus_score,
                record.min_focus_score,
                record.max_focus_score,
                record.artifact_count,
            ],
        )?;
        Ok(())
    }

    /// Атомарно импортирует набор записей (миграция из `localStorage`).
    pub fn import(&self, records: &[SessionRecord]) -> AppResult<usize> {
        for record in records {
            record.validate()?;
        }
        let mut conn = self.lock()?;
        let tx = conn.transaction()?;
        let mut imported = 0;
        for record in records {
            imported += tx.execute(
                "INSERT OR IGNORE INTO sessions (
                     id, started_at, ended_at, mode, device_source, threshold,
                     duration_seconds, time_in_focus_seconds, time_in_dimming_seconds,
                     distraction_events_count, average_focus_score, min_focus_score,
                     max_focus_score, artifact_count
                 ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)",
                params![
                    record.id,
                    record.started_at,
                    record.ended_at,
                    record.mode,
                    record.device_source,
                    record.threshold,
                    record.duration_seconds,
                    record.time_in_focus_seconds,
                    record.time_in_dimming_seconds,
                    record.distraction_events_count,
                    record.average_focus_score,
                    record.min_focus_score,
                    record.max_focus_score,
                    record.artifact_count,
                ],
            )?;
        }
        tx.commit()?;
        Ok(imported)
    }

    /// Последние сессии, новые первыми.
    pub fn list(&self, limit: u32) -> AppResult<Vec<SessionRecord>> {
        let limit = limit.clamp(1, MAX_LIST_LIMIT);
        let conn = self.lock()?;
        let mut stmt = conn.prepare(
            "SELECT id, started_at, ended_at, mode, device_source, threshold,
                    duration_seconds, time_in_focus_seconds, time_in_dimming_seconds,
                    distraction_events_count, average_focus_score, min_focus_score,
                    max_focus_score, artifact_count
             FROM sessions
             ORDER BY started_at DESC, id DESC
             LIMIT ?1",
        )?;
        let rows = stmt.query_map([limit], |row| {
            Ok(SessionRecord {
                id: row.get(0)?,
                started_at: row.get(1)?,
                ended_at: row.get(2)?,
                mode: row.get(3)?,
                device_source: row.get(4)?,
                threshold: row.get(5)?,
                duration_seconds: row.get(6)?,
                time_in_focus_seconds: row.get(7)?,
                time_in_dimming_seconds: row.get(8)?,
                distraction_events_count: row.get(9)?,
                average_focus_score: row.get(10)?,
                min_focus_score: row.get(11)?,
                max_focus_score: row.get(12)?,
                artifact_count: row.get(13)?,
            })
        })?;
        Ok(rows.collect::<Result<Vec<_>, _>>()?)
    }

    pub fn delete(&self, id: &str) -> AppResult<bool> {
        let affected = self
            .lock()?
            .execute("DELETE FROM sessions WHERE id = ?1", [id])?;
        Ok(affected > 0)
    }

    pub fn clear(&self) -> AppResult<usize> {
        Ok(self.lock()?.execute("DELETE FROM sessions", [])?)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn record(id: &str, started_at: &str, duration: f64) -> SessionRecord {
        SessionRecord {
            id: id.to_string(),
            started_at: started_at.to_string(),
            ended_at: "2026-11-10T10:30:00.000Z".to_string(),
            mode: "concentration".to_string(),
            device_source: "simulator".to_string(),
            threshold: 60.0,
            duration_seconds: duration,
            time_in_focus_seconds: duration * 0.8,
            time_in_dimming_seconds: duration * 0.2,
            distraction_events_count: 3,
            average_focus_score: 71.25,
            min_focus_score: 22.0,
            max_focus_score: 94.5,
            artifact_count: 7,
        }
    }

    #[test]
    fn upsert_roundtrips_and_orders_newest_first() {
        let store = SessionStore::open_in_memory().expect("open");
        store
            .upsert(&record("a", "2026-11-10T09:00:00.000Z", 120.0))
            .expect("insert a");
        store
            .upsert(&record("b", "2026-11-10T10:00:00.000Z", 300.0))
            .expect("insert b");

        let all = store.list(50).expect("list");
        assert_eq!(all.len(), 2);
        assert_eq!(all[0], record("b", "2026-11-10T10:00:00.000Z", 300.0));
        assert_eq!(all[1].id, "a");
    }

    #[test]
    fn upsert_with_same_id_updates_in_place() {
        let store = SessionStore::open_in_memory().expect("open");
        store
            .upsert(&record("live", "2026-11-10T09:00:00.000Z", 5.0))
            .expect("first autosave");
        store
            .upsert(&record("live", "2026-11-10T09:00:00.000Z", 65.0))
            .expect("second autosave");

        let all = store.list(50).expect("list");
        assert_eq!(all.len(), 1);
        assert!((all[0].duration_seconds - 65.0).abs() < f64::EPSILON);
    }

    #[test]
    fn list_respects_limit() {
        let store = SessionStore::open_in_memory().expect("open");
        for i in 0..5 {
            store
                .upsert(&record(
                    &format!("s{i}"),
                    &format!("2026-11-10T09:0{i}:00.000Z"),
                    10.0,
                ))
                .expect("insert");
        }
        let two = store.list(2).expect("list");
        assert_eq!(two.len(), 2);
        assert_eq!(two[0].id, "s4");
    }

    #[test]
    fn import_skips_existing_ids() {
        let store = SessionStore::open_in_memory().expect("open");
        store
            .upsert(&record("x", "2026-11-10T09:00:00.000Z", 100.0))
            .expect("insert");
        let imported = store
            .import(&[
                record("x", "2026-11-10T09:00:00.000Z", 1.0),
                record("y", "2026-11-09T09:00:00.000Z", 50.0),
            ])
            .expect("import");
        assert_eq!(imported, 1);

        let all = store.list(50).expect("list");
        assert_eq!(all.len(), 2);
        let x = all.iter().find(|r| r.id == "x").expect("x present");
        assert!((x.duration_seconds - 100.0).abs() < f64::EPSILON);
    }

    #[test]
    fn delete_and_clear() {
        let store = SessionStore::open_in_memory().expect("open");
        store
            .upsert(&record("a", "2026-11-10T09:00:00.000Z", 10.0))
            .expect("insert");
        store
            .upsert(&record("b", "2026-11-10T09:01:00.000Z", 10.0))
            .expect("insert");

        assert!(store.delete("a").expect("delete"));
        assert!(!store.delete("a").expect("delete again"));
        assert_eq!(store.clear().expect("clear"), 1);
        assert!(store.list(50).expect("list").is_empty());
    }

    #[test]
    fn rejects_invalid_records() {
        let store = SessionStore::open_in_memory().expect("open");

        let mut bad_mode = record("a", "2026-11-10T09:00:00.000Z", 10.0);
        bad_mode.mode = "sleep".to_string();
        assert_eq!(
            store.upsert(&bad_mode).expect_err("bad mode").kind(),
            "invalid_argument"
        );

        let mut bad_number = record("b", "2026-11-10T09:00:00.000Z", 10.0);
        bad_number.average_focus_score = f64::NAN;
        assert_eq!(
            store.upsert(&bad_number).expect_err("NaN").kind(),
            "invalid_argument"
        );

        let empty_id = record("  ", "2026-11-10T09:00:00.000Z", 10.0);
        assert!(store.upsert(&empty_id).is_err());
        assert!(store.list(50).expect("list").is_empty());
    }

    #[test]
    fn persists_across_reopen_on_disk() {
        let dir = std::env::temp_dir().join(format!("focusglass-test-{}", std::process::id()));
        let path = dir.join("nested").join("sessions.sqlite3");
        {
            let store = SessionStore::open(&path).expect("create");
            store
                .upsert(&record("disk", "2026-11-10T09:00:00.000Z", 42.0))
                .expect("insert");
        }
        let reopened = SessionStore::open(&path).expect("reopen");
        let all = reopened.list(10).expect("list");
        assert_eq!(all.len(), 1);
        assert_eq!(all[0].id, "disk");
        drop(reopened);
        std::fs::remove_dir_all(&dir).expect("cleanup temp dir");
    }
}
