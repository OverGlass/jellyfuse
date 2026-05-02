import { useEffect, useRef, useState } from "react";
import type { View } from "react-native";

import type { PlatformId } from "./content";

// Drives the platforms section's cross-fading device frames.
// Each `.platform-step` registers itself; the IO picks whichever step's
// middle is in the middle 20% of the viewport (rootMargin -40% top/bottom)
// and that becomes the `activeFrame`. Cross-fade timing happens in CSS.
//
// SSR-safe: defaults to the first platform so static output always shows
// the iPhone frame and there's zero hydration mismatch.
export function useScrollPin(initial: PlatformId): {
  activeFrame: PlatformId;
  registerStep: (id: PlatformId) => (node: View | null) => void;
} {
  const [activeFrame, setActiveFrame] = useState<PlatformId>(initial);
  const observer = useRef<IntersectionObserver | null>(null);
  const stepNodes = useRef<Map<PlatformId, Element>>(new Map());

  useEffect(() => {
    if (typeof window === "undefined" || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(
      (entries) => {
        let best: { id: PlatformId; ratio: number } | null = null;
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const id = (entry.target as HTMLElement).dataset["frame"] as PlatformId | undefined;
          if (!id) continue;
          if (!best || entry.intersectionRatio > best.ratio) {
            best = { id, ratio: entry.intersectionRatio };
          }
        }
        if (best) setActiveFrame(best.id);
      },
      {
        rootMargin: "-40% 0px -40% 0px",
        threshold: [0, 0.25, 0.5, 0.75, 1],
      },
    );
    observer.current = io;
    for (const node of stepNodes.current.values()) io.observe(node);
    return () => {
      io.disconnect();
      observer.current = null;
    };
  }, []);

  const registerStep = (id: PlatformId) => (node: View | null) => {
    const existing = stepNodes.current.get(id);
    if (existing) observer.current?.unobserve(existing);
    if (node) {
      const dom = node as unknown as HTMLElement;
      dom.dataset["frame"] = id;
      stepNodes.current.set(id, dom);
      observer.current?.observe(dom);
    } else {
      stepNodes.current.delete(id);
    }
  };

  return { activeFrame, registerStep };
}
