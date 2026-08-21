//! Filesystem watching for live updates to the recent-folder tree and the open document.

use notify::{EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use std::{
    collections::HashSet,
    path::PathBuf,
    sync::mpsc::{RecvTimeoutError, channel},
    time::Duration,
};
use tauri::{AppHandle, Emitter};

/// Idle window used to coalesce bursts of filesystem events into a single notification.
const DEBOUNCE_WINDOW: Duration = Duration::from_millis(300);
/// Event name emitted to the frontend when watched paths change on disk.
const WATCHED_PATH_CHANGE_EVENT: &str = "watched-path-changed";

/// Payload emitted when one or more watched paths change on disk.
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct WatchedPathsChanged {
    /// Absolute paths affected since the previous notification.
    paths: Vec<PathBuf>,
}

/// Returns whether a filesystem event kind should trigger a change notification.
fn is_relevant_event_kind(kind: EventKind) -> bool {
    matches!(
        kind,
        EventKind::Create(_) | EventKind::Modify(_) | EventKind::Remove(_)
    )
}

/// Watches a set of root directories for changes, recursively.
///
/// Filesystem events are debounced on a background thread and emitted to the frontend as a
/// single `watched-path-changed` event per idle window, to avoid flooding the UI with the
/// bursts of raw events that editors and version-control tools commonly produce.
///
/// Returns `None` when there are no roots to watch or the platform watcher cannot start; the
/// application remains usable without live updates in that case.
pub fn spawn_watcher(app: AppHandle, roots: &[PathBuf]) -> Option<RecommendedWatcher> {
    if roots.is_empty() {
        return None;
    }

    let (sender, receiver) = channel();
    let mut watcher = notify::recommended_watcher(sender).ok()?;

    for root in roots {
        let _ = watcher.watch(root, RecursiveMode::Recursive);
    }

    std::thread::spawn(move || {
        let mut pending: HashSet<PathBuf> = HashSet::new();
        loop {
            match receiver.recv_timeout(DEBOUNCE_WINDOW) {
                Ok(Ok(event)) if is_relevant_event_kind(event.kind) => {
                    pending.extend(event.paths);
                }
                Ok(_) => {}
                Err(RecvTimeoutError::Timeout) => {
                    if !pending.is_empty() {
                        let paths = pending.drain().collect();
                        let _ = app.emit(WATCHED_PATH_CHANGE_EVENT, WatchedPathsChanged { paths });
                    }
                }
                Err(RecvTimeoutError::Disconnected) => break,
            }
        }
    });

    Some(watcher)
}

#[cfg(test)]
mod tests {
    use super::is_relevant_event_kind;
    use notify::EventKind;

    /// Create, modify, and remove events are relevant; access events are not.
    #[test]
    fn filters_events_to_content_changes() {
        assert!(is_relevant_event_kind(EventKind::Create(
            notify::event::CreateKind::File
        )));
        assert!(is_relevant_event_kind(EventKind::Modify(
            notify::event::ModifyKind::Any
        )));
        assert!(is_relevant_event_kind(EventKind::Remove(
            notify::event::RemoveKind::File
        )));
        assert!(!is_relevant_event_kind(EventKind::Access(
            notify::event::AccessKind::Read
        )));
        assert!(!is_relevant_event_kind(EventKind::Any));
    }
}
