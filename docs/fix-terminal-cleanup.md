# Fix Plan: Terminal Escape Sequences Leak After TUI Exit

## Problem Statement

When the TUI application exits, garbage characters appear in the terminal:
```
51;77;17M51;78;17M51;78;18M9;5u51;78;19M51;79;20M...
```

These are **SGR mouse tracking sequences** (`51;77;17M`) and **Kitty keyboard protocol sequences** (`9;5u`) that continue to be emitted because terminal modes were not properly disabled on exit.

## Root Cause Analysis

### 1. Current Exit Implementation (Problematic)

**File: `packages/cli/src/tui/App.tsx` (line 101-102)**
```typescript
useKeyboard((key) => {
  if (key.name === "q") {
    process.exit(0);  // ❌ PROBLEM: Bypasses all cleanup!
  }
});
```

### 2. Why This Fails

| Terminal Mode | Enable Sequence | Disable Sequence | Current Status |
|---------------|-----------------|------------------|----------------|
| SGR Mouse Tracking | `CSI ?1003h` + `CSI ?1006h` | `CSI ?1003l` + `CSI ?1006l` | ❌ Not disabled |
| Kitty Keyboard | `CSI ?2010h` | `CSI ?2010l` | ❌ Not disabled |
| Alternate Screen | `CSI ?1049h` | `CSI ?1049l` | ❌ Not disabled |

### 3. Technical Details

- **`process.exit(0)`** immediately terminates the Node.js process
- Solid.js `onCleanup()` hooks are **NOT called** on `process.exit()`
- OpenTUI's renderer `stop()` method is **NOT called**
- Terminal remains in mouse tracking + kitty keyboard mode
- Subsequent mouse movements/keypresses generate escape sequences that are printed as text

## Critical Finding: `stop()` vs `destroy()`

**From OpenTUI source code analysis:**

| Method | What it does | Terminal State |
|--------|--------------|----------------|
| `renderer.stop()` | Stops render loop, clears timers | ❌ NOT restored |
| `renderer.destroy()` | Full cleanup: stdin, listeners, raw mode | ✅ RESTORED |

**`destroy()` cleanup includes:**
1. Process event listeners (SIGWINCH, uncaughtException, etc.)
2. Exit signal listeners
3. All timers
4. Renderable tree (recursive destruction)
5. **Stdin raw mode** (`stdin.setRawMode(false)`) - **CRITICAL**
6. Stdin data listener
7. Native renderer resources
8. User's `onDestroy` callback

**This is why we MUST use `destroy()`, not `stop()`!**

---

## Reference: OpenCode's Exit Pattern

From `sst/opencode` (the reference implementation using OpenTUI):

```typescript
// context/exit.tsx
export const { use: useExit, provider: ExitProvider } = createSimpleContext({
  name: "Exit",
  init: (input: { onExit?: () => Promise<void> }) => {
    const renderer = useRenderer()
    return async (reason?: any) => {
      renderer.setTerminalTitle("")  // Reset window title
      renderer.destroy()              // Full cleanup
      await input.onExit?.()          // Custom cleanup
      process.exit(0)                 // Explicit exit
    }
  },
})
```

**Key patterns:**
1. Reset terminal title before destroy
2. Call `renderer.destroy()` (not `stop()`)
3. Run custom cleanup callbacks
4. Explicit `process.exit(0)` after cleanup

---

## Solution Architecture

### Design Principles

1. **Never call `process.exit()` directly** from within the TUI
2. **Use OpenTUI's `renderer.stop()`** to trigger proper cleanup
3. **Handle ALL exit scenarios** (quit, Ctrl+C, signals, crashes)
4. **Implement idempotent cleanup** to prevent double-cleanup issues
5. **Add fallback manual cleanup** for crash scenarios

### Exit Flow Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                     EXIT TRIGGERS                                │
├─────────────────────────────────────────────────────────────────┤
│  [q key]    [Ctrl+C]    [SIGTERM]    [Crash]    [SIGHUP]        │
└──────┬──────────┬──────────┬───────────┬──────────┬─────────────┘
       │          │          │           │          │
       ▼          ▼          ▼           ▼          ▼
