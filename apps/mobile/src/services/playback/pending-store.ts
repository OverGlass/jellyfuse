// MMKV-backed pending playback report queue. Reports that fail to
// send (offline, server error) are queued here and drained when
// connectivity returns. Mirrors the Rust `PendingReport` sled tree
// in `crates/jf-core/src/persistence.rs`.

import type { PendingReport } from "@jellyfuse/models";
import { storage } from "@/services/query/storage";

const KEY_PREFIX = "playback-pending:v1:";
const MAX_ENTRIES = 500;
let seqCounter = 0;

/**
 * Enqueue a report for later delivery. Bounded to `MAX_ENTRIES` —
 * oldest entries are dropped when full.
 */
export function enqueueReport(report: PendingReport): void {
  // Zero-pad timestamp (20 digits like Rust) + monotonic seq for uniqueness
  const ts = String(report.occurredAtMs).padStart(20, "0");
  const seq = String(seqCounter++).padStart(6, "0");
  const key = `${KEY_PREFIX}${ts}:${seq}:${report.itemId}:${report.kind.type}`;
  storage.set(key, JSON.stringify(report));

  // Evict oldest if over cap
  const keys = getPendingKeys();
  if (keys.length > MAX_ENTRIES) {
    const toRemove = keys.slice(0, keys.length - MAX_ENTRIES);
    for (const k of toRemove) {
      storage.remove(k);
    }
  }
}

/**
 * Read and remove all pending reports in FIFO order (sorted by
 * timestamp key). Returns an empty array if none queued.
 */
export function drainReports(): PendingReport[] {
  const keys = getPendingKeys();
  const reports: PendingReport[] = [];

  for (const key of keys) {
    const raw = storage.getString(key);
    storage.remove(key);
    if (!raw) continue;
    try {
      reports.push(JSON.parse(raw) as PendingReport);
    } catch {
      // Corrupted entry — skip but still remove
    }
  }

  return reports;
}

/** Number of pending reports without reading them. */
export function peekCount(): number {
  return getPendingKeys().length;
}

/** Remove all pending reports. */
export function clearPendingReports(): void {
  const keys = getPendingKeys();
  for (const key of keys) {
    storage.remove(key);
  }
}

function getPendingKeys(): string[] {
  return storage
    .getAllKeys()
    .filter((k) => k.startsWith(KEY_PREFIX))
    .sort(); // Lexicographic sort = FIFO by timestamp prefix
}
