import Svg, { Circle, Path, Rect } from "react-native-svg";

import type { FeatureIconId } from "../lib/content";

type Props = { id: FeatureIconId; size?: number; color?: string };

// Marketing-page line icons. Drawn at 24px viewBox. Stroke-only style with
// the same 1.6px line weight throughout so the grid feels uniform. We use
// react-native-svg primitives instead of inline <svg> tags to keep with
// the project's "no raw HTML" rule.
export function FeatureIcon({ id, size = 20, color = "currentColor" }: Props) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      {render(id, color)}
    </Svg>
  );
}

function render(id: FeatureIconId, c: string) {
  switch (id) {
    case "download":
      return (
        <>
          <Path
            d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"
            stroke={c}
            strokeWidth={1.6}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <Path
            d="M7 10l5 5 5-5"
            stroke={c}
            strokeWidth={1.6}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <Path
            d="M12 15V3"
            stroke={c}
            strokeWidth={1.6}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </>
      );
    case "audio":
      return (
        <>
          <Path
            d="M9 18V5l12-2v13"
            stroke={c}
            strokeWidth={1.6}
            strokeLinejoin="round"
            strokeLinecap="round"
          />
          <Circle cx={6} cy={18} r={3} stroke={c} strokeWidth={1.6} />
          <Circle cx={18} cy={16} r={3} stroke={c} strokeWidth={1.6} />
        </>
      );
    case "pip":
      return (
        <>
          <Rect x={2} y={4} width={20} height={14} rx={2} stroke={c} strokeWidth={1.6} />
          <Rect x={13} y={11} width={7} height={5} rx={1} fill={c} opacity={0.3} />
        </>
      );
    case "trickplay":
      return (
        <>
          <Rect x={2} y={6} width={20} height={12} rx={1} stroke={c} strokeWidth={1.6} />
          <Path d="M2 12h20M8 6v12M16 6v12" stroke={c} strokeWidth={1.6} strokeLinecap="round" />
        </>
      );
    case "chapters":
      return (
        <Path
          d="M3 6h2M9 6h12M3 12h2M9 12h12M3 18h2M9 18h12"
          stroke={c}
          strokeWidth={1.6}
          strokeLinecap="round"
        />
      );
    case "skip":
      return (
        <Path
          d="M5 12h7l3-7 3 14 3-7h2"
          stroke={c}
          strokeWidth={1.6}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      );
    case "subtitles":
      return (
        <>
          <Path d="M4 6h16M4 12h12M4 18h8" stroke={c} strokeWidth={1.6} strokeLinecap="round" />
          <Path
            d="M14 15l2 2 4-4"
            stroke={c}
            strokeWidth={1.6}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </>
      );
    case "users":
      return (
        <>
          <Circle cx={9} cy={8} r={3} stroke={c} strokeWidth={1.6} />
          <Circle cx={17} cy={9} r={2.5} stroke={c} strokeWidth={1.6} />
          <Path
            d="M3 19c0-3 3-5 6-5s6 2 6 5M16 18c0-2 2-4 5-3"
            stroke={c}
            strokeWidth={1.6}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </>
      );
    case "search":
      return (
        <>
          <Circle cx={11} cy={11} r={6} stroke={c} strokeWidth={1.6} />
          <Path d="M16 16l5 5" stroke={c} strokeWidth={1.6} strokeLinecap="round" />
        </>
      );
  }
}