┌─────────────────────────────────────────────────────────────────┐
│                requestShutdown(reason)                          │
│                    (Idempotent Guard)                           │
└──────────────────────────┬──────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│              renderer.stop()                                     │
│  - Disables mouse tracking (CSI ?1000l ?1003l ?1006l)           │
│  - Disables kitty keyboard (CSI ?2010l)                          │
│  - Exits alternate screen (CSI ?1049l)                           │
│  - Restores cursor visibility (CSI ?25h)                         │
│  - Resets text attributes (CSI 0m)                               │
└──────────────────────────┬──────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│              process.exit(exitCode)                              │
└─────────────────────────────────────────────────────────────────┘
```

## Implementation Plan

### Task 1: Create Terminal Cleanup Utility

**File: `packages/cli/src/tui/utils/cleanup.ts` (NEW)**

**Purpose**: Provide fallback terminal restoration for crash scenarios

**Implementation**:
```typescript
/**
 * Manual terminal state restoration sequences.
 * Used as fallback when OpenTUI cleanup fails or process crashes.
 */
export const TERMINAL_CLEANUP_SEQUENCES = [
  // Disable mouse tracking modes
  '\x1b[?1000l',  // Disable normal mouse tracking
  '\x1b[?1002l',  // Disable button-event tracking
  '\x1b[?1003l',  // Disable any-event tracking (SGR)
  '\x1b[?1006l',  // Disable SGR extended mode
  '\x1b[?1015l',  // Disable urxvt extended mode
  
  // Disable kitty keyboard protocol
  '\x1b[?2010l',  // Disable kitty keyboard
  '\x1b[>4;0m',   // Disable modifyOtherKeys (xterm)
  
  // Disable synchronized updates
  '\x1b[?2026l',
  
  // Restore cursor and attributes
  '\x1b[?25h',    // Show cursor
  '\x1b[0m',      // Reset text attributes
  
  // Exit alternate screen
  '\x1b[?1049l',
  '\x1b[?47l',    // Legacy alternate screen
  '\x1b[?1047l',  // Another legacy mode
].join('');

let hasCleanedUp = false;

/**
 * Write terminal restoration sequences to stdout.
 * Idempotent - safe to call multiple times.
 */
export function restoreTerminalState(): void {
  if (hasCleanedUp) return;
  hasCleanedUp = true;
  
  try {
    process.stdout.write(TERMINAL_CLEANUP_SEQUENCES);
  } catch {
    // Ignore write errors (stdout may be closed)
  }
}

/**
 * Reset cleanup state (for testing or re-initialization).
 */
export function resetCleanupState(): void {
  hasCleanedUp = false;
}
```

**Verification**:
- [ ] File created with correct escape sequences
- [ ] Idempotent guard prevents double-cleanup
- [ ] Error handling for closed stdout

---

### Task 2: Create Shutdown Manager

**File: `packages/cli/src/tui/utils/shutdown.ts` (NEW)**

**Purpose**: Centralize all shutdown logic with proper coordination

**Implementation**:
```typescript
import type { CliRenderer } from "@opentui/core";
import { restoreTerminalState } from "./cleanup.js";

type ShutdownReason = 'quit' | 'sigint' | 'sigterm' | 'sighup' | 'error' | 'uncaughtException';

interface ShutdownOptions {
  renderer: CliRenderer | null;
  onBeforeShutdown?: () => void | Promise<void>;
}

let isShuttingDown = false;
let shutdownOptions: ShutdownOptions | null = null;

/**
 * Initialize shutdown manager with renderer reference.
 * Must be called after render() creates the renderer.
 */
export function initShutdownManager(options: ShutdownOptions): void {
  shutdownOptions = options;
  setupSignalHandlers();
  setupCrashHandlers();
}

/**
 * Request graceful shutdown.
 * Idempotent - safe to call multiple times.
 */
export async function requestShutdown(
  reason: ShutdownReason,
  exitCode: number = 0
): Promise<never> {
  if (isShuttingDown) {
    // Already shutting down, just wait
    await new Promise(() => {}); // Never resolves
    process.exit(exitCode); // Fallback
  }
  
  isShuttingDown = true;
  
  try {
    // Run user cleanup
    if (shutdownOptions?.onBeforeShutdown) {
      await shutdownOptions.onBeforeShutdown();
    }
    
    // Destroy renderer (triggers OpenTUI cleanup)
    // CRITICAL: Use destroy(), NOT stop()!
    // - stop() only pauses rendering
    // - destroy() restores terminal state (raw mode, mouse tracking, kitty keyboard)
    if (shutdownOptions?.renderer) {
      shutdownOptions.renderer.destroy();
      // Give renderer time to cleanup
      await new Promise(resolve => setTimeout(resolve, 50));
    }
  } catch (error) {
    console.error('Error during shutdown:', error);
  } finally {
    // Fallback: ensure terminal is restored even if renderer.stop() fails
    restoreTerminalState();
  }
  
  process.exit(exitCode);
}

