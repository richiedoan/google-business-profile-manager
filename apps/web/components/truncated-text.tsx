import type { ReactNode } from "react";

/** Keep the full value in the DOM and expose it in a native hover tooltip. */
export function TruncatedText({
  children,
  text,
}: {
  children?: ReactNode;
  text: string;
}) {
  return (
    <span className="truncated-text" title={text}>
      {children ?? text}
    </span>
  );
}
