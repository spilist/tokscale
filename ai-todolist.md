# CLI Performance Optimization - Implementation Plan

## Overview
- **Goal**: Make CLI ~8x faster using napi-rs + Rust
- **Approach**: Hybrid (Rust + TS fallback)
- **Primary Metric**: Wall-clock time
- **Secondary Metric**: Memory usage (peak RSS)

---

## Phase 1: Benchmark Infrastructure

- [x] 1.1 Create `benchmarks/` directory structure
- [x] 1.2 Implement `benchmarks/generate.ts` - Synthetic data generator
- [x] 1.3 Implement `benchmarks/runner.ts` - Benchmark orchestrator
- [x] 1.4 Add npm scripts for benchmarking
- [x] 1.5 Run baseline benchmark with real data
- [x] 1.6 Document in `benchmarks/README.md`

## Phase 2: Rust Project Setup

- [x] 2.1 Initialize napi-rs project (`core/`)
- [x] 2.2 Configure `Cargo.toml` with dependencies
- [x] 2.3 Set up `build.rs` for napi-build
- [x] 2.4 Configure multi-platform targets
- [x] 2.5 Create `core/package.json`
- [x] 2.6 Add workspace config to root package.json
- [x] 2.7 Verify Rust build works

## Phase 3: Parallel File Scanner

- [x] 3.1 Implement `ScanResult` struct in `scanner.rs`
- [x] 3.2 Implement `scan_directory()` with walkdir
- [x] 3.3 Implement `scan_all_sources()` with parallel iteration
- [x] 3.4 Add NAPI export for scanner
- [x] 3.5 Write scanner unit tests (20+ tests in scanner.rs)

## Phase 4: SIMD JSON Parser

- [x] 4.1 Implement `parse_json_file()` with simd-json
- [x] 4.2 Implement `parse_jsonl_file()` for streaming
- [x] 4.3 Implement `parse_batch()` with Rayon
- [x] 4.4 Add error handling (skip malformed files)
- [x] 4.5 Benchmark SIMD vs serde_json (benches/json_parsing.rs)

## Phase 5: Session Parsers (Rust)

- [x] 5.1 Define `UnifiedMessage` struct
- [x] 5.2 Implement `opencode.rs` parser
- [x] 5.3 Implement `claudecode.rs` parser
- [x] 5.4 Implement `codex.rs` parser (stateful)
- [x] 5.5 Implement `gemini.rs` parser
- [x] 5.6 Implement `collect_all_messages()`
- [x] 5.7 Add integration tests for parsers (11 AVA tests in __test__/)

## Phase 6: Parallel Aggregation

- [x] 6.1 Implement `DailyContribution` struct
- [x] 6.2 Implement parallel map-reduce aggregation
- [x] 6.3 Implement intensity calculation
- [x] 6.4 Implement summary calculation
- [x] 6.5 Implement year breakdown
- [x] 6.6 Add NAPI export `generate_graph()`

## Phase 7: TypeScript Integration

- [x] 7.1 Create `src/native.ts` loader with fallback
- [x] 7.2 Update `src/graph.ts` to use native module
- [x] 7.3 Add CLI flags (`--native`, `--no-native`, `--benchmark`)
- [x] 7.4 Add timing output in verbose mode
- [x] 7.5 Update `package.json` dependencies
- [x] 7.6 Test fallback behavior

## Phase 8: CI/CD Pipeline

- [x] 8.1 Create `.github/workflows/build-native.yml`
- [x] 8.2 Add benchmark step to CI
- [x] 8.3 Configure artifact upload
- [x] 8.4 Add npm publish workflow (triggered on v* tags)
- [x] 8.5 Update main workflow for both TS and native tests

---

## 현재 진행 중인 작업

**ALL PHASES COMPLETE!** Project fully implemented with tests, benchmarks, and CI/CD.

---

## Progress Log

| Date | Task | Status | Notes |
|------|------|--------|-------|
| 2024-12-02 | Plan created | ✅ | Hybrid approach, wall-clock + memory metrics |
| 2025-12-02 | 1.1 Directory structure | ✅ | benchmarks/results/.gitkeep created |
| 2025-12-02 | 1.2 Synthetic generator | ✅ | 601 files, 4 source types |
| 2025-12-02 | 1.3 Benchmark runner | ✅ | TS baseline: 79ms, 371MB |
| 2025-12-02 | 1.4 NPM scripts | ✅ | bench:generate, bench:ts, bench:ts:synthetic |
| 2025-12-02 | 1.5 Real data baseline | ✅ | 18,671 msgs in 1806ms, 575MB |
| 2025-12-02 | 1.6 Documentation | ✅ | benchmarks/README.md created |
| 2025-12-02 | **PHASE 1 COMPLETE** | ✅ | Benchmark infrastructure ready |
| 2025-12-02 | 2.1-2.5, 2.7 Rust setup | ✅ | core/ created, native module builds & works |
| 2025-12-02 | 2.6 Root package.json | ✅ | build:core scripts added |
| 2025-12-02 | **PHASE 2 COMPLETE** | ✅ | Rust project ready, native module working |
| 2025-12-02 | Phase 3-6 Rust impl | ✅ | Scanner, parser, sessions, aggregator done |
| 2025-12-02 | Phase 7 TS integration | ✅ | native.ts, CLI flags, graph.ts integration |
| 2025-12-02 | **PHASES 3-7 COMPLETE** | ✅ | Native module fully working, ~45% less memory |
| 2025-12-02 | Phase 8.1-8.3 CI/CD | ✅ | build-native.yml with multi-platform builds |
| 2025-12-02 | 3.5, 4.5, 5.7 Tests | ✅ | 34 Rust tests + 11 AVA integration tests |
| 2025-12-02 | 8.4-8.5 CI/CD complete | ✅ | npm publish workflow, lint, test jobs |
| 2025-12-02 | **ALL PHASES COMPLETE** | ✅ | Full implementation with tests & CI/CD |
