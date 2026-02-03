# Bug: `--today` and other date filters use UTC instead of local timezone

## Description

When running commands with `--today`, the results don't reflect today's date in my local timezone. I'm in KST (UTC+9), and running `--today` in the morning shows no data — or shows yesterday's data — because the filter appears to use UTC rather than my local timezone.

I'm a happy user of tokscale but not deeply familiar with the codebase, so I dug into the source to understand what's happening and am reporting my findings here.

## Steps to reproduce

1. Be in a timezone ahead of UTC (e.g. KST, UTC+9)
2. Use the CLI sometime before 9:00 AM local time (i.e. before midnight UTC)
3. Run any command with `--today`:
   ```
   tokscale --today
   ```
4. Observe that the output is empty or shows the previous day's usage

## Expected behavior

`--today` should show usage for today in my **local timezone**.

## Actual behavior

`--today` resolves to yesterday's date (UTC), so today's local usage is missing from the results.

## Affected flags

This is not limited to `--today`. All date-relative flags go through the same code path and are affected:

- `--today` — resolves "today" in UTC
- `--week` — computes the 7-day window in UTC
- `--month` — computes the start of month in UTC

## Root cause

After looking into the source, the issue comes from two places that both use UTC instead of local timezone:

### 1. CLI date filter (`packages/cli/src/cli.ts`, line 150)

```typescript
function formatDate(date: Date): string {
  return date.toISOString().split("T")[0];
}
```

`Date.toISOString()` always outputs in UTC. So even though `new Date()` captures the current moment, the resulting date string is the UTC date, not the local date. For example, at `2026-02-04 08:00 KST`:

- Local date: `2026-02-04`
- `toISOString()`: `"2026-02-03T23:00:00.000Z"` → extracts `"2026-02-03"`

### 2. Data storage (`packages/core/src/sessions/mod.rs`, line 145)

```rust
fn timestamp_to_date(timestamp_ms: i64) -> String {
    use chrono::{TimeZone, Utc};
    let datetime = Utc.timestamp_millis_opt(timestamp_ms);
    match datetime {
        chrono::LocalResult::Single(dt) => dt.format("%Y-%m-%d").to_string(),
        _ => String::new(),
    }
}
```

Each message's `.date` field is formatted using `chrono::Utc`, so dates stored on messages are also UTC dates.

Both sides are consistently UTC, which means data and filters do match each other — but they don't match the user's expectation of what "today" means.

## Possible fix

Both the TypeScript filter and the Rust date conversion need to use the local timezone.

### TypeScript (`packages/cli/src/cli.ts`)

Replace the `formatDate` function with one that uses local date components:

```typescript
function formatDate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}
```

This uses `getFullYear()`, `getMonth()`, and `getDate()` which all return values in the **local timezone**, unlike `toISOString()` which converts to UTC.

### Rust (`packages/core/src/sessions/mod.rs`)

Use `chrono::Local` instead of `chrono::Utc`:

```rust
fn timestamp_to_date(timestamp_ms: i64) -> String {
    use chrono::{TimeZone, Local};
    let datetime = Local.timestamp_millis_opt(timestamp_ms);
    match datetime {
        chrono::LocalResult::Single(dt) => dt.format("%Y-%m-%d").to_string(),
        _ => String::new(),
    }
}
```

Both changes must be applied together to keep the filter dates and message dates in the same timezone.

## Environment

- Timezone: KST (UTC+9)
- OS: macOS
