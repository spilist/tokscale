/**
 * Cursor IDE API Client
 * Fetches usage data from Cursor's dashboard API via CSV export
 *
 * API Endpoint: https://cursor.com/api/dashboard/export-usage-events-csv?strategy=tokens
 * Authentication: WorkosCursorSessionToken cookie
 *
 * CSV Format:
 * Date,Model,Input (w/ Cache Write),Input (w/o Cache Write),Cache Read,Output Tokens,Total Tokens,Cost,Cost to you
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { createHash } from "node:crypto";
import { parse as parseCsv } from "csv-parse/sync";

// ============================================================================
// Types
// ============================================================================

export interface CursorCredentials {
  sessionToken: string;
  userId?: string;
  createdAt: string;
  expiresAt?: string;
  label?: string;
}

interface CursorCredentialsStoreV1 {
  version: 1;
  activeAccountId: string;
  accounts: Record<string, CursorCredentials>;
}

export interface CursorUsageRow {
  date: string; // YYYY-MM-DD
  timestamp: number; // Unix milliseconds
  model: string;
  inputWithCacheWrite: number;
  inputWithoutCacheWrite: number;
  cacheRead: number;
  outputTokens: number;
  totalTokens: number;
  apiCost: number; // in USD
  costToYou: number; // in USD
}

export interface CursorUsageData {
  source: "cursor";
  model: string;
  providerId: string;
  messageCount: number;
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  reasoning: number;
  cost: number;
}

export interface CursorMessageWithTimestamp {
  source: "cursor";
  model: string;
  providerId: string;
  timestamp: number;
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  reasoning: number;
  cost: number;
}

// ============================================================================
// Credential Management
// ============================================================================

const OLD_CONFIG_DIR = path.join(os.homedir(), ".tokscale");
const CONFIG_DIR = path.join(os.homedir(), ".config", "tokscale");
const OLD_CURSOR_CREDENTIALS_FILE = path.join(OLD_CONFIG_DIR, "cursor-credentials.json");
const CURSOR_CREDENTIALS_FILE = path.join(CONFIG_DIR, "cursor-credentials.json");

function ensureConfigDir(): void {
  if (!fs.existsSync(CONFIG_DIR)) {
    fs.mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 });
  }
}

/**
 * Migrate Cursor credentials and cache from old path to new XDG path
 */
function migrateCursorFromOldPath(): void {
  try {
    // Migrate cursor credentials
    if (!fs.existsSync(CURSOR_CREDENTIALS_FILE) && fs.existsSync(OLD_CURSOR_CREDENTIALS_FILE)) {
      ensureConfigDir();
      fs.copyFileSync(OLD_CURSOR_CREDENTIALS_FILE, CURSOR_CREDENTIALS_FILE);
      fs.chmodSync(CURSOR_CREDENTIALS_FILE, 0o600);
      fs.unlinkSync(OLD_CURSOR_CREDENTIALS_FILE);
    }

    // Migrate cache directory (handled after CURSOR_CACHE_DIR is defined)
    // Cache migration happens in migrateCursorCacheFromOldPath()

    // Try to remove old config directory if empty
    try {
      fs.rmdirSync(OLD_CONFIG_DIR);
    } catch {
      // Directory not empty - ignore
    }
  } catch {
    // Migration failed - continue with normal operation
  }
}

export function ensureCursorMigration(): void {
  // Best-effort: never throw
  try {
    migrateCursorFromOldPath();
  } catch {}
  try {
    migrateCursorCacheFromOldPath();
  } catch {}
  try {
    // Triggers legacy schema -> v1 store migration if needed
    loadCursorCredentialsStoreInternal();
  } catch {}
}

function isStoreV1(data: unknown): data is CursorCredentialsStoreV1 {
  if (!data || typeof data !== "object") return false;
  const obj = data as Record<string, unknown>;
  return obj.version === 1 && typeof obj.activeAccountId === "string" && typeof obj.accounts === "object" && obj.accounts !== null;
}

function extractUserIdFromSessionToken(sessionToken: string): string | null {
  if (!sessionToken) return null;
  const token = sessionToken.trim();
  if (token.includes("%3A%3A")) {
    const userId = token.split("%3A%3A")[0]?.trim();
    return userId ? userId : null;
  }
  if (token.includes("::")) {
    const userId = token.split("::")[0]?.trim();
    return userId ? userId : null;
  }
  return null;
}