function setupSignalHandlers(): void {
  // Handle Ctrl+C
  process.on('SIGINT', () => {
    requestShutdown('sigint', 0);
  });
  
  // Handle termination signal
  process.on('SIGTERM', () => {
    requestShutdown('sigterm', 0);
  });
  
  // Handle terminal hangup
  process.on('SIGHUP', () => {
    requestShutdown('sighup', 0);
  });
}

function setupCrashHandlers(): void {
  // Handle uncaught exceptions
  process.on('uncaughtException', (error) => {
    console.error('Uncaught exception:', error);
    // Synchronous fallback for crashes
    restoreTerminalState();
    process.exit(1);
  });
  
  // Handle unhandled promise rejections
  process.on('unhandledRejection', (reason) => {
    console.error('Unhandled rejection:', reason);
    // Synchronous fallback for crashes
    restoreTerminalState();
    process.exit(1);
  });
  
  // Last-resort cleanup on exit
  process.on('exit', () => {
    restoreTerminalState();
  });
}

/**
 * Check if shutdown is in progress.
 */
export function isShutdownInProgress(): boolean {
  return isShuttingDown;
}
```

**Verification**:
- [ ] All signal handlers registered
- [ ] Idempotent shutdown guard works
- [ ] Crash handlers restore terminal state
- [ ] Renderer stop() is called before process.exit()

---

### Task 3: Update TUI Entry Point

**File: `packages/cli/src/tui/index.tsx` (MODIFY)**

**Changes**:
1. Remove `exitOnCtrlC: false` (let shutdown manager handle it)
2. Get renderer reference via `useRenderer()` context provider
3. Initialize shutdown manager

**Before**:
```typescript
import { render } from "@opentui/solid";
import { App } from "./App.js";
import type { TUIOptions } from "./types/index.js";

export type { TUIOptions };

export async function launchTUI(options?: TUIOptions) {
  await render(() => <App {...(options ?? {})} />, {
    exitOnCtrlC: false,
    useAlternateScreen: true,
    useMouse: true,
    targetFps: 60,
    useKittyKeyboard: {},
  } as any);
}
```

**After**:
```typescript
import { render } from "@opentui/solid";
import { App } from "./App.js";
import type { TUIOptions } from "./types/index.js";
import { initShutdownManager, requestShutdown } from "./utils/shutdown.js";
import { restoreTerminalState } from "./utils/cleanup.js";

export type { TUIOptions };

// Store renderer reference for shutdown
let rendererInstance: any = null;

export async function launchTUI(options?: TUIOptions) {
  // Setup crash handlers immediately (before render)
  process.on('uncaughtException', (error) => {
    console.error('Uncaught exception:', error);
    restoreTerminalState();
    process.exit(1);
  });
  
  process.on('unhandledRejection', (reason) => {
    console.error('Unhandled rejection:', reason);
    restoreTerminalState();
    process.exit(1);
  });

  await render(() => <App {...(options ?? {})} />, {
    exitOnCtrlC: false,  // We handle this in shutdown manager
    useAlternateScreen: true,
    useMouse: true,
    targetFps: 60,
    useKittyKeyboard: {},
  } as any);
}
```

**Note**: The renderer reference will be obtained inside App.tsx via `useRenderer()` hook.

**Verification**:
- [ ] Crash handlers installed before render
- [ ] Config options preserved
- [ ] No TypeScript errors

---

### Task 4: Update App Component

**File: `packages/cli/src/tui/App.tsx` (MODIFY)**

**Changes**:
1. Import `useRenderer` hook
2. Replace `process.exit(0)` with `renderer.stop()`
3. Add cleanup registration via `onCleanup`

**Key Change** (line 100-103):

**Before**:
```typescript
useKeyboard((key) => {
  if (key.name === "q") {
    process.exit(0);
  }
  // ... rest of handler
});
```

**After**:
```typescript
import { useRenderer } from "@opentui/solid";

