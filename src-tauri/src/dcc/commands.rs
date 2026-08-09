//! Tauri bridge for DCC, mirroring the shape of `irc/commands.rs`.
//!
//! The renderer owns the CTCP conversation and the user-consent flow; this
//! layer owns sockets and the filesystem. Anything the renderer passes that
//! ends up as a path is re-validated here — the renderer already sanitises
//! peer-supplied filenames, but a bug or a compromised page there must not turn
//! into an arbitrary write.

use std::net::{IpAddr, UdpSocket};
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use sic_irc::dcc::{DccConnectOptions, DccEvent, DccListenOptions, DccSession};
use sic_irc::Encoding;
use tauri::ipc::Channel;
use tauri::{AppHandle, Manager, State};
use tauri_plugin_dialog::DialogExt;

use super::state::{DccState, SessionId};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ListenArgs {
    #[serde(default)]
    pub secure: bool,
    #[serde(default)]
    pub port_start: u16,
    #[serde(default)]
    pub port_end: u16,
    pub expect_peer: Option<String>,
    pub file_path: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectArgs {
    pub host: String,
    pub port: u16,
    #[serde(default)]
    pub secure: bool,
    pub save_path: Option<String>,
    pub size: Option<u64>,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct BoundAddress {
    pub host: String,
    pub port: u16,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct FileInfo {
    pub path: String,
    pub name: String,
    pub size: u64,
}

/// Wire shape the renderer's `DccTransportEvent` union expects.
#[derive(Debug, Serialize, Clone)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum ClientDccEvent {
    Listening { port: u16 },
    Connected { fingerprint: Option<String> },
    Line { text: String },
    Progress { transferred: u64 },
    Completed { path: Option<String> },
    Closed,
    Error { message: String },
}

impl From<DccEvent> for ClientDccEvent {
    fn from(event: DccEvent) -> Self {
        match event {
            DccEvent::Listening { port } => ClientDccEvent::Listening { port },
            DccEvent::Connected { tls_fingerprint } => ClientDccEvent::Connected {
                fingerprint: tls_fingerprint,
            },
            DccEvent::Line { text } => ClientDccEvent::Line { text },
            DccEvent::Progress { transferred } => ClientDccEvent::Progress { transferred },
            DccEvent::Completed { path } => ClientDccEvent::Completed { path },
            DccEvent::Closed => ClientDccEvent::Closed,
            DccEvent::Error(message) => ClientDccEvent::Error { message },
        }
    }
}

/// Best-effort local address for the offer we are about to advertise.
///
/// Connecting a UDP socket sends no packets; it just makes the OS pick the
/// interface it would route through, which is the address a peer on that route
/// can reach. Behind NAT this is still a private address — that is what the
/// "advertised address" setting in the UI is for.
fn local_address() -> String {
    let probe = || -> Option<IpAddr> {
        let socket = UdpSocket::bind("0.0.0.0:0").ok()?;
        socket.connect("198.51.100.1:80").ok()?;
        Some(socket.local_addr().ok()?.ip())
    };
    probe()
        .map(|ip| ip.to_string())
        .unwrap_or_else(|| "127.0.0.1".to_string())
}

/// Reject anything that is not a single, plain filename.
///
/// The renderer sanitises peer-supplied names before we ever see them; this is
/// the backstop that keeps a bug there from becoming a write outside the
/// download directory.
fn safe_leaf(filename: &str) -> Result<String, String> {
    let trimmed = filename.trim();
    if trimmed.is_empty() || trimmed == "." || trimmed == ".." {
        return Err("invalid filename".to_string());
    }
    if trimmed.contains('/') || trimmed.contains('\\') || trimmed.contains('\0') {
        return Err("filename must not contain a path".to_string());
    }
    if Path::new(trimmed).components().count() != 1 {
        return Err("filename must not contain a path".to_string());
    }
    Ok(trimmed.to_string())
}

fn download_root(app: &AppHandle, directory: Option<String>) -> Result<PathBuf, String> {
    match directory {
        Some(dir) if !dir.trim().is_empty() => Ok(PathBuf::from(dir)),
        _ => app
            .path()
            .download_dir()
            .map_err(|e| format!("no download directory: {e}")),
    }
}

#[tauri::command]
pub async fn dcc_listen(
    app: AppHandle,
    state: State<'_, DccState>,
    session_id: SessionId,
    options: ListenArgs,
    on_dcc_event: Channel<ClientDccEvent>,
) -> Result<BoundAddress, String> {
    let expect_peer = match options.expect_peer.as_deref() {
        Some(raw) if !raw.is_empty() => Some(
            raw.parse::<IpAddr>()
                .map_err(|e| format!("invalid peer address {raw}: {e}"))?,
        ),
        _ => None,
    };

    let file_path = options.file_path.as_ref().map(PathBuf::from);
    if let Some(path) = file_path.as_ref() {
        // Fail before advertising a port for a file we cannot actually serve.
        if !path.is_file() {
            return Err(format!("not a file: {}", path.display()));
        }
    }

    let opts = DccListenOptions {
        secure: options.secure,
        port_start: options.port_start,
        port_end: options.port_end,
        expect_peer,
        file_path,
        encoding: Encoding::Utf8,
    };

    let (session, port, rx) = DccSession::listen(opts).map_err(|e| e.to_string())?;
    state
        .sessions
        .lock()
        .await
        .insert(session_id.clone(), session);

    spawn_pump(app, rx, on_dcc_event, session_id);

    Ok(BoundAddress {
        host: local_address(),
        port,
    })
}

#[tauri::command]
pub async fn dcc_connect(
    app: AppHandle,
    state: State<'_, DccState>,
    session_id: SessionId,
    options: ConnectArgs,
    on_dcc_event: Channel<ClientDccEvent>,
) -> Result<(), String> {
    // The host always comes from a parsed offer, so it is already an IP
    // literal. Re-check here so a malformed value cannot become a DNS lookup.
    options
        .host
        .parse::<IpAddr>()
        .map_err(|e| format!("invalid peer address {}: {e}", options.host))?;

    let opts = DccConnectOptions {
        host: options.host,
        port: options.port,
        secure: options.secure,
        save_path: options.save_path.map(PathBuf::from),
        size: options.size,
        encoding: Encoding::Utf8,
    };

    let (session, rx) = DccSession::connect(opts);
    state
        .sessions
        .lock()
        .await
        .insert(session_id.clone(), session);

    spawn_pump(app, rx, on_dcc_event, session_id);

    Ok(())
}

#[tauri::command]
pub async fn dcc_send_line(
    state: State<'_, DccState>,
    session_id: SessionId,
    line: String,
) -> Result<(), String> {
    let sessions = state.sessions.lock().await;
    let session = sessions
        .get(&session_id)
        .ok_or_else(|| format!("unknown dcc session: {session_id}"))?;
    session.send_line(line).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn dcc_close(state: State<'_, DccState>, session_id: SessionId) -> Result<(), String> {
    let session = {
        let mut sessions = state.sessions.lock().await;
        sessions.remove(&session_id)
    };
    // Closing an already-finished session is normal (the user cancels a row
    // that just completed), so a missing id is not an error.
    if let Some(session) = session {
        session.close().await.map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub async fn dcc_resolve_path(
    app: AppHandle,
    directory: Option<String>,
    filename: String,
) -> Result<String, String> {
    let leaf = safe_leaf(&filename)?;
    let root = download_root(&app, directory)?;
    std::fs::create_dir_all(&root).map_err(|e| format!("cannot create {}: {e}", root.display()))?;
    Ok(root.join(leaf).to_string_lossy().into_owned())
}

#[tauri::command]
pub async fn dcc_exists(path: String) -> Result<bool, String> {
    Ok(Path::new(&path).exists())
}

#[tauri::command]
pub async fn dcc_stat_file(path: String) -> Result<FileInfo, String> {
    let path = PathBuf::from(path);
    let metadata = std::fs::metadata(&path).map_err(|e| format!("{}: {e}", path.display()))?;
    if !metadata.is_file() {
        return Err(format!("not a file: {}", path.display()));
    }
    Ok(FileInfo {
        name: path
            .file_name()
            .map(|name| name.to_string_lossy().into_owned())
            .unwrap_or_default(),
        path: path.to_string_lossy().into_owned(),
        size: metadata.len(),
    })
}

#[tauri::command]
pub async fn dcc_pick_file(app: AppHandle) -> Result<Option<FileInfo>, String> {
    let picked = app.dialog().file().blocking_pick_file();
    let Some(picked) = picked else {
        return Ok(None);
    };
    let path = picked
        .into_path()
        .map_err(|e| format!("unsupported file selection: {e}"))?;
    let metadata = std::fs::metadata(&path).map_err(|e| format!("{}: {e}", path.display()))?;
    Ok(Some(FileInfo {
        name: path
            .file_name()
            .map(|name| name.to_string_lossy().into_owned())
            .unwrap_or_default(),
        path: path.to_string_lossy().into_owned(),
        size: metadata.len(),
    }))
}

#[tauri::command]
pub async fn dcc_pick_directory(app: AppHandle) -> Result<Option<String>, String> {
    let picked = app.dialog().file().blocking_pick_folder();
    let Some(picked) = picked else {
        return Ok(None);
    };
    let path = picked
        .into_path()
        .map_err(|e| format!("unsupported folder selection: {e}"))?;
    Ok(Some(path.to_string_lossy().into_owned()))
}

// --- internals ---------------------------------------------------------------

/// Forward every event to the renderer, then drop the session handle so a
/// finished id cannot linger in the map — the same cleanup `irc_connect` does.
fn spawn_pump(
    app: AppHandle,
    mut rx: tokio::sync::mpsc::Receiver<DccEvent>,
    channel: Channel<ClientDccEvent>,
    session_id: SessionId,
) {
    tokio::spawn(async move {
        while let Some(event) = rx.recv().await {
            let is_terminal = matches!(event, DccEvent::Closed);
            let _ = channel.send(event.into());
            if is_terminal {
                break;
            }
        }
        if let Some(state) = app.try_state::<DccState>() {
            state.sessions.lock().await.remove(&session_id);
        }
    });
}

#[cfg(test)]
mod tests {
    use super::{safe_leaf, ClientDccEvent};

    // Locks the JS payload contract in `core/src/features/dcc/types.ts`.
    #[test]
    fn event_variants_match_the_renderer_union() {
        assert_eq!(
            serde_json::to_string(&ClientDccEvent::Listening { port: 5000 }).unwrap(),
            r#"{"type":"listening","port":5000}"#
        );
        assert_eq!(
            serde_json::to_string(&ClientDccEvent::Connected {
                fingerprint: Some("AB:CD".into())
            })
            .unwrap(),
            r#"{"type":"connected","fingerprint":"AB:CD"}"#
        );
        assert_eq!(
            serde_json::to_string(&ClientDccEvent::Progress { transferred: 42 }).unwrap(),
            r#"{"type":"progress","transferred":42}"#
        );
        assert_eq!(
            serde_json::to_string(&ClientDccEvent::Completed { path: None }).unwrap(),
            r#"{"type":"completed","path":null}"#
        );
        assert_eq!(
            serde_json::to_string(&ClientDccEvent::Closed).unwrap(),
            r#"{"type":"closed"}"#
        );
        assert_eq!(
            serde_json::to_string(&ClientDccEvent::Error {
                message: "boom".into()
            })
            .unwrap(),
            r#"{"type":"error","message":"boom"}"#
        );
    }

    #[test]
    fn safe_leaf_accepts_a_plain_filename() {
        assert_eq!(safe_leaf(" holiday.jpg ").unwrap(), "holiday.jpg");
    }

    #[test]
    fn safe_leaf_rejects_paths_and_traversal() {
        for bad in [
            "../etc/passwd",
            "/etc/passwd",
            "..\\windows\\win.ini",
            "sub/dir.txt",
            "..",
            ".",
            "",
            "   ",
            "nul\0.txt",
        ] {
            assert!(safe_leaf(bad).is_err(), "expected {bad:?} to be rejected");
        }
    }
}
