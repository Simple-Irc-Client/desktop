use std::collections::HashMap;

use sic_irc::IrcClient;
use tokio::sync::Mutex;

pub type ConnectionId = String;

/// Open IRC connections by id.
#[derive(Default)]
pub struct IrcState {
    connections: Mutex<HashMap<ConnectionId, IrcClient>>,
}

impl IrcState {
    pub async fn insert(&self, id: ConnectionId, client: IrcClient) {
        self.connections.lock().await.insert(id, client);
    }

    /// The handle is a cheap clone, so the lock isn't held while sending.
    pub async fn get(&self, id: &str) -> Option<IrcClient> {
        self.connections.lock().await.get(id).cloned()
    }

    pub async fn remove(&self, id: &str) -> Option<IrcClient> {
        self.connections.lock().await.remove(id)
    }
}
