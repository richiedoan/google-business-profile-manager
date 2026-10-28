import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { XssLab } from "../../../components/xss-lab";
import { isXssLabEnabled } from "../../../lib/xss-lab";
export const dynamic = "force-dynamic";
export default async function XssLabPage() {
  const requestHeaders = await headers();
  if (!isXssLabEnabled(process.env, requestHeaders.get("host") ?? ""))
    notFound();
  return <XssLab />;
}
