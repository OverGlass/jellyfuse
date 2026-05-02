import { StyleSheet } from "react-native";

// Web-relaxed StyleSheet wrapper. React Native's `StyleSheet.create` types
// reject web-only CSS properties (`background`, `clipPath`,
// `transitionProperty`, `boxShadow`, `outlineColor`, `inset`, etc.) AND
// widen literal enum values (`"row"` → `"row" | "column" | ...`),
// breaking inference at every consumer site.
//
// `react-native-web` accepts and forwards both the web-only properties
// and the broader literal values at runtime — they're a true superset of
// the RN typings. This wrapper passes the object through unchanged and
// returns it as a loosely-typed map of styles so consumers can write
// idiomatic web CSS without per-site casts.
//
// We only ever ship to web from apps/web, so the looser typing matches
// the contract.
//
type AnyStyle = any;

export function webStyles<T extends Record<string, Record<string, unknown>>>(
  s: T,
): { [K in keyof T]: AnyStyle } {
  return StyleSheet.create(s as never) as never;
}