export function App(props: AppProps) {
  const renderer = useRenderer();
  
  // ... existing code ...
  
  useKeyboard((key) => {
    if (key.name === "q") {
      // CRITICAL: Use destroy(), NOT stop()!
      // - stop() only pauses rendering
      // - destroy() restores terminal state (raw mode, mouse tracking, etc.)
      renderer.destroy();
      return;
    }
    // ... rest of handler
  });
  
  // ... rest of component
}
```

**Verification**:
- [ ] `useRenderer()` imported and called
- [ ] `process.exit(0)` replaced with `renderer.destroy()`
- [ ] No TypeScript errors
- [ ] TUI exits cleanly on 'q' press
- [ ] No garbage characters after exit

---

### Task 5: Export Utility Functions

**File: `packages/cli/src/tui/utils/index.ts` (MODIFY or CREATE)**

**Purpose**: Export cleanup utilities for use in other parts of the codebase

**Implementation**:
```typescript
export * from "./colors.js";
export * from "./format.js";
export * from "./responsive.js";
export * from "./cleanup.js";
export * from "./shutdown.js";
```

**Verification**:
- [ ] All exports accessible
- [ ] No circular dependencies

---

### Task 6: Update Type Definitions

**File: `packages/cli/src/tui/opentui.d.ts` (VERIFY)**

Ensure `useRenderer()` is properly typed and `CliRenderer` includes `destroy()`:

```typescript
declare module "@opentui/core" {
  export interface CliRenderer {
    root: { add: (renderable: unknown) => void };
    start: () => void;
    stop: () => void;      // Only pauses rendering
    destroy: () => void;   // FULL CLEANUP - restores terminal state
    console: { show: () => void };
  }
}

declare module "@opentui/solid" {
  // ... existing types ...
  
  export function useRenderer(): CliRenderer;
}
```

**Verification**:
- [ ] `useRenderer` function is declared
- [ ] Return type is `CliRenderer`
- [ ] `CliRenderer.destroy()` method exists (critical - does full cleanup)
- [ ] `CliRenderer.stop()` method exists (optional - only pauses rendering)

---

## Testing Plan

### Manual Testing Checklist

| Test Case | Expected Result | Verified |
|-----------|-----------------|----------|
| Press 'q' to quit | Clean exit, no garbage characters | [ ] |
| Press Ctrl+C | Clean exit, no garbage characters | [ ] |
| Close terminal window (SIGHUP) | Clean exit | [ ] |
| Kill process (SIGTERM) | Clean exit | [ ] |
| Throw uncaught exception | Terminal restored, error logged | [ ] |
| Rapid quit (press 'q' multiple times) | Single clean exit | [ ] |
| Mouse movement after exit | No escape sequences printed | [ ] |
| Keyboard input after exit | Normal shell input | [ ] |

### Verification Commands

```bash
# Test normal quit
bun run cli && echo "Exit successful"

# Test with mouse movement after quit
bun run cli  # quit with 'q', then move mouse

# Test Ctrl+C
bun run cli  # press Ctrl+C

# Test crash handling
# (Add a deliberate throw in the code temporarily)
```

---

## Rollback Plan

If issues arise, the changes can be reverted by:

1. Restore original `App.tsx` with `process.exit(0)`
2. Remove new utility files (`cleanup.ts`, `shutdown.ts`)
3. Restore original `index.tsx`

The changes are isolated to the TUI module and don't affect other CLI functionality.

---

## Files Changed Summary

| File | Action | Risk Level |
|------|--------|------------|
| `packages/cli/src/tui/utils/cleanup.ts` | CREATE | Low |
| `packages/cli/src/tui/utils/shutdown.ts` | CREATE | Low |
| `packages/cli/src/tui/utils/index.ts` | MODIFY | Low |
| `packages/cli/src/tui/index.tsx` | MODIFY | Medium |
| `packages/cli/src/tui/App.tsx` | MODIFY | Medium |
| `packages/cli/src/tui/opentui.d.ts` | VERIFY | Low |

---

## Success Criteria

1. **No garbage characters** appear in terminal after TUI exit
2. **All exit methods work** (q, Ctrl+C, signals)
3. **Terminal is fully restored** (cursor visible, normal mode)
4. **No regressions** in existing TUI functionality
5. **Clean TypeScript compilation** with no errors

---

## Timeline Estimate

| Task | Estimated Time |
|------|----------------|
| Task 1: Create cleanup utility | 15 min |
| Task 2: Create shutdown manager | 30 min |
| Task 3: Update entry point | 15 min |
| Task 4: Update App component | 15 min |
| Task 5: Export utilities | 5 min |
| Task 6: Verify types | 10 min |
| Testing | 30 min |
| **Total** | **~2 hours** |
