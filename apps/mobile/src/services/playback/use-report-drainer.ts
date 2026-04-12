// Drains the pending playback report queue when connectivity returns.
// Mounted once in the root layout so it runs for the entire session.

import { useEffect, useRef } from "react";
import { useConnectionStatus } from "@/services/connection/monitor";
import { useAuth } from "@/services/auth/state";
import { drainReports, enqueueReport } from "./pending-store";
import { replayReport } from "./reporter";

/**
 * Subscribe to connection status. When it flips from non-online to
 * `"online"`, drain the pending report queue one report at a time.
 * On failure, re-enqueue at the tail and abort the drain so we don't
 * hammer a recovering server.
 */
export function useReportDrainer(): void {
  const connectionStatus = useConnectionStatus();
  const { serverUrl } = useAuth();
  const prevStatusRef = useRef(connectionStatus);

  useEffect(() => {
    const wasOffline = prevStatusRef.current !== "online";
    prevStatusRef.current = connectionStatus;

    if (!wasOffline || connectionStatus !== "online") return;
    if (!serverUrl) return;

    const baseUrl = serverUrl;

    // Fire-and-forget drain — async IIFE
    (async () => {
      const reports = drainReports();
      for (const report of reports) {
        try {
          await replayReport(baseUrl, report);
        } catch {
          // Re-enqueue failed report and stop — don't hammer the server
          enqueueReport(report);
          break;
        }
      }
    })();
  }, [connectionStatus, serverUrl]);
}
