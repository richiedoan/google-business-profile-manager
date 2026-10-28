import type { ReactNode } from "react";
import { SessionBoundary } from "../../components/session-boundary";
import { WorkspaceShell } from "../../components/workspace-shell";
/** Client gate is UX only. Every private BFF endpoint must enforce SessionGuard. */
export default function ApplicationLayout({
  children,
}: {
  children: ReactNode;
}) {
  return (
    <SessionBoundary>
      <WorkspaceShell>{children}</WorkspaceShell>
    </SessionBoundary>
  );
}
