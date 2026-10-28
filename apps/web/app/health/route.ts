import { decodeHealth } from "../../lib/bff-client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  const headers = { "Cache-Control": "no-store" };
  try {
    // Bindings exist only at function runtime. Never expose this URL to the browser.
    const base = process.env.API_URL;
    if (!base) throw new Error("API_URL binding is required");
    const response = await fetch(
      new URL("health", base.endsWith("/") ? base : `${base}/`),
      {
        cache: "no-store",
        redirect: "error",
        signal: AbortSignal.timeout(5000),
      },
    );
    if (!response.ok) throw new Error("API health check failed");
    return Response.json(decodeHealth(await response.json()), { headers });
  } catch {
    return Response.json({ status: "unavailable" }, { status: 503, headers });
  }
}
