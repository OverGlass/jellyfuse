// @jellyfuse/api — pure TS Jellyfin + Jellyseerr HTTP clients.
// No classes with state, no business logic, no persistence. Every call is a
// pure function taking an ApiClient (injected at the call site). Uses Nitro
// Fetch in the app; uses the platform `fetch` in tests.

export * from "./auth-header";
export * from "./system-info";
export * from "./authenticate";
export * from "./jellyseerr";
export * from "./shelves";
export * from "./detail";
