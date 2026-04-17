// Playback reporter — sends start/progress/stopped events to
// Jellyfin via POST /Sessions/Playing|Progress|Stopped. On failure
// (network or server error), enqueues the report for later drain.
// Ports the reporting logic from `crates/jf-api/src/jellyfin.rs`
// (lines ~905-960) and the pending-report pattern from
// `crates/jf-core/src/persistence.rs`.

import type { PendingReport, PendingReportKind, PlayMethod } from "@jellyfuse/models";
import { queryKeys } from "@jellyfuse/query-keys";
import { apiFetchAuthenticated } from "@/services/api/client";
import { queryClient } from "@/services/query";
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
  const body = {
    ItemId: args.itemId,
    PlaySessionId: args.playSessionId,
    MediaSourceId: args.mediaSourceId,
    PositionTicks: args.positionTicks,
  };

  await sendReport(args.baseUrl, "/Sessions/Playing/Stopped", body, {
    itemId: args.itemId,
    playSessionId: args.playSessionId,
    mediaSourceId: args.mediaSourceId,
    kind: { type: "stopped", positionTicks: args.positionTicks },
    occurredAtMs: Date.now(),
  });
}

/**
 * Re-send a pending report. Used by the drainer to replay queued
 * reports after reconnection.
 */
export async function replayReport(baseUrl: string, report: PendingReport): Promise<void> {
  const path = `/Sessions/Playing${endpointSuffix(report.kind)}`;
  const body = buildBody(report);
  await sendReport(baseUrl, path, body, report);
}

// ──────────────────────────────────────────────────────────────────────────────
// Internal
// ──────────────────────────────────────────────────────────────────────────────

async function sendReport(
  baseUrl: string,
  path: string,
  body: Record<string, unknown>,
  pendingFallback: PendingReport,
): Promise<void> {
  // Short-circuit when the connection monitor has already observed
  // the server as unreachable — skip the fetch timeout and queue
  // straight away. State is undefined before the first ping, in
  // which case we optimistically try the network.
  if (isKnownOffline(baseUrl)) {
    enqueueReport(pendingFallback);
    return;
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
    }
  } catch {
    // Network error — enqueue for later
    enqueueReport(pendingFallback);
  }
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