function sanitizeAccountIdForFilename(accountId: string): string {
  return accountId
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "account";
}

function isCursorUsageCsvFilename(fileName: string): boolean {
  if (fileName === "usage.csv") return true;
  if (!fileName.startsWith("usage.")) return false;
  if (!fileName.endsWith(".csv")) return false;
  // Exclude legacy backups (were previously written as usage.backup-<ts>.csv)
  if (fileName.startsWith("usage.backup")) return false;

  const stem = fileName.slice("usage.".length, -".csv".length);
  if (!stem) return false;
  return /^[a-z0-9._-]+$/i.test(stem);
}

function deriveAccountId(sessionToken: string): string {
  const userId = extractUserIdFromSessionToken(sessionToken);
  if (userId) return userId;
  const hash = createHash("sha256").update(sessionToken).digest("hex").slice(0, 12);
  return `anon-${hash}`;
}

function atomicWriteFile(filePath: string, data: string, mode: number): void {
  const dir = path.dirname(filePath);
  const base = path.basename(filePath);
  const tmp = path.join(dir, `.${base}.tmp-${process.pid}`);
  fs.writeFileSync(tmp, data, { encoding: "utf-8", mode });
  try {
    fs.renameSync(tmp, filePath);
  } catch {
    // Best-effort for platforms where rename over an existing file can fail.
    try {
      if (fs.existsSync(filePath)) fs.rmSync(filePath);
    } catch {
      // ignore
    }
    fs.renameSync(tmp, filePath);
  }
}

function loadCursorCredentialsStoreInternal(): CursorCredentialsStoreV1 | null {
  migrateCursorFromOldPath();
  try {
    if (!fs.existsSync(CURSOR_CREDENTIALS_FILE)) return null;
    const data = fs.readFileSync(CURSOR_CREDENTIALS_FILE, "utf-8");
    const parsed: unknown = JSON.parse(data);

    if (isStoreV1(parsed)) {
      const store = parsed;
      if (!store.activeAccountId || !store.accounts[store.activeAccountId]) {
        const firstId = Object.keys(store.accounts)[0];
        if (!firstId) return null;
        store.activeAccountId = firstId;
        ensureConfigDir();
        atomicWriteFile(CURSOR_CREDENTIALS_FILE, JSON.stringify(store, null, 2), 0o600);
      }
      return store;
    }

    // Legacy single-account schema: { sessionToken, createdAt, ... }
    if (parsed && typeof parsed === "object") {
      const obj = parsed as Record<string, unknown>;
      const sessionToken = typeof obj.sessionToken === "string" ? obj.sessionToken : "";
      if (!sessionToken) return null;

      const accountId = deriveAccountId(sessionToken);
      const migrated: CursorCredentialsStoreV1 = {
        version: 1,
        activeAccountId: accountId,
        accounts: {
          [accountId]: {
            sessionToken,
            userId: typeof obj.userId === "string" ? obj.userId : extractUserIdFromSessionToken(sessionToken) || undefined,
            createdAt: typeof obj.createdAt === "string" ? obj.createdAt : new Date().toISOString(),
            expiresAt: typeof obj.expiresAt === "string" ? obj.expiresAt : undefined,
            label: typeof obj.label === "string" ? obj.label : undefined,
          },
        },
      };

      ensureConfigDir();
      atomicWriteFile(CURSOR_CREDENTIALS_FILE, JSON.stringify(migrated, null, 2), 0o600);
      return migrated;
    }

    return null;
  } catch {
    return null;
  }
}

function saveCursorCredentialsStoreInternal(store: CursorCredentialsStoreV1): void {
  ensureConfigDir();
  atomicWriteFile(CURSOR_CREDENTIALS_FILE, JSON.stringify(store, null, 2), 0o600);
}

function resolveAccountId(store: CursorCredentialsStoreV1, nameOrId: string): string | null {
  const needle = nameOrId.trim();
  if (!needle) return null;
  if (store.accounts[needle]) return needle;

  const needleLower = needle.toLowerCase();
  for (const [id, acct] of Object.entries(store.accounts)) {
    if (acct.label && acct.label.toLowerCase() === needleLower) return id;
  }
  return null;
}

