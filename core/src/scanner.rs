//! Parallel file scanner for session directories
//!
//! Uses walkdir with rayon for parallel directory traversal.

use std::path::PathBuf;
use rayon::prelude::*;
use walkdir::WalkDir;

/// Session source type
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SessionType {
    OpenCode,
    Claude,
    Codex,
    Gemini,
}

/// Result of scanning all session directories
#[derive(Debug, Default)]
pub struct ScanResult {
    pub opencode_files: Vec<PathBuf>,
    pub claude_files: Vec<PathBuf>,
    pub codex_files: Vec<PathBuf>,
    pub gemini_files: Vec<PathBuf>,
}

impl ScanResult {
    /// Get total number of files found
    pub fn total_files(&self) -> usize {
        self.opencode_files.len()
            + self.claude_files.len()
            + self.codex_files.len()
            + self.gemini_files.len()
    }

    /// Get all files as a single vector
    pub fn all_files(&self) -> Vec<(SessionType, PathBuf)> {
        let mut result = Vec::with_capacity(self.total_files());
        
        for path in &self.opencode_files {
            result.push((SessionType::OpenCode, path.clone()));
        }
        for path in &self.claude_files {
            result.push((SessionType::Claude, path.clone()));
        }
        for path in &self.codex_files {
            result.push((SessionType::Codex, path.clone()));
        }
        for path in &self.gemini_files {
            result.push((SessionType::Gemini, path.clone()));
        }
        
        result
    }
}

/// Scan a single directory for session files
fn scan_directory(root: &str, pattern: &str) -> Vec<PathBuf> {
    if !std::path::Path::new(root).exists() {
        return Vec::new();
    }

    WalkDir::new(root)
        .into_iter()
        .par_bridge()
        .filter_map(|e| e.ok())
        .filter(|e| {
            let path = e.path();
            if !path.is_file() {
                return false;
            }
            
            let file_name = path.file_name().and_then(|n| n.to_str()).unwrap_or("");
            
            match pattern {
                "*.json" => file_name.ends_with(".json"),
                "*.jsonl" => file_name.ends_with(".jsonl"),
                "session-*.json" => file_name.starts_with("session-") && file_name.ends_with(".json"),
                _ => false,
            }
        })
        .map(|e| e.path().to_path_buf())
        .collect()
}

/// Scan all session source directories in parallel
pub fn scan_all_sources(home_dir: &str, sources: &[String]) -> ScanResult {
    let mut result = ScanResult::default();
    
    let include_all = sources.is_empty();
    let include_opencode = include_all || sources.iter().any(|s| s == "opencode");
    let include_claude = include_all || sources.iter().any(|s| s == "claude");
    let include_codex = include_all || sources.iter().any(|s| s == "codex");
    let include_gemini = include_all || sources.iter().any(|s| s == "gemini");

    // Define scan tasks
    let mut tasks: Vec<(SessionType, String, &str)> = Vec::new();

    if include_opencode {
        // OpenCode: ~/.local/share/opencode/storage/message/*/*.json
        let xdg_data = std::env::var("XDG_DATA_HOME")
            .unwrap_or_else(|_| format!("{}/.local/share", home_dir));
        let opencode_path = format!("{}/opencode/storage/message", xdg_data);
        tasks.push((SessionType::OpenCode, opencode_path, "*.json"));
    }

    if include_claude {
        // Claude: ~/.claude/projects/**/*.jsonl
        let claude_path = format!("{}/.claude/projects", home_dir);
        tasks.push((SessionType::Claude, claude_path, "*.jsonl"));
    }

    if include_codex {
        // Codex: ~/.codex/sessions/**/*.jsonl
        let codex_home = std::env::var("CODEX_HOME")
            .unwrap_or_else(|_| format!("{}/.codex", home_dir));
        let codex_path = format!("{}/sessions", codex_home);
        tasks.push((SessionType::Codex, codex_path, "*.jsonl"));
    }

    if include_gemini {
        // Gemini: ~/.gemini/tmp/*/chats/session-*.json
        let gemini_path = format!("{}/.gemini/tmp", home_dir);
        tasks.push((SessionType::Gemini, gemini_path, "session-*.json"));
    }

    // Execute scans in parallel
    let scan_results: Vec<(SessionType, Vec<PathBuf>)> = tasks
        .into_par_iter()
        .map(|(session_type, path, pattern)| {
            let files = scan_directory(&path, pattern);
            (session_type, files)
        })
        .collect();

    // Aggregate results
    for (session_type, files) in scan_results {
        match session_type {
            SessionType::OpenCode => result.opencode_files = files,
            SessionType::Claude => result.claude_files = files,
            SessionType::Codex => result.codex_files = files,
            SessionType::Gemini => result.gemini_files = files,
        }
    }

    result
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_scan_result_total_files() {
        let result = ScanResult {
            opencode_files: vec![PathBuf::from("a.json"), PathBuf::from("b.json")],
            claude_files: vec![PathBuf::from("c.jsonl")],
            codex_files: vec![],
            gemini_files: vec![PathBuf::from("d.json")],
        };
        assert_eq!(result.total_files(), 4);
    }
}
