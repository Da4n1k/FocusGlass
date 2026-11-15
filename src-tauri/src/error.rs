//! Единый тип ошибок Rust-ядра FocusGlass.
//!
//! Все команды IPC возвращают `Result<T, AppError>`. На стороне фронтенда ошибка
//! приходит объектом `{ kind, message }` (см. `tauriBridge.ts`).

use serde::ser::SerializeStruct;
use serde::{Serialize, Serializer};

#[derive(Debug, thiserror::Error)]
pub enum AppError {
    #[error("window operation failed: {0}")]
    Window(#[from] tauri::Error),

    #[error("window `{0}` is not available")]
    WindowNotFound(&'static str),

    #[error("state lock poisoned: {0}")]
    LockPoisoned(&'static str),

    #[error("database error: {0}")]
    Database(#[from] rusqlite::Error),

    #[error("I/O error: {0}")]
    Io(#[from] std::io::Error),

    #[error("invalid argument: {0}")]
    InvalidArgument(String),

    #[error(
        "Click-through refused: Ctrl+Shift+G is unavailable (taken by another app), \
         so there would be no way to restore the window."
    )]
    ClickThroughUnavailable,

    #[error("Unknown device source: {0:?}")]
    UnknownDeviceSource(String),

    #[error("BCI error: {0}")]
    Bci(String),
}

pub type AppResult<T> = Result<T, AppError>;

impl AppError {
    /// Стабильный машинный код ошибки для фронтенда.
    pub fn kind(&self) -> &'static str {
        match self {
            AppError::Window(_) => "window",
            AppError::WindowNotFound(_) => "window_not_found",
            AppError::LockPoisoned(_) => "lock_poisoned",
            AppError::Database(_) => "database",
            AppError::Io(_) => "io",
            AppError::InvalidArgument(_) => "invalid_argument",
            AppError::ClickThroughUnavailable => "click_through_unavailable",
            AppError::UnknownDeviceSource(_) => "unknown_device_source",
            AppError::Bci(_) => "bci",
        }
    }
}

impl Serialize for AppError {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        let mut state = serializer.serialize_struct("AppError", 2)?;
        state.serialize_field("kind", self.kind())?;
        state.serialize_field("message", &self.to_string())?;
        state.end()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn serializes_as_kind_and_message() {
        let err = AppError::InvalidArgument("threshold must be finite".to_string());
        let json = serde_json::to_value(&err).expect("AppError must serialize");
        assert_eq!(json["kind"], "invalid_argument");
        assert_eq!(json["message"], "invalid argument: threshold must be finite");
    }

    #[test]
    fn io_errors_convert_with_question_mark() {
        fn failing() -> AppResult<()> {
            Err(std::io::Error::new(std::io::ErrorKind::NotFound, "missing"))?;
            Ok(())
        }
        let err = failing().expect_err("must propagate");
        assert_eq!(err.kind(), "io");
    }

    #[test]
    fn unknown_source_message_quotes_the_input() {
        let err = AppError::UnknownDeviceSource("usb".to_string());
        assert_eq!(err.kind(), "unknown_device_source");
        assert_eq!(err.to_string(), "Unknown device source: \"usb\"");
    }

    #[test]
    fn click_through_unavailable_has_stable_kind() {
        let err = AppError::ClickThroughUnavailable;
        assert_eq!(err.kind(), "click_through_unavailable");
    }
}