export function listCursorAccounts(): Array<{ id: string; label?: string; userId?: string; createdAt: string; isActive: boolean }> {
  const store = loadCursorCredentialsStoreInternal();
  if (!store) return [];

  const accounts = Object.entries(store.accounts).map(([id, acct]) => ({
    id,
    label: acct.label,
    userId: acct.userId,
    createdAt: acct.createdAt,
    isActive: id === store.activeAccountId,
  }));

  accounts.sort((a, b) => {
    if (a.isActive !== b.isActive) return a.isActive ? -1 : 1;
    const la = (a.label || a.id).toLowerCase();
    const lb = (b.label || b.id).toLowerCase();
    return la.localeCompare(lb);
  });

  return accounts;
}

export function setActiveCursorAccount(nameOrId: string): { ok: boolean; error?: string } {
  const store = loadCursorCredentialsStoreInternal();
  if (!store) return { ok: false, error: "Not authenticated" };
  const resolved = resolveAccountId(store, nameOrId);
  if (!resolved) return { ok: false, error: `Account not found: ${nameOrId}` };
  const prev = store.activeAccountId;
  store.activeAccountId = resolved;
  saveCursorCredentialsStoreInternal(store);

  // Best-effort cache reconcile (avoid double-counting)
  try {
    migrateCursorCacheFromOldPath();
    ensureCacheDir();

    const archiveDir = path.join(CURSOR_CACHE_DIR, "archive");
    const ensureArchiveDir = (): void => {
      ensureCacheDir();
      if (!fs.existsSync(archiveDir)) {
        fs.mkdirSync(archiveDir, { recursive: true, mode: 0o700 });
      }
    };
    const archiveFile = (filePath: string, label: string): void => {
      ensureArchiveDir();
      const safeLabel = sanitizeAccountIdForFilename(label);
      const ts = new Date().toISOString().replace(/[:.]/g, "-");
      const dest = path.join(archiveDir, `${safeLabel}-${ts}.csv`);
      fs.renameSync(filePath, dest);
    };

    // Move current active cache to previous account file (preserve any existing file by archiving).
    if (prev && fs.existsSync(CURSOR_CACHE_FILE)) {
      const prevFile = getCursorCacheFilePathForAccount(prev, false);
      if (fs.existsSync(prevFile)) {
        try {
          archiveFile(prevFile, `usage.${prev}.previous`);
        } catch {
          // ignore
        }
      }
      try {
        fs.renameSync(CURSOR_CACHE_FILE, prevFile);
      } catch {
        // ignore
      }
    }

    // Promote next account cache file into usage.csv.
    const nextFile = getCursorCacheFilePathForAccount(resolved, false);
    if (fs.existsSync(nextFile)) {
      if (fs.existsSync(CURSOR_CACHE_FILE)) {
        try {
          archiveFile(CURSOR_CACHE_FILE, `usage.active.pre-switch`);
        } catch {
          // ignore
        }
      }
      try {
        fs.renameSync(nextFile, CURSOR_CACHE_FILE);
      } catch {
        // ignore
      }
    }

    // If a per-account cache exists, it was promoted into usage.csv above.
  } catch {
    // ignore cache reconcile errors
  }

  return { ok: true };
}

export function saveCursorCredentials(credentials: CursorCredentials, options?: { label?: string; setActive?: boolean }): { accountId: string } {
  const sessionToken = credentials.sessionToken;
  const accountId = deriveAccountId(sessionToken);
  const store = loadCursorCredentialsStoreInternal() || {
    version: 1 as const,
    activeAccountId: accountId,
    accounts: {},
  };

  if (options?.label) {
    const needle = options.label.trim().toLowerCase();
    if (needle) {
      for (const [id, acct] of Object.entries(store.accounts)) {
        if (id === accountId) continue;
        if (acct.label && acct.label.trim().toLowerCase() === needle) {
          throw new Error(`Cursor account label already exists: ${options.label}`);
        }
      }
    }
  }

  const next: CursorCredentials = {
    ...credentials,
    userId: credentials.userId || extractUserIdFromSessionToken(sessionToken) || undefined,
    label: options?.label ?? credentials.label,
  };

  store.accounts[accountId] = next;
  if (options?.setActive !== false) {
    store.activeAccountId = accountId;
  }
  saveCursorCredentialsStoreInternal(store);
  return { accountId };
}

