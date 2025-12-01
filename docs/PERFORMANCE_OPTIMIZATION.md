# CLI Performance Optimization Design Doc

## Overview

This document outlines a plan to significantly improve the performance of the `token-tracker` CLI by implementing a native Rust core module using **napi-rs**.

## Current Architecture

```
token-tracker CLI (TypeScript/Node.js)
├── src/cli.ts           # Entry point
├── src/graph.ts         # Graph data generation
├── src/claudecode.ts    # Claude Code session parsing
├── src/gemini.ts        # Gemini session parsing
└── src/opencode.ts      # OpenCode session parsing
```

### Performance Bottlenecks

1. **File Discovery**: Sequential `fs.readdir` / `walkdir` operations
2. **JSON Parsing**: Node.js JSON.parse is single-threaded
3. **Session Processing**: Each session file processed sequentially
4. **Cost Calculation**: CPU-bound aggregation on single thread

## Proposed Architecture

```
token-tracker CLI
├── TypeScript Layer (CLI interface)
│   ├── src/cli.ts           # Commander.js CLI
│   └── src/commands/*.ts    # Command handlers
│
└── Rust Native Core (@token-tracker/core)
    ├── src/lib.rs           # NAPI exports
    ├── src/scanner.rs       # Parallel file discovery
    ├── src/parser.rs        # SIMD JSON parsing
    ├── src/sessions/
    │   ├── claudecode.rs    # Claude Code parser
    │   ├── gemini.rs        # Gemini parser
    │   └── opencode.rs      # OpenCode parser
    └── src/aggregator.rs    # Parallel cost aggregation
```

## Implementation Plan

### Phase 1: Project Setup

```bash
# Create native module
npx @napi-rs/cli new core
cd core
```

**Cargo.toml:**
```toml
[package]
name = "token-tracker-core"
version = "0.1.0"
edition = "2021"

[lib]
crate-type = ["cdylib"]

[dependencies]
napi = { version = "3", features = ["async", "tokio_rt"] }
napi-derive = "3"
rayon = "1.10"
simd-json = "0.14"
walkdir = "2"
globset = "0.4"
chrono = { version = "0.4", features = ["serde"] }
serde = { version = "1", features = ["derive"] }
serde_json = "1"

[build-dependencies]
napi-build = "2"

[profile.release]
lto = true
opt-level = 3
codegen-units = 1
```

### Phase 2: Parallel File Scanner

```rust
// src/scanner.rs
use rayon::prelude::*;
use walkdir::WalkDir;
use std::path::PathBuf;

pub struct ScanResult {
    pub claude_sessions: Vec<PathBuf>,
    pub gemini_sessions: Vec<PathBuf>,
    pub opencode_sessions: Vec<PathBuf>,
}

pub fn scan_all_sources(home_dir: &str) -> ScanResult {
    let paths = vec![
        (format!("{}/.claude/projects", home_dir), SessionType::Claude),
        (format!("{}/.gemini/sessions", home_dir), SessionType::Gemini),
        (format!("{}/.local/share/opencode/storage", home_dir), SessionType::OpenCode),
    ];

    // Parallel scan of all source directories
    let results: Vec<(SessionType, Vec<PathBuf>)> = paths
        .into_par_iter()
        .map(|(path, session_type)| {
            let files = scan_directory(&path, &session_type);
            (session_type, files)
        })
        .collect();

    // Aggregate results
    // ...
}

fn scan_directory(root: &str, session_type: &SessionType) -> Vec<PathBuf> {
    WalkDir::new(root)
        .into_iter()
        .par_bridge() // Convert to parallel iterator
        .filter_map(|e| e.ok())
        .filter(|e| is_session_file(e, session_type))
        .map(|e| e.path().to_path_buf())
        .collect()
}
```

### Phase 3: SIMD JSON Parser

```rust
// src/parser.rs
use simd_json;
use serde::Deserialize;

#[derive(Deserialize)]
pub struct ClaudeMessage {
    pub role: String,
    pub content: String,
    pub timestamp: Option<String>,
}

pub fn parse_session_fast(path: &Path) -> Result<Vec<Message>> {
    let mut data = std::fs::read(path)?;
    
    // SIMD-accelerated JSON parsing (2-4x faster than serde_json)
    let value: serde_json::Value = simd_json::serde::from_slice(&mut data)?;
    
    extract_messages(&value)
}

// Batch parsing with parallel processing
pub fn parse_sessions_batch(paths: Vec<PathBuf>) -> Vec<SessionData> {
    paths
        .par_iter()
        .filter_map(|path| {
            parse_session_fast(path).ok()
        })
        .collect()
}
```

### Phase 4: Parallel Aggregation

