// Playback reporter — sends start/progress/stopped events to
// Jellyfin via POST /Sessions/Playing|Progress|Stopped. On failure
// (network or server error), enqueues the report for later drain.
//
// Stop reports run an additional optimistic local cache patch
// (`applyStopReportLocally`) so home shelves / detail / nextUp
// reflect the new resume position immediately, including offline.
// On a successful HTTP ack the canonical TanStack optimistic-updates
// pattern is completed by invalidating `["home"]` + the played
// item's detail entry so any drift from custom server thresholds
// silently reconciles to server truth.
//
// Ports the reporting logic from `crates/jf-api/src/jellyfin.rs`
// (lines ~905-960) and the pending-report pattern from
// `crates/jf-core/src/persistence.rs`.

import type { PendingReport, PendingReportKind, PlayMethod } from "@jellyfuse/models";
import { queryKeys } from "@jellyfuse/query-keys";
import { apiFetchAuthenticated } from "@/services/api/client";
import { queryClient } from "@/services/query";
import { applyStopReportLocally } from "./cache-update";
import { enqueueReport } from "./pending-store";

// ──────────────────────────────────────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────────────────────────────────────

interface ReportBase {
  baseUrl: string;
  itemId: string;
  mediaSourceId: string;
  playSessionId: string;
}

export interface ReportStartArgs extends ReportBase {
  positionTicks: number;
  playMethod: PlayMethod;
}

export interface ReportProgressArgs extends ReportBase {
  positionTicks: number;
  isPaused: boolean;
  playMethod: PlayMethod;
}

export interface ReportStoppedArgs extends ReportBase {
  positionTicks: number;
  /**
   * Item runtime in Jellyfin ticks. Used by the optimistic cache
   * update to compute whether the stop crosses Jellyfin's played
   * threshold. `0` when unknown — degrades gracefully (position is
   * patched, played flag is left untouched).
   */
  runtimeTicks: number;
  /** Active Jellyfin user — needed to scope the cache-update walk. */
  userId: string;
}

// ──────────────────────────────────────────────────────────────────────────────
// Public API
// ──────────────────────────────────────────────────────────────────────────────

export async function reportStart(args: ReportStartArgs): Promise<void> {
  const body = {
    ItemId: args.itemId,
    PlaySessionId: args.playSessionId,
    MediaSourceId: args.mediaSourceId,
    PositionTicks: args.positionTicks,
    PlayMethod: args.playMethod,
    CanSeek: true,
    IsPaused: false,
  };

  await sendReport(args.baseUrl, "/Sessions/Playing", body, {
    itemId: args.itemId,
    playSessionId: args.playSessionId,
    mediaSourceId: args.mediaSourceId,
    kind: { type: "start", positionTicks: args.positionTicks, playMethod: args.playMethod },
    occurredAtMs: Date.now(),
  });
}

export async function reportProgress(args: ReportProgressArgs): Promise<void> {
  const body = {
    ItemId: args.itemId,
    PlaySessionId: args.playSessionId,
    MediaSourceId: args.mediaSourceId,
    PositionTicks: args.positionTicks,
    IsPaused: args.isPaused,
    PlayMethod: args.playMethod,
    CanSeek: true,
    EventName: "timeupdate",
  };

  await sendReport(args.baseUrl, "/Sessions/Playing/Progress", body, {
    itemId: args.itemId,
    playSessionId: args.playSessionId,
    mediaSourceId: args.mediaSourceId,
    kind: {
      type: "progress",
      positionTicks: args.positionTicks,
      isPaused: args.isPaused,
      playMethod: args.playMethod,
    },
    occurredAtMs: Date.now(),
  });
}

export async function reportStopped(args: ReportStoppedArgs): Promise<void> {
  // Optimistic local patch first — TanStack canonical pattern. Runs
  // unconditionally so offline playback still sees the new resume
  // position; idempotent across drainer retries.
  applyStopReportLocally(queryClient, {
    jellyfinId: args.itemId,
    positionTicks: args.positionTicks,
    runtimeTicks: args.runtimeTicks,
    userId: args.userId,
    nowIso: new Date().toISOString(),
  });

  const body = {
    ItemId: args.itemId,
    PlaySessionId: args.playSessionId,
    MediaSourceId: args.mediaSourceId,
    PositionTicks: args.positionTicks,
  };

  const ok = await sendReport(args.baseUrl, "/Sessions/Playing/Stopped", body, {
    itemId: args.itemId,
    playSessionId: args.playSessionId,
    mediaSourceId: args.mediaSourceId,
    runtimeTicks: args.runtimeTicks,
    userId: args.userId,
    kind: { type: "stopped", positionTicks: args.positionTicks },
    occurredAtMs: Date.now(),
  });

  if (ok) {
    invalidatePlaybackQueries(args.userId, args.itemId);
  }
}

