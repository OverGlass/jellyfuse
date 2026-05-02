import { useEffect, useState } from "react";

// Tracks whether the page has been scrolled past `threshold` px so the nav
// can switch from transparent to opaque-with-blur. Mirrors the prototype's
// `is-scrolled` class toggle — runs only after hydration so SSR output is
// always the unscrolled (transparent) state.
export function useNavScroll(threshold = 8): boolean {
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined") return;
    const onScroll = () => setScrolled(window.scrollY > threshold);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, [threshold]);
  return scrolled;
}
