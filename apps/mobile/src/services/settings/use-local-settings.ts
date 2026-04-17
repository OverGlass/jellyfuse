import { useSyncExternalStore } from "react";
import { useAuth } from "@/services/auth/state";
import { storage } from "@/services/query/storage";
import {
  DEFAULT_LOCAL_SETTINGS,
  localSettingsMmkvKey,
  readLocalSettings,
  writeLocalSettings,
  type LocalSettings,
} from "./local";

/**
 * Subscribe to the MMKV-backed local settings for the active user.
 *
 * MMKV reads are synchronous, so this uses `useSyncExternalStore` —
 * the canonical React pattern for syncing to an external store —
 * rather than a React Query `useQuery` that would spuriously mark
 * the first render as pending.
 *
 * The subscribe callback uses MMKV's `addOnValueChangedListener` and
 * filters by the per-user key so one user's settings updates don't
 * churn another user's subscribers.
 */
export function useLocalSettings(): LocalSettings {
  const { activeUser } = useAuth();
  const userId = activeUser?.userId;

  const subscribe = (onStoreChange: () => void) => {
    if (!userId) return () => {};
    const key = localSettingsMmkvKey(userId);
    const listener = storage.addOnValueChangedListener((changedKey) => {
      if (changedKey === key) onStoreChange();
    });
    return () => listener.remove();
  };
  const getSnapshot = () => (userId ? readLocalSettings(userId) : DEFAULT_LOCAL_SETTINGS);
  return useSyncExternalStore(subscribe, getSnapshot);
}

/**
 * Returns an imperative setter — writes to MMKV which triggers
 * `useLocalSettings` subscribers to re-render via the value-changed
 * listener.
 */
export function useUpdateLocalSettings(): (patch: Partial<LocalSettings>) => void {
  const { activeUser } = useAuth();
  const userId = activeUser?.userId;
  return (patch) => {
    if (!userId) return;
    const current = readLocalSettings(userId);
    writeLocalSettings(userId, { ...current, ...patch });
  };
}
