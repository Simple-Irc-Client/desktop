use std::collections::HashMap;

use sic_irc::dcc::DccSession;
use tokio::sync::Mutex;

pub type SessionId = String;

pub struct DccState {
    pub sessions: Mutex<HashMap<SessionId, DccSession>>,
}

impl DccState {
    pub fn new() -> Self {
        Self {
            sessions: Mutex::new(HashMap::new()),
        }
    }
}

impl Default for DccState {
    fn default() -> Self {
        Self::new()
    }
}
