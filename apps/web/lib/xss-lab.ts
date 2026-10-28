/** Server-side gate only: never expose this flag as NEXT_PUBLIC_*. */
export function isXssLabEnabled(
  env: { NODE_ENV?: string; LOCAL_LAB?: string },
  host: string,
): boolean {
  if (
    env.LOCAL_LAB !== "true" ||
    !["development", "test"].includes(env.NODE_ENV ?? "")
  )
    return false;
  try {
    const url = new URL(`http://${host}`);
    return (
      !url.username &&
      !url.password &&
      url.pathname === "/" &&
      !url.search &&
      !url.hash &&
      ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
    );
  } catch {
    return false;
  }
}
