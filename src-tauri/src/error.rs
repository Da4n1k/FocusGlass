use serde::{Serialize, Serializer};
use std::fmt;

/// Error type for every IPC command. It serialises to a plain message string,
/// so the frontend keeps receiving the same error shape it handled before.
#[derive(Debug, PartialEq, Eq)]
pub enum AppError {
    /// A native window operation failed.
    Window {
        action: &'static str,
        reason: String,
    },
    /// A shared-state mutex was poisoned by a panicking thread.
    StateLockPoisoned(&'static str),
    /// Click-through was requested while its emergency exit (Ctrl+Shift+G) is unavailable.
    ClickThroughUnavailable,
    /// The frontend asked for a device source this build does not know.
    UnknownDeviceSource(String),
}

impl AppError {
    pub fn window(action: &'static str, reason: impl fmt::Display) -> Self {
        Self::Window {
            action,
            reason: reason.to_string(),
        }
    }
}

impl fmt::Display for AppError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Window { action, reason } => write!(f, "Failed to {action}: {reason}"),
            Self::StateLockPoisoned(what) => write!(f, "{what} state lock poisoned"),
            Self::ClickThroughUnavailable => write!(
                f,
                "Click-through refused: Ctrl+Shift+G is unavailable (taken by another app), \
                 so there would be no way to restore the window."
            ),
            Self::UnknownDeviceSource(source) => {
                write!(f, "Unknown device source: {source:?}")
            }
        }
    }
}

impl std::error::Error for AppError {}

impl Serialize for AppError {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.serialize_str(&self.to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn serialises_to_the_display_message() {
        let err = AppError::window("minimize window", "boom");
        let json = serde_json::to_string(&err).expect("AppError must serialise");
        assert_eq!(json, "\"Failed to minimize window: boom\"");
    }

    #[test]
    fn unknown_source_message_quotes_the_input() {
        let err = AppError::UnknownDeviceSource("usb".to_string());
        assert_eq!(err.to_string(), "Unknown device source: \"usb\"");
    }
}
