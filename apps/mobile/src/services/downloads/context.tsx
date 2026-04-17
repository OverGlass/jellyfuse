/**
 * `DownloaderContext` — singleton `Downloader` Nitro object.
 *
 * Created once in the root `_layout.tsx`, placed here so every
 * feature can import `useDownloader()` without prop-drilling. The
 * downloader lives for the full app lifetime (never released).
 *
 * On first render the root layout also calls `rebaseAllPaths` so any
 * stale absolute paths from a previous install are fixed before the
 * first `useLocalDownloads()` render.
 */
import { createContext, useContext, useEffect, useRef, type ReactNode } from "react";
import { createDownloader, type Downloader } from "@jellyfuse/downloader";

const DownloaderContext = createContext<Downloader | null>(null);

export function DownloaderProvider({ children }: { children: ReactNode }) {
  const downloaderRef = useRef<Downloader | null>(null);

  if (downloaderRef.current === null) {
    downloaderRef.current = createDownloader();
  }

  const downloader = downloaderRef.current;

  // Rebase stored paths on every boot. iOS rotates the container UUID on
  // dev rebuilds and OS restores; Android's filesDir is stable, so this is
  // a no-op there. Both impls persist paths relative to the docs root, so
  // we pass `""` as a forward-compatible lifecycle signal.
  useEffect(() => {
    downloader.rebaseAllPaths("");
  }, [downloader]);

  return <DownloaderContext.Provider value={downloader}>{children}</DownloaderContext.Provider>;
}

export function useDownloader(): Downloader {
  const ctx = useContext(DownloaderContext);
  if (ctx === null) {
    throw new Error("useDownloader() called outside <DownloaderProvider>");
  }
  return ctx;
}