export function loadCursorCredentials(nameOrId?: string): CursorCredentials | null {
  const store = loadCursorCredentialsStoreInternal();
  if (!store) return null;

  if (nameOrId) {
    const resolved = resolveAccountId(store, nameOrId);
    return resolved ? store.accounts[resolved] : null;
  }

  return store.accounts[store.activeAccountId] || null;
}

export function loadCursorCredentialsStore(): CursorCredentialsStoreV1 | null {
  return loadCursorCredentialsStoreInternal();
}

// NOTE: implementation moved below to support cache archiving by default.

export function removeCursorAccount(
  nameOrId: string,
  options?: { purgeCache?: boolean }
): { removed: boolean; error?: string } {
  const store = loadCursorCredentialsStoreInternal();
  if (!store) return { removed: false, error: "Not authenticated" };

  const resolved = resolveAccountId(store, nameOrId);
  if (!resolved) return { removed: false, error: `Account not found: ${nameOrId}` };

  const wasActive = resolved === store.activeAccountId;

  // Cache behavior:
  // - Default: keep history but remove from aggregation by archiving out of cursor-cache/.
  // - purgeCache: delete cache files.
  const CURSOR_CACHE_ARCHIVE_DIR = path.join(CURSOR_CACHE_DIR, "archive");
  const ensureCacheArchiveDir = (): void => {
    ensureCacheDir();
    if (!fs.existsSync(CURSOR_CACHE_ARCHIVE_DIR)) {
      fs.mkdirSync(CURSOR_CACHE_ARCHIVE_DIR, { recursive: true, mode: 0o700 });
    }
  };
  const archiveFile = (filePath: string, label: string): void => {
    ensureCacheArchiveDir();
    const safeLabel = sanitizeAccountIdForFilename(label);
    const ts = new Date().toISOString().replace(/[:.]/g, "-");
    const dest = path.join(CURSOR_CACHE_ARCHIVE_DIR, `${safeLabel}-${ts}.csv`);
    fs.renameSync(filePath, dest);
  };

  try {
    migrateCursorCacheFromOldPath();
    if (fs.existsSync(CURSOR_CACHE_DIR)) {
      const perAccount = getCursorCacheFilePathForAccount(resolved, false);
      if (fs.existsSync(perAccount)) {
        if (options?.purgeCache) {
          fs.rmSync(perAccount);
        } else {
          archiveFile(perAccount, `usage.${resolved}`);
        }
      }
      if (wasActive && fs.existsSync(CURSOR_CACHE_FILE)) {
        if (options?.purgeCache) {
          fs.rmSync(CURSOR_CACHE_FILE);
        } else {
          archiveFile(CURSOR_CACHE_FILE, `usage.active.${resolved}`);
        }
      }
    }
  } catch {
    // ignore
  }

  delete store.accounts[resolved];

  const remaining = Object.keys(store.accounts);
  if (remaining.length === 0) {
    try {
      fs.unlinkSync(CURSOR_CREDENTIALS_FILE);
    } catch {}
    return { removed: true };
  }

  if (wasActive) {
    store.activeAccountId = remaining[0];
  }

  saveCursorCredentialsStoreInternal(store);

  if (wasActive) {
    // Best-effort: reconcile usage.csv for the new active account.
    try {
      migrateCursorCacheFromOldPath();
      ensureCacheDir();
      const nextId = store.activeAccountId;
      const nextFile = getCursorCacheFilePathForAccount(nextId, false);
      if (fs.existsSync(nextFile)) {
        if (fs.existsSync(CURSOR_CACHE_FILE)) {
          try {
            fs.rmSync(CURSOR_CACHE_FILE);
          } catch {}
        }
        fs.renameSync(nextFile, CURSOR_CACHE_FILE);
      }
      // If nextFile existed, it was promoted into usage.csv above.
    } catch {
      // ignore
    }
  }

  return { removed: true };
}

