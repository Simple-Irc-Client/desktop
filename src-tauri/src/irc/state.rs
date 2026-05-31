use std::collections::HashMap;

use sic_irc::IrcClient;
use tokio::sync::Mutex;

pub type ConnectionId = String;

pub struct IrcState {
    pub connections: Mutex<HashMap<ConnectionId, IrcClient>>,
}

impl IrcState {
    pub fn new() -> Self {
        Self {
            connections: Mutex::new(HashMap::new()),
        }
    }
}

impl Default for IrcState {
    fn default() -> Self {
        Self::new()
    }
}