/**
 * Re-send a pending report. Used by the drainer to replay queued
 * reports after reconnection. Stopped reports re-run the optimistic
 * cache patch (idempotent) and trigger the success invalidation when
 * the server acks — the original immediate-path invalidation never
 * fired because the request was offline-queued.
 */
export async function replayReport(baseUrl: string, report: PendingReport): Promise<void> {
  if (report.kind.type === "stopped" && report.userId !== undefined) {
    applyStopReportLocally(queryClient, {
      jellyfinId: report.itemId,
      positionTicks: report.kind.positionTicks,
      runtimeTicks: report.runtimeTicks ?? 0,
      userId: report.userId,
      nowIso: new Date(report.occurredAtMs).toISOString(),
    });
  }

  const path = `/Sessions/Playing${endpointSuffix(report.kind)}`;
  const body = buildBody(report);
  const ok = await sendReport(baseUrl, path, body, report);

  if (ok && report.kind.type === "stopped" && report.userId !== undefined) {
    invalidatePlaybackQueries(report.userId, report.itemId);
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// Internal
// ──────────────────────────────────────────────────────────────────────────────

/**
 * @returns `true` when the server acknowledged the request (`res.ok`),
 * `false` when the report was enqueued for later retry (offline,
 * network error, or server 5xx). Callers gate the post-success
 * invalidation on this — invalidating after an enqueue would just
 * burn a wasted refetch returning stale data.
 */
async function sendReport(
  baseUrl: string,
  path: string,
  body: Record<string, unknown>,
  pendingFallback: PendingReport,
): Promise<boolean> {
  // Short-circuit when the connection monitor has already observed
  // the server as unreachable — skip the fetch timeout and queue
  // straight away. State is undefined before the first ping, in
  // which case we optimistically try the network.
  if (isKnownOffline(baseUrl)) {
    enqueueReport(pendingFallback);
    return false;
  }

  try {
    const wideFetcher = apiFetchAuthenticated as (
      input: string,
      init: { method: string; headers: Record<string, string>; body: string },
    ) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>;

    const res = await wideFetcher(`${trimSlash(baseUrl)}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      enqueueReport(pendingFallback);
      return false;
    }
    return true;
  } catch {
    enqueueReport(pendingFallback);
    return false;
  }
}

function invalidatePlaybackQueries(userId: string, jellyfinId: string): void {
  queryClient.invalidateQueries({ queryKey: ["home"], exact: false });
  queryClient.invalidateQueries({ queryKey: queryKeys.movieDetail(userId, jellyfinId) });
  queryClient.invalidateQueries({ queryKey: queryKeys.seriesDetail(userId, jellyfinId) });
}

function isKnownOffline(baseUrl: string): boolean {
  const state = queryClient.getQueryState(queryKeys.systemInfo(baseUrl));
  return state?.status === "error";
}

function endpointSuffix(kind: PendingReportKind): string {
  switch (kind.type) {
    case "start":
      return "";
    case "progress":
      return "/Progress";
    case "stopped":
      return "/Stopped";
  }
}

function buildBody(report: PendingReport): Record<string, unknown> {
  const base = {
    ItemId: report.itemId,
    PlaySessionId: report.playSessionId,
    MediaSourceId: report.mediaSourceId,
  };

  switch (report.kind.type) {
    case "start":
      return {
        ...base,
        PositionTicks: report.kind.positionTicks,
        PlayMethod: report.kind.playMethod,
        CanSeek: true,
        IsPaused: false,
      };
    case "progress":
      return {
        ...base,
        PositionTicks: report.kind.positionTicks,
        IsPaused: report.kind.isPaused,
        PlayMethod: report.kind.playMethod,
        CanSeek: true,
        EventName: "timeupdate",
      };
    case "stopped":
      return {
        ...base,
        PositionTicks: report.kind.positionTicks,
      };
  }
}

function trimSlash(url: string): string {
  return url.endsWith("/") ? url.slice(0, -1) : url;
}
