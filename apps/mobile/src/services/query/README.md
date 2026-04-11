# services/query

React Query wiring: shared `queryClient`, MMKV-backed persister, and
all data-layer hooks. Every async/server read flows through here — no
component reaches for `fetch` directly. This is the TS port of the
Rust `QueryCache` module in `crates/jf-core/src/query.rs`, and the
same rules apply.

## Layout

```
services/query/
├── client.ts              QueryClient w/ stale-while-revalidate defaults
├── storage.ts             MMKV instance + AsyncStorage-shaped adapter
├── persister.ts           @tanstack/query-async-storage-persister wrap
├── schema.ts              PERSISTED_SCHEMA_VERSION + max-age constants
├── should-dehydrate.ts    Predicate deciding which keys get persisted
├── provider.tsx           PersistQueryClientProvider (hydrate-as-stale)
└── hooks/
    ├── use-system-info.ts
    └── use-home-shelves.ts
```

## Persistence layers — what lives where

Not every piece of state belongs in React Query's persister. Use this
table when adding new data:

| Data                       | Layer                        | Why                                               |
| -------------------------- | ---------------------------- | ------------------------------------------------- |
| Home shelves, detail pages | **RQ persister (MMKV)**      | offline-first boot, read-heavy, server-driven     |
| `system-info`              | RQ persister                 | static per session                                |
| `quality-profiles`         | RQ persister                 | 30-min stale, rarely changes                      |
| Shelf "see all" pages      | RQ persister                 | feeds the Phase 2e infinite grid                  |
| Auth users + server URL    | **secure-storage** (Phase 1) | encrypted at rest, handled by `AuthProvider`      |
| Jellyseerr `connect.sid`   | secure-storage               | per-user cookie on `AuthenticatedUser`            |
| `PlaybackInfo`             | **not persisted**            | volatile, resolved at play time (Phase 3)         |
| Pending playback reports   | **dedicated MMKV entry**     | drained on reconnect (Phase 3)                    |
| Local downloads            | **downloader Nitro module**  | on-disk manifest is the source of truth (Phase 5) |
| Radarr/Sonarr progress     | not persisted                | 10-s stale, no value in caching                   |
| Search results             | not persisted                | ephemeral by design                               |

The canonical predicate is `shouldDehydrateQuery` — update it whenever
a new query family appears (and bump `PERSISTED_SCHEMA_VERSION` if the
dehydrated shape changes).

## Hydrate-as-stale

On cold launch `PersistQueryClientProvider.onSuccess` rewrites every
rehydrated query with `dataUpdatedAt: 0` + `isInvalidated: true`. The
UI renders instantly from the cached shape, RQ kicks off a silent
background revalidation, and the rendered data updates in place when
the server responds. No loading flash, no empty state — matches the
Rust `QueryCache::hydrate()` behaviour in `jf-core/src/query.rs`.

## Schema versioning

`PERSISTED_SCHEMA_VERSION` in `schema.ts` is the MMKV key suffix
**and** the RQ persister `buster`. Bump it when any persisted query's
shape changes — e.g. a `MediaItem` field rename in `@jellyfuse/models`
or a restructured query key. Next boot drops the stale MMKV entry
instead of trying to deserialise the old shape. Cheaper than writing
migration shims while the model layer is still churning.

## No `useEffect` for async

Every hook in this directory uses `useQuery` / `useMutation` /
`queryClient.fetchQuery`. No `useEffect` for async work, no refs for
"current value" — React Query is the single source of truth. See
CLAUDE.md "Data flow rule" and React's
[You Might Not Need an Effect](https://react.dev/learn/you-might-not-need-an-effect).
