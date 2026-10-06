use serde::{Deserialize, Serialize};
use sic_irc::{Encoding, IrcClient, IrcClientOptions, IrcEvent};
use tauri::ipc::Channel;
use tauri::{AppHandle, Manager, State};
use uuid::Uuid;

use super::state::{ConnectionId, IrcState};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectArgs {
    host: String,
    port: u16,
    #[serde(default)]
    tls: bool,
    encoding: Option<String>,
}

impl From<ConnectArgs> for IrcClientOptions {
    fn from(args: ConnectArgs) -> Self {
        let encoding = match args
            .encoding
            .as_deref()
            .map(str::to_ascii_lowercase)
            .as_deref()
        {
            Some("latin1" | "binary") => Encoding::Latin1,
            _ => Encoding::Utf8,
        };
        Self {
            host: args.host,
            port: args.port,
            tls: args.tls,
            encoding,
        }
    }
}

/// Event payload consumed by `core/src/network/irc/tauriTransport.ts`.
#[derive(Debug, Serialize, Clone)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum ClientEvent {
    SocketConnected,
    Raw { line: String },
    Closed,
    Error { message: String },
}

impl From<IrcEvent> for ClientEvent {
    fn from(event: IrcEvent) -> Self {
        match event {
            IrcEvent::SocketConnected => ClientEvent::SocketConnected,
            IrcEvent::Raw { line } => ClientEvent::Raw { line },
            IrcEvent::Closed => ClientEvent::Closed,
            IrcEvent::Error(message) => ClientEvent::Error { message },
        }
    }
}

/// Opens a byte pipe to the server; the core kernel drives the whole IRC conversation over it.
#[tauri::command]
pub async fn irc_connect(
    app: AppHandle,
    state: State<'_, IrcState>,
    options: ConnectArgs,
    on_event: Channel<ClientEvent>,
) -> Result<ConnectionId, String> {
    let (client, mut events) = IrcClient::connect(options.into());
    let id: ConnectionId = Uuid::new_v4().to_string();
    state.insert(id.clone(), client).await;

    let connection_id = id.clone();
    // `on_event` already has its handler, and events wait in the client's channel until read, so none are lost
    tokio::spawn(async move {
        while let Some(event) = events.recv().await {
            let is_closed = matches!(event, IrcEvent::Closed);
            let _ = on_event.send(event.into());
            if is_closed {
                break;
            }
        }
        app.state::<IrcState>().remove(&connection_id).await;
    });

    Ok(id)
}

#[tauri::command]
pub async fn irc_send(
    state: State<'_, IrcState>,
    id: ConnectionId,
    line: String,
) -> Result<(), String> {
    let client = state
        .get(&id)
        .await
        .ok_or_else(|| unknown_connection(&id))?;
    client.send(line).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn irc_disconnect(state: State<'_, IrcState>, id: ConnectionId) -> Result<(), String> {
    let client = state
        .remove(&id)
        .await
        .ok_or_else(|| unknown_connection(&id))?;
    client.disconnect().await.map_err(|e| e.to_string())
}

fn unknown_connection(id: &str) -> String {
    format!("unknown connection: {id}")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn raw_event_serializes_to_type_and_line() {
        let json = serde_json::to_string(&ClientEvent::Raw {
            line: ":srv 001 me :hi".into(),
        })
        .unwrap();
        assert_eq!(json, r#"{"type":"raw","line":":srv 001 me :hi"}"#);
    }

    #[test]
    fn variant_tags_are_camelcase() {
        assert_eq!(
            serde_json::to_string(&ClientEvent::SocketConnected).unwrap(),
            r#"{"type":"socketConnected"}"#
        );
        assert_eq!(
            serde_json::to_string(&ClientEvent::Closed).unwrap(),
            r#"{"type":"closed"}"#
        );
        assert_eq!(
            serde_json::to_string(&ClientEvent::Error {
                message: "boom".into()
            })
            .unwrap(),
            r#"{"type":"error","message":"boom"}"#
        );
    }

    #[test]
    fn encoding_is_case_insensitive_and_defaults_to_utf8() {
        let args = |encoding: Option<&str>| ConnectArgs {
            host: "irc.example.com".into(),
            port: 6697,
            tls: true,
            encoding: encoding.map(Into::into),
        };
        assert_eq!(
            IrcClientOptions::from(args(Some("LATIN1"))).encoding,
            Encoding::Latin1
        );
        assert_eq!(
            IrcClientOptions::from(args(Some("binary"))).encoding,
            Encoding::Latin1
        );
        assert_eq!(
            IrcClientOptions::from(args(Some("utf8"))).encoding,
            Encoding::Utf8
        );
        assert_eq!(IrcClientOptions::from(args(None)).encoding, Encoding::Utf8);
    }
}
