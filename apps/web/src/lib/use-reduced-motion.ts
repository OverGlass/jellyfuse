import { useEffect, useState } from "react";

// Reads `prefers-reduced-motion: reduce` and re-renders if the OS-level
// preference flips while the page is open. SSR-safe: defaults to `false`
// so the static markup always reflects the motion-on case, then snaps to
// the user's preference on hydration.
export function useReducedMotion(): boolean {
  const [reduce, setReduce] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const onChange = () => setReduce(mq.matches);
    onChange();
    mq.addEventListener?.("change", onChange);
    return () => mq.removeEventListener?.("change", onChange);
  }, []);
  return reduce;
}
