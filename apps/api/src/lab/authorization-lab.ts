/** LOCAL LAB ONLY: deliberately bypasses location permissions and mock account scope. */
export function readAuthorizationLabMode(
  webOrigin: string,
  env: NodeJS.ProcessEnv,
): boolean {
  const requested = env.LOCAL_LAB_BROKEN_AUTHORIZATION === "true";
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(
    new URL(webOrigin).hostname,
  );
  if (
    requested &&
    !(
      env.LOCAL_LAB_ONLY === "true" &&
      ["development", "test"].includes(env.NODE_ENV ?? "") &&
      local
    )
  )
    throw new Error(
      "Broken authorization lab requires explicit local development/test mode.",
    );
  return requested;
}
