import type { TextProps } from "react-native";
import { Text } from "react-native";

// React Native Web extension: passing `href` (and optionally `target`,
// `rel`) to a Text component renders an actual <a> element in the static
// markup. That's what we need for SEO and for crawlers — not a JS-only
// onPress handler. The cast bypasses RN's strict types since `href` is a
// web-only addition; runtime ignores it on native (we don't ship native).
type TextLinkProps = Omit<TextProps, "children"> & {
  href: string;
  target?: string;
  rel?: string;
  children: React.ReactNode;
};

type WebProps = { href: string; target?: string; rel?: string };

export function TextLink({ href, target, rel, children, ...rest }: TextLinkProps) {
  const webProps: WebProps =
    target !== undefined && rel !== undefined
      ? { href, target, rel }
      : target !== undefined
        ? { href, target }
        : rel !== undefined
          ? { href, rel }
          : { href };
  return (
    <Text accessibilityRole="link" {...rest} {...(webProps as unknown as TextProps)}>
      {children}
    </Text>
  );
}
