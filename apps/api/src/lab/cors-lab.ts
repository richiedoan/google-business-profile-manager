/** LOCAL LAB ONLY: intentionally reflects arbitrary origins for a CORS demonstration. */
export function readCorsLabMode(
  webOrigin: string,
  env: NodeJS.ProcessEnv,
): boolean {
  const requested = env.LOCAL_LAB_CORS_REFLECT === "true";
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
    throw new Error("CORS lab requires explicit local development/test mode.");
  return requested;
}