```rust
// src/aggregator.rs
use rayon::prelude::*;
use std::collections::HashMap;

#[napi(object)]
pub struct DailyContribution {
    pub date: String,
    pub cost: f64,
    pub tokens: u64,
    pub messages: u32,
    pub intensity: u8,
}

#[napi]
pub fn aggregate_contributions(
    sessions: Vec<SessionData>,
) -> Vec<DailyContribution> {
    // Parallel map-reduce aggregation
    let daily_map: HashMap<String, DayStats> = sessions
        .par_iter()
        .flat_map(|session| session.messages.par_iter())
        .fold(
            || HashMap::new(),
            |mut acc, msg| {
                let date = msg.date.clone();
                let entry = acc.entry(date).or_default();
                entry.cost += msg.cost;
                entry.tokens += msg.tokens;
                entry.messages += 1;
                acc
            },
        )
        .reduce(
            || HashMap::new(),
            |mut a, b| {
                for (k, v) in b {
                    let entry = a.entry(k).or_default();
                    entry.merge(v);
                }
                a
            },
        );

    // Convert to sorted vector
    let mut contributions: Vec<_> = daily_map
        .into_iter()
        .map(|(date, stats)| DailyContribution::from(date, stats))
        .collect();
    
    contributions.par_sort_by(|a, b| a.date.cmp(&b.date));
    contributions
}
```

### Phase 5: NAPI Exports

```rust
// src/lib.rs
use napi::bindgen_prelude::*;
use napi_derive::napi;

mod scanner;
mod parser;
mod aggregator;
mod sessions;

#[napi(object)]
pub struct GraphOptions {
    pub home_dir: String,
    pub include_sources: Option<Vec<String>>,
    pub date_range: Option<DateRange>,
    pub parallel_threads: Option<u32>,
}

#[napi(object)]
pub struct GraphResult {
    pub contributions: Vec<DailyContribution>,
    pub summary: DataSummary,
    pub processing_time_ms: u32,
}

#[napi]
pub async fn generate_graph(options: GraphOptions) -> Result<GraphResult> {
    let start = std::time::Instant::now();
    
    // Configure thread pool
    if let Some(threads) = options.parallel_threads {
        rayon::ThreadPoolBuilder::new()
            .num_threads(threads as usize)
            .build_global()
            .ok();
    }

    // 1. Parallel file discovery
    let scan_result = scanner::scan_all_sources(&options.home_dir);

    // 2. Parallel session parsing
    let sessions = parser::parse_sessions_batch(scan_result.all_files());

    // 3. Parallel aggregation
    let contributions = aggregator::aggregate_contributions(sessions);

    // 4. Calculate summary
    let summary = aggregator::calculate_summary(&contributions);

    Ok(GraphResult {
        contributions,
        summary,
        processing_time_ms: start.elapsed().as_millis() as u32,
    })
}
```

### Phase 6: TypeScript Integration

```typescript
// src/cli.ts
import { generateGraph, type GraphOptions, type GraphResult } from '@token-tracker/core';

async function graphCommand(options: CLIOptions) {
    const result = await generateGraph({
        homeDir: os.homedir(),
        includeSources: options.sources,
        parallelThreads: options.threads ?? 4,
    });

    console.log(`Processed in ${result.processingTimeMs}ms`);
    
    if (options.json) {
        console.log(JSON.stringify(result, null, 2));
    } else {
        renderTable(result);
    }
}
```

## Expected Performance Gains

| Operation | Current (Node.js) | With Rust Core | Speedup |
|-----------|-------------------|----------------|---------|
| File Discovery | ~500ms | ~50ms | 10x |
| JSON Parsing | ~800ms | ~100ms | 8x |
| Aggregation | ~200ms | ~25ms | 8x |
| **Total** | **~1.5s** | **~175ms** | **~8.5x** |

*Benchmarks estimated for ~1000 session files, 100k messages*

## Build & Distribution

### Platform Support

```json
{
  "napi": {
    "name": "token-tracker-core",
    "triples": {
      "defaults": true,
      "additional": [
        "aarch64-apple-darwin",
        "aarch64-unknown-linux-gnu",
        "x86_64-unknown-linux-musl"
      ]
    }
  }
}
```

### CI/CD Pipeline

```yaml
# .github/workflows/build-native.yml
jobs:
  build:
    strategy:
      matrix:
        include:
          - os: macos-latest
            target: x86_64-apple-darwin
          - os: macos-latest
            target: aarch64-apple-darwin
          - os: ubuntu-latest
            target: x86_64-unknown-linux-gnu
          - os: ubuntu-latest
            target: aarch64-unknown-linux-gnu
          - os: windows-latest
            target: x86_64-pc-windows-msvc
    
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
      - uses: dtolnay/rust-toolchain@stable
      - run: npm install
      - run: npm run build -- --target ${{ matrix.target }}
      - uses: actions/upload-artifact@v4
```

## Migration Path

1. **v1.1**: Add native core as optional dependency (fallback to pure TS)
2. **v1.2**: Make native core the default, TS as fallback
3. **v2.0**: Remove pure TS implementation, native-only

## References

- [napi-rs Documentation](https://napi.rs/)
- [SWC Architecture](https://github.com/swc-project/swc)
- [OXC Parser](https://github.com/oxc-project/oxc)
- [Biome Traversal](https://github.com/biomejs/biome)
- [Nx Native Module](https://github.com/nrwl/nx/tree/master/packages/nx/src/native)