export function clearCursorCredentials(): boolean {
  // Backward compatible: clears ALL accounts
  try {
    if (fs.existsSync(CURSOR_CREDENTIALS_FILE)) {
      fs.unlinkSync(CURSOR_CREDENTIALS_FILE);
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

export function clearCursorCredentialsAndCache(options?: { purgeCache?: boolean }): boolean {
  const cleared = clearCursorCredentials();
  if (!cleared) return false;

  try {
    migrateCursorCacheFromOldPath();
    if (!fs.existsSync(CURSOR_CACHE_DIR)) return true;

    const archiveDir = path.join(CURSOR_CACHE_DIR, "archive");
    const ensureArchiveDir = (): void => {
      ensureCacheDir();
      if (!fs.existsSync(archiveDir)) {
        fs.mkdirSync(archiveDir, { recursive: true, mode: 0o700 });
      }
    };
    const archiveFile = (filePath: string, label: string): void => {
      ensureArchiveDir();
      const safeLabel = sanitizeAccountIdForFilename(label);
      const ts = new Date().toISOString().replace(/[:.]/g, "-");
      const dest = path.join(archiveDir, `${safeLabel}-${ts}.csv`);
      fs.renameSync(filePath, dest);
    };

    for (const f of fs.readdirSync(CURSOR_CACHE_DIR)) {
      if (!f.startsWith("usage") || !f.endsWith(".csv")) continue;
      const filePath = path.join(CURSOR_CACHE_DIR, f);
      try {
        if (options?.purgeCache) {
          fs.rmSync(filePath);
        } else {
          archiveFile(filePath, `usage.all.${f}`);
        }
      } catch {}
    }
  } catch {
    // ignore
  }

  return true;
}

export function isCursorLoggedIn(): boolean {
  const store = loadCursorCredentialsStoreInternal();
  return !!store && Object.keys(store.accounts).length > 0;
}

// ============================================================================
// API Client
// ============================================================================

const CURSOR_API_BASE = "https://cursor.com";
const USAGE_CSV_ENDPOINT = `${CURSOR_API_BASE}/api/dashboard/export-usage-events-csv?strategy=tokens`;
const USAGE_SUMMARY_ENDPOINT = `${CURSOR_API_BASE}/api/usage-summary`;

/**
 * Build HTTP headers for Cursor API requests
 */
function buildCursorHeaders(sessionToken: string): Record<string, string> {
  return {
    Accept: "*/*",
    "Accept-Language": "en-US,en;q=0.9",
    Cookie: `WorkosCursorSessionToken=${sessionToken}`,
    Referer: "https://www.cursor.com/settings",
    "User-Agent":
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  };
}

/**
 * Validate Cursor session token by hitting the usage-summary endpoint
 */
export async function validateCursorSession(
  sessionToken: string
): Promise<{ valid: boolean; membershipType?: string; error?: string }> {
  try {
    const response = await fetch(USAGE_SUMMARY_ENDPOINT, {
      method: "GET",
      headers: buildCursorHeaders(sessionToken),
    });

    if (response.status === 401 || response.status === 403) {
      return { valid: false, error: "Session token expired or invalid" };
    }

    if (!response.ok) {
      return { valid: false, error: `API returned status ${response.status}` };
    }

    const data = await response.json();

    // Check for required fields that indicate valid auth
    if (data.billingCycleStart && data.billingCycleEnd) {
      return { valid: true, membershipType: data.membershipType };
    }

    return { valid: false, error: "Invalid response format" };
  } catch (error) {
    return { valid: false, error: (error as Error).message };
  }
}

/**
 * Fetch usage CSV from Cursor API
 */
export async function fetchCursorUsageCsv(sessionToken: string): Promise<string> {
  const response = await fetch(USAGE_CSV_ENDPOINT, {
    method: "GET",
    headers: buildCursorHeaders(sessionToken),
  });

  if (response.status === 401 || response.status === 403) {
    throw new Error("Cursor session expired. Please run 'tokscale cursor login' to re-authenticate.");
  }

  if (!response.ok) {
    throw new Error(`Cursor API returned status ${response.status}`);
  }

  const text = await response.text();

  // Validate it's actually CSV (handle both old and new formats)
  // Old: "Date,Model,..."
  // New: "Date,Kind,Model,..."
  if (!text.startsWith("Date,")) {
    throw new Error("Invalid response from Cursor API - expected CSV format");
  }

  return text;
}

// ============================================================================
// CSV Parsing
// ============================================================================

/**
 * Parse cost string (e.g., "$0.50" or "0.50") to number
 */
function parseCost(costStr: string): number {
  if (!costStr) return 0;
  const cleaned = costStr.replace(/[$,]/g, "").trim();
  const value = parseFloat(cleaned);
  return isNaN(value) ? 0 : value;
}

/**
 * Infer provider from model name
 */
function inferProvider(model: string): string {
  const lowerModel = model.toLowerCase();

  if (lowerModel.includes("claude") || lowerModel.includes("sonnet") || lowerModel.includes("opus") || lowerModel.includes("haiku")) {
    return "anthropic";
  }
  if (lowerModel.includes("gpt") || lowerModel.includes("o1") || lowerModel.includes("o3")) {
    return "openai";
  }
  if (lowerModel.includes("gemini")) {
    return "google";
  }
  if (lowerModel.includes("deepseek")) {
    return "deepseek";
  }
  if (lowerModel.includes("llama") || lowerModel.includes("mixtral")) {
    return "meta";
  }

  return "cursor"; // Default provider
}

/**
 * Parse Cursor usage CSV into structured rows
 */
export function parseCursorCsv(csvText: string): CursorUsageRow[] {
  try {
    const records: Array<Record<string, string>> = parseCsv(csvText, {
      columns: true,
      skip_empty_lines: true,
      trim: true,
      relax_column_count: true,
    });

    return records
      .filter((record) => record["Date"] && record["Model"])
      .map((record) => {
        const dateStr = record["Date"] || "";
        const date = new Date(dateStr);
        const isValidDate = !isNaN(date.getTime());
        const dateOnly = isValidDate
          ? date.toISOString().slice(0, 10)
          : dateStr.length >= 10
            ? dateStr.slice(0, 10)
            : dateStr;

        return {
          date: dateOnly,
          timestamp: isValidDate ? date.getTime() : 0,
          model: (record["Model"] || "").trim(),
          inputWithCacheWrite: parseInt(record["Input (w/ Cache Write)"] || "0", 10),
          inputWithoutCacheWrite: parseInt(record["Input (w/o Cache Write)"] || "0", 10),
          cacheRead: parseInt(record["Cache Read"] || "0", 10),
          outputTokens: parseInt(record["Output Tokens"] || "0", 10),
          totalTokens: parseInt(record["Total Tokens"] || "0", 10),
          apiCost: parseCost(record["Cost"] || record["API Cost"] || "0"),
          costToYou: parseCost(record["Cost to you"] || "0"),
        };
      });
  } catch (error) {
    throw new Error(`Failed to parse Cursor CSV: ${(error as Error).message}`);
  }
}

// ============================================================================
// Data Aggregation (for table display)
// ============================================================================

/**
 * Aggregate Cursor usage by model
 */
export function aggregateCursorByModel(rows: CursorUsageRow[]): CursorUsageData[] {
  const modelMap = new Map<string, CursorUsageData>();

  for (const row of rows) {
    const key = row.model;
    const existing = modelMap.get(key);

    // Cache write = inputWithCacheWrite - inputWithoutCacheWrite (tokens written to cache)
    const cacheWrite = Math.max(0, row.inputWithCacheWrite - row.inputWithoutCacheWrite);
    // Input tokens (without cache) = inputWithoutCacheWrite
    const input = row.inputWithoutCacheWrite;

    if (existing) {
      existing.messageCount += 1;
      existing.input += input;
      existing.output += row.outputTokens;
      existing.cacheRead += row.cacheRead;
      existing.cacheWrite += cacheWrite;
      existing.cost += row.costToYou || row.apiCost;
    } else {
      modelMap.set(key, {
        source: "cursor",
        model: row.model,
        providerId: inferProvider(row.model),
        messageCount: 1,
        input,
        output: row.outputTokens,
        cacheRead: row.cacheRead,
        cacheWrite,
        reasoning: 0, // Cursor doesn't expose reasoning tokens
        cost: row.costToYou || row.apiCost,
      });
    }
  }

  return Array.from(modelMap.values()).sort((a, b) => b.cost - a.cost);
}

// ============================================================================
// Data Conversion (for graph/native module)
// ============================================================================

/**
 * Convert Cursor CSV rows to timestamped messages for graph generation
 */
export function cursorRowsToMessages(rows: CursorUsageRow[]): CursorMessageWithTimestamp[] {
  return rows.map((row) => {
    const cacheWrite = Math.max(0, row.inputWithCacheWrite - row.inputWithoutCacheWrite);
    const input = row.inputWithoutCacheWrite;

    return {
      source: "cursor" as const,
      model: row.model,
      providerId: inferProvider(row.model),
      timestamp: row.timestamp,
      input,
      output: row.outputTokens,
      cacheRead: row.cacheRead,
      cacheWrite,
      reasoning: 0,
      cost: row.costToYou || row.apiCost,
    };
  });
}

// ============================================================================
// High-Level API
// ============================================================================

/**
 * Fetch and parse Cursor usage data
 * Requires valid credentials to be stored
 */
export async function readCursorUsage(nameOrId?: string): Promise<{
  rows: CursorUsageRow[];
  byModel: CursorUsageData[];
  messages: CursorMessageWithTimestamp[];
}> {
  const credentials = loadCursorCredentials(nameOrId);
  if (!credentials) {
    throw new Error("Cursor not authenticated. Run 'tokscale cursor login' first.");
  }

  const csvText = await fetchCursorUsageCsv(credentials.sessionToken);
  const rows = parseCursorCsv(csvText);
  const byModel = aggregateCursorByModel(rows);
  const messages = cursorRowsToMessages(rows);

  return { rows, byModel, messages };
}

/**
 * Get Cursor credentials file path (for debugging)
 */
export function getCursorCredentialsPath(): string {
  return CURSOR_CREDENTIALS_FILE;
}

// ============================================================================
// Cache Management (for Rust integration)
// ============================================================================

const OLD_CURSOR_CACHE_DIR = path.join(os.homedir(), ".tokscale", "cursor-cache");
const CURSOR_CACHE_DIR = path.join(CONFIG_DIR, "cursor-cache");
const CURSOR_CACHE_FILE = path.join(CURSOR_CACHE_DIR, "usage.csv");

function getCursorCacheFilePathForAccount(accountId: string, isActive: boolean): string {
  if (isActive) return CURSOR_CACHE_FILE;
  const safe = sanitizeAccountIdForFilename(accountId);
  return path.join(CURSOR_CACHE_DIR, `usage.${safe}.csv`);
}

function ensureCacheDir(): void {
  if (!fs.existsSync(CURSOR_CACHE_DIR)) {
    fs.mkdirSync(CURSOR_CACHE_DIR, { recursive: true, mode: 0o700 });
  }
}

/**
 * Migrate cursor cache from old path to new XDG path
 */
function migrateCursorCacheFromOldPath(): void {
  try {
    if (!fs.existsSync(CURSOR_CACHE_DIR) && fs.existsSync(OLD_CURSOR_CACHE_DIR)) {
      ensureCacheDir();
      fs.cpSync(OLD_CURSOR_CACHE_DIR, CURSOR_CACHE_DIR, { recursive: true });
      fs.rmSync(OLD_CURSOR_CACHE_DIR, { recursive: true });
    }

    // Try to remove old config directory if empty
    try {
      fs.rmdirSync(OLD_CONFIG_DIR);
    } catch {
      // Directory not empty - ignore
    }
  } catch {
    // Migration failed - continue with normal operation
  }
}

/**
 * Sync Cursor usage data from API to local cache
 * This downloads the CSV and saves it for the Rust module to parse
 */
export async function syncCursorCache(): Promise<{ synced: boolean; rows: number; error?: string }> {
  migrateCursorCacheFromOldPath();
  const store = loadCursorCredentialsStoreInternal();
  if (!store) return { synced: false, rows: 0, error: "Not authenticated" };
  const accounts = Object.entries(store.accounts);
  if (accounts.length === 0) return { synced: false, rows: 0, error: "Not authenticated" };

  try {
    ensureCacheDir();

    // Ensure we don't double-count active account (usage.csv + usage.<active>.csv)
    const activeId = store.activeAccountId;
    if (activeId) {
      const dup = getCursorCacheFilePathForAccount(activeId, false);
      if (fs.existsSync(dup)) {
        try { fs.rmSync(dup); } catch {}
      }
    }

    let totalRows = 0;
    let successCount = 0;
    const errors: string[] = [];

    for (const [accountId, credentials] of accounts) {
      const isActive = accountId === store.activeAccountId;
      try {
        const csvText = await fetchCursorUsageCsv(credentials.sessionToken);
        const filePath = getCursorCacheFilePathForAccount(accountId, isActive);
        atomicWriteFile(filePath, csvText, 0o600);
        totalRows += parseCursorCsv(csvText).length;
        successCount += 1;
      } catch (e) {
        errors.push(`${accountId}: ${(e as Error).message}`);
      }
    }

    if (successCount === 0) {
      return { synced: false, rows: 0, error: errors[0] || "Cursor sync failed" };
    }

    return {
      synced: true,
      rows: totalRows,
      error: errors.length > 0 ? `Some accounts failed to sync (${errors.length}/${accounts.length})` : undefined,
    };
  } catch (error) {
    return { synced: false, rows: 0, error: (error as Error).message };
  }
}

/**
 * Get the cache file path
 */
export function getCursorCachePath(): string {
  // Ensure legacy cache is migrated before reporting paths
  migrateCursorCacheFromOldPath();
  return CURSOR_CACHE_FILE;
}

/**
 * Check if cache exists and when it was last updated
 */
export function getCursorCacheStatus(): { exists: boolean; lastModified?: Date; path: string } {
  migrateCursorCacheFromOldPath();
  const exists = fs.existsSync(CURSOR_CACHE_FILE);
  let lastModified: Date | undefined;

  if (exists) {
    try {
      const stats = fs.statSync(CURSOR_CACHE_FILE);
      lastModified = stats.mtime;
    } catch {
      // Ignore stat errors
    }
  }

  return { exists, lastModified, path: CURSOR_CACHE_FILE };
}

export function hasCursorUsageCache(): boolean {
  migrateCursorCacheFromOldPath();
  try {
    if (!fs.existsSync(CURSOR_CACHE_DIR)) return false;
    const files = fs.readdirSync(CURSOR_CACHE_DIR);
    return files.some((f) => isCursorUsageCsvFilename(f));
  } catch {
    return false;
  }
}

export interface CursorUnifiedMessage {
  source: "cursor";
  modelId: string;
  providerId: string;
  sessionId: string;
  timestamp: number;
  date: string;
  tokens: {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
    reasoning: number;
  };
  cost: number;
}

export function readCursorMessagesFromCache(): CursorUnifiedMessage[] {
  migrateCursorCacheFromOldPath();
  if (!fs.existsSync(CURSOR_CACHE_DIR)) {
    return [];
  }

  let files: string[];
  try {
    files = fs
      .readdirSync(CURSOR_CACHE_DIR)
      .filter((f) => isCursorUsageCsvFilename(f));
  } catch {
    return [];
  }

  const store = loadCursorCredentialsStoreInternal();
  const activeId = store?.activeAccountId;

  const all: CursorUnifiedMessage[] = [];
  for (const file of files) {
    const filePath = path.join(CURSOR_CACHE_DIR, file);
    let accountId = "unknown";
    if (file === "usage.csv") {
      accountId = activeId || "active";
    } else if (file.startsWith("usage.") && file.endsWith(".csv")) {
      accountId = file.slice("usage.".length, -".csv".length);
    }

    try {
      const csvText = fs.readFileSync(filePath, "utf-8");
      const rows = parseCursorCsv(csvText);

      for (const row of rows) {
        const cacheWrite = Math.max(0, row.inputWithCacheWrite - row.inputWithoutCacheWrite);
        const input = row.inputWithoutCacheWrite;
        all.push({
          source: "cursor" as const,
          modelId: row.model,
          providerId: inferProvider(row.model),
          sessionId: `cursor-${accountId}-${row.date}-${row.model}`,
          timestamp: row.timestamp,
          date: row.date,
          tokens: {
            input,
            output: row.outputTokens,
            cacheRead: row.cacheRead,
            cacheWrite,
            reasoning: 0,
          },
          cost: row.costToYou || row.apiCost,
        });
      }
    } catch {
      // ignore file
    }
  }

  return all;
}
