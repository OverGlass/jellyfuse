import { useEffect, useRef, useState } from "react";
import type { View } from "react-native";

// Reveal-on-scroll: returns a ref callback to attach to the root view of
// any element that should fade up the first time it enters the viewport.
// Mirrors the prototype's `.reveal.is-in` toggle, observed once and then
// unobserved.
//
// `rootMargin: '0px 0px -8% 0px'` so the reveal fires slightly before
// an element is fully on-screen — matches the prototype's tuning.
//
// SSR-safe: defaults to `isIn=false` so the static markup ships in the
// "before reveal" state. The CSS handles the eventual fade.
export function useReveal(): {
  ref: (node: View | null) => void;
  isIn: boolean;
} {
  const [isIn, setIsIn] = useState(false);
  const observer = useRef<IntersectionObserver | null>(null);

  const ref = (node: View | null) => {
    observer.current?.disconnect();
    observer.current = null;
    if (!node || typeof window === "undefined") return;
    if (typeof IntersectionObserver === "undefined") {
      setIsIn(true);
      return;
    }
    const dom = node as unknown as Element;
    const io = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (entry?.isIntersecting) {
          setIsIn(true);
          io.disconnect();
          observer.current = null;
        }
      },
      { rootMargin: "0px 0px -8% 0px", threshold: 0.05 },
    );
    io.observe(dom);
    observer.current = io;
  };

  useEffect(() => {
    return () => {
      observer.current?.disconnect();
      observer.current = null;
    };
  }, []);

  return { ref, isIn };
}
