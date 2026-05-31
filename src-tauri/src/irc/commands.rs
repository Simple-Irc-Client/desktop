use std::time::Duration;

use serde::{Deserialize, Serialize};
use sic_irc::{Encoding, IrcClient, IrcClientOptions, IrcEvent, RegistrationOptions};
use tauri::ipc::Channel;
use tauri::{AppHandle, Manager, State};
use uuid::Uuid;

use super::state::{ConnectionId, IrcState};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectArgs {
    pub host: String,
    pub port: u16,
    #[serde(default)]
    pub tls: bool,
    pub encoding: Option<String>,
    pub pong_timeout_secs: Option<u64>,
    pub registration: Option<RegistrationArgs>,
}

#[derive(Debug, Deserialize)]
pub struct RegistrationArgs {
    pub nick: String,
    pub username: String,
    pub gecos: String,
}

#[derive(Debug, Serialize, Clone)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum ClientEvent {
    SocketConnected,
    Connected,
    // `inbound` is deliberately a single lowercase word: it serializes
    // identically in Rust and JSON, so no field-level serde rename is needed
    // and the snake/camel mismatch class of bug is structurally impossible.
    Raw { line: String, inbound: bool },
    CapTimeout { retries: u32 },
    Closed,
    Error { message: String },
}

impl From<IrcEvent> for ClientEvent {
    fn from(e: IrcEvent) -> Self {
        match e {
            IrcEvent::SocketConnected => ClientEvent::SocketConnected,
            IrcEvent::Connected => ClientEvent::Connected,
            IrcEvent::Raw { line, inbound } => ClientEvent::Raw { line, inbound },
            IrcEvent::CapTimeout { retries } => ClientEvent::CapTimeout { retries },
            IrcEvent::Closed => ClientEvent::Closed,
            IrcEvent::Error(message) => ClientEvent::Error { message },
        }
    }
}

#[tauri::command]
pub async fn irc_connect(
    app: AppHandle,
    state: State<'_, IrcState>,
    options: ConnectArgs,
    on_event: Channel<ClientEvent>,
) -> Result<ConnectionId, String> {
    let mut opts = IrcClientOptions::new(options.host, options.port);
    opts.tls = options.tls;
    if let Some(enc) = options.encoding.as_deref() {
        opts.encoding = match enc.to_ascii_lowercase().as_str() {
            "latin1" | "binary" => Encoding::Latin1,
            _ => Encoding::Utf8,
        };
    }
    if let Some(secs) = options.pong_timeout_secs {
        opts.pong_timeout = Duration::from_secs(secs);
    }
    if let Some(reg) = options.registration {
        opts.registration = Some(RegistrationOptions {
            nick: reg.nick,
            username: reg.username,
            gecos: reg.gecos,
        });
    }

    let (client, mut rx) = IrcClient::connect(opts);
    let id: ConnectionId = Uuid::new_v4().to_string();

    state.connections.lock().await.insert(id.clone(), client);

    let app_for_task = app.clone();
    let id_for_cleanup = id.clone();
    tokio::spawn(async move {
        // `on_event` is created on the frontend (with its handler attached)
        // *before* `irc_connect` is invoked, so the receiving end is live
        // before this command — and therefore before the driver task — even
        // starts. Anything the driver emits in the gap before this loop
        // reaches `rx.recv()` is held in the bounded `mpsc` channel inside
        // `IrcClient` (backpressured, never dropped). Together that closes
        // the old race where events emitted before the renderer subscribed
        // were lost.
        while let Some(event) = rx.recv().await {
            let is_terminal = matches!(event, IrcEvent::Closed);
            let payload: ClientEvent = event.into();
            let _ = on_event.send(payload);
            if is_terminal {
                break;
            }
        }
        // Drop the handle from the connection map so the renderer doesn't see
        // a stale id after the underlying socket is gone.
        if let Some(state) = app_for_task.try_state::<IrcState>() {
            state.connections.lock().await.remove(&id_for_cleanup);
        }
    });

    Ok(id)
}

#[tauri::command]
pub async fn irc_send(
    state: State<'_, IrcState>,
    id: ConnectionId,
    line: String,
) -> Result<(), String> {
    let conns = state.connections.lock().await;
    let client = conns
        .get(&id)
        .ok_or_else(|| format!("unknown connection: {id}"))?;
    client.send(line).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn irc_quit(
    state: State<'_, IrcState>,
    id: ConnectionId,
    message: Option<String>,
) -> Result<(), String> {
    let client = {
        let mut conns = state.connections.lock().await;
        conns
            .remove(&id)
            .ok_or_else(|| format!("unknown connection: {id}"))?
    };
    client.quit(message).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn irc_disconnect(state: State<'_, IrcState>, id: ConnectionId) -> Result<(), String> {
    let client = {
        let mut conns = state.connections.lock().await;
        conns
            .remove(&id)
            .ok_or_else(|| format!("unknown connection: {id}"))?
    };
    client.disconnect().await.map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::ClientEvent;

    // Locks the JS payload contract in `core/src/network/irc/tauriTransport.ts`.
    // The field is a single lowercase word (`inbound`) precisely so Rust and
    // JSON spell it identically; this test fails loudly if anyone reintroduces
    // a multi-word name (and with it the snake/camel mismatch that once
    // silently dropped every inbound line and left the app empty).
    #[test]
    fn raw_event_serializes_inbound_verbatim() {
        let json = serde_json::to_string(&ClientEvent::Raw {
            line: ":srv 001 me :hi".into(),
            inbound: true,
        })
        .unwrap();
        assert_eq!(
            json,
            r#"{"type":"raw","line":":srv 001 me :hi","inbound":true}"#
        );
    }

    #[test]
    fn variant_tags_are_camelcase() {
        assert_eq!(
            serde_json::to_string(&ClientEvent::SocketConnected).unwrap(),
            r#"{"type":"socketConnected"}"#
        );
        assert_eq!(
            serde_json::to_string(&ClientEvent::CapTimeout { retries: 2 }).unwrap(),
            r#"{"type":"capTimeout","retries":2}"#
        );
        assert_eq!(
            serde_json::to_string(&ClientEvent::Error {
                message: "boom".into()
            })
            .unwrap(),
            r#"{"type":"error","message":"boom"}"#
        );
    }
}
