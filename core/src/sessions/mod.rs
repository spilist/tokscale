//! Session parsers for different AI coding assistant formats
//!
//! Each source has its own parser that converts to a unified message format.

pub mod opencode;
pub mod claudecode;
pub mod codex;
pub mod gemini;

use crate::TokenBreakdown;

/// Unified message format across all sources
#[derive(Debug, Clone)]
pub struct UnifiedMessage {
    pub source: String,
    pub model_id: String,
    pub provider_id: String,
    pub timestamp: i64, // Unix milliseconds
    pub date: String,   // YYYY-MM-DD
    pub tokens: TokenBreakdown,
    pub cost: f64,
}

impl UnifiedMessage {
    /// Create a new unified message
    pub fn new(
        source: impl Into<String>,
        model_id: impl Into<String>,
        provider_id: impl Into<String>,
        timestamp: i64,
        tokens: TokenBreakdown,
        cost: f64,
    ) -> Self {
        let date = timestamp_to_date(timestamp);
        Self {
            source: source.into(),
            model_id: model_id.into(),
            provider_id: provider_id.into(),
            timestamp,
            date,
            tokens,
            cost,
        }
    }
}

/// Convert Unix milliseconds timestamp to YYYY-MM-DD date string
fn timestamp_to_date(timestamp_ms: i64) -> String {
    use chrono::{TimeZone, Utc};
    
    let datetime = Utc.timestamp_millis_opt(timestamp_ms);
    match datetime {
        chrono::LocalResult::Single(dt) => dt.format("%Y-%m-%d").to_string(),
        _ => String::new(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_timestamp_to_date() {
        // 2025-06-15 12:00:00 UTC
        let ts = 1750075200000_i64;
        let date = timestamp_to_date(ts);
        assert_eq!(date, "2025-06-15");
    }
}
