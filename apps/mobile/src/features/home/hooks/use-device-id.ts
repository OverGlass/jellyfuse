import { useEffect, useState } from "react";
import { getDeviceId } from "@/services/device-id";

/**
 * Resolves the stable device id once on mount. Phase 1a displays this in
 * the home header so we can visually confirm the native secure-storage +
 * expo-application plumbing works on-device. Phase 1b wires it into the
 * real `AuthContext` that every @jellyfuse/api call reads from.
 */
export function useDeviceId(): string | undefined {
  const [deviceId, setDeviceId] = useState<string>();
  useEffect(() => {
    let mounted = true;
    getDeviceId()
      .then((id) => {
        if (mounted) setDeviceId(id);
      })
      .catch((err: unknown) => {
        console.warn("device-id lookup failed", err);
      });
    return () => {
      mounted = false;
    };
  }, []);
  return deviceId;
}
