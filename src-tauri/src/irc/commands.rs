use std::time::Duration;

use serde::{Deserialize, Serialize};
use sic_irc::{Encoding, IrcClient, IrcClientOptions, IrcEvent, RegistrationOptions};
use tauri::{AppHandle, Emitter, Manager, State};
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
    Raw { line: String, from_server: bool },
    CapTimeout { retries: u32 },
    Closed,
    Error { message: String },
}

impl From<IrcEvent> for ClientEvent {
    fn from(e: IrcEvent) -> Self {
        match e {
            IrcEvent::SocketConnected => ClientEvent::SocketConnected,
            IrcEvent::Connected => ClientEvent::Connected,
            IrcEvent::Raw { line, from_server } => ClientEvent::Raw { line, from_server },
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

    state
        .connections
        .lock()
        .await
        .insert(id.clone(), client);

    let app_for_task = app.clone();
    let event_name = format!("irc://{id}");
    let id_for_cleanup = id.clone();
    tokio::spawn(async move {
        while let Some(event) = rx.recv().await {
            let is_terminal = matches!(event, IrcEvent::Closed);
            let payload: ClientEvent = event.into();
            let _ = app_for_task.emit(&event_name, payload);
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
pub async fn irc_disconnect(
    state: State<'_, IrcState>,
    id: ConnectionId,
) -> Result<(), String> {
    let client = {
        let mut conns = state.connections.lock().await;
        conns
            .remove(&id)
            .ok_or_else(|| format!("unknown connection: {id}"))?
    };
    client.disconnect().await.map_err(|e| e.to_string())
}
