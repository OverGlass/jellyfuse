import { createMMKV, type MMKV } from "react-native-mmkv";

/**
 * MMKV instance backing the React Query persister and any other small KV
 * the app needs (per Phase 0 data layer plan). Single shared instance — do
 * not create ad-hoc MMKVs; reach for this one so we have one file on disk.
 *
 * `id` gives this instance its own file name under the app's documents
 * directory. Bump `buster` in the query persister if we ever change the
 * persisted shape in a backwards-incompatible way.
 */
export const storage: MMKV = createMMKV({
  id: "jellyfuse-v1",
});

/**
 * Minimal AsyncStorage-shaped adapter over MMKV. `@tanstack/query-async-
 * storage-persister` consumes this shape without needing `@react-native-
 * async-storage/async-storage`.
 */
export const mmkvAsyncStorage = {
  getItem: (key: string): Promise<string | null> => {
    const value = storage.getString(key);
    return Promise.resolve(value ?? null);
  },
  setItem: (key: string, value: string): Promise<void> => {
    storage.set(key, value);
    return Promise.resolve();
  },
  removeItem: (key: string): Promise<void> => {
    storage.remove(key);
    return Promise.resolve();
  },
};
