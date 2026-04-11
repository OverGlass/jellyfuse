/**
 * Schema version for the MMKV-backed React Query persister. Bump on
 * any backwards-incompatible change to a persisted query shape — e.g.
 * renaming fields in `@jellyfuse/models`, restructuring a query key,
 * or changing how dehydrated state is laid out.
 *
 * `PersistQueryClientProvider` consumes this via its `buster` prop —
 * when it changes, every persisted entry is discarded on next boot
 * instead of hydrating into the new schema. Cheaper than writing
 * migration shims for types that are still churning.
 */
export const PERSISTED_SCHEMA_VERSION = "1" as const;

/** Upper bound on how old a persisted cache entry is allowed to be. */
export const PERSIST_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
