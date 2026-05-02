import { View, type ViewProps } from "react-native";

import { useReveal } from "../lib/use-reveal";
import { webStyles } from "./web-styles";

type Delay = 0 | 1 | 2 | 3;

type Props = ViewProps & {
  delay?: Delay;
  children: React.ReactNode;
};

const DELAY_MS: Record<Delay, number> = { 0: 0, 1: 100, 2: 200, 3: 300 };

// Wraps a section block with the reveal-on-scroll fade-up. Mirrors the
// prototype's `.reveal[data-delay]` cascade: 600ms cubic-bezier ease,
// 8px translateY → 0, optional 100/200/300ms staggered start.
export function Reveal({ delay = 0, style, children, ...rest }: Props) {
  const { ref, isIn } = useReveal();
  return (
    <View
      ref={ref}
      style={[
        styles.base,
        {
          transitionProperty: "opacity, transform",
          transitionDuration: "600ms",
          transitionTimingFunction: "cubic-bezier(.2,.8,.2,1)",
          transitionDelay: `${DELAY_MS[delay]}ms`,
        },
        isIn ? styles.in : null,
        style,
      ]}
      {...rest}
    >
      {children}
    </View>
  );
}

const styles = webStyles({
  base: {
    opacity: 0,
    transform: [{ translateY: 8 }],
  },
  in: {
    opacity: 1,
    transform: [{ translateY: 0 }],
  },
});
