import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { bffClient } from "./bff-client";
import { businessReadCacheOptions } from "./query-client";
export interface GoogleConnection {
  id: string;
  email: string;
  status: "ACTIVE" | "RECONNECT_REQUIRED";
}
export function decodeConnections(value: unknown): {
  enabled: boolean;
  connections: GoogleConnection[];
} {
  if (
    typeof value !== "object" ||
    value === null ||
    !("enabled" in value) ||
    typeof value.enabled !== "boolean" ||
    !("connections" in value) ||
    !Array.isArray(value.connections)
  )
    throw new Error("Invalid connections response");
  return {
    enabled: value.enabled,
    connections: value.connections.map((row: unknown) => {
      if (
        typeof row !== "object" ||
        row === null ||
        !("id" in row) ||
        typeof row.id !== "string" ||
        !("email" in row) ||
        typeof row.email !== "string" ||
        !("status" in row) ||
        (row.status !== "ACTIVE" && row.status !== "RECONNECT_REQUIRED")
      )
        throw new Error("Invalid connection");
      return { id: row.id, email: row.email, status: row.status };
    }),
  };
}
export function useGoogleConnections() {
  return useQuery({
    queryKey: ["google-connections"],
    queryFn: ({ signal }) =>
      bffClient.get("/api/google-connections", decodeConnections, signal),
    ...businessReadCacheOptions,
  });
}
export function useConnectGoogle() {
  return useMutation({
    mutationFn: () =>
      bffClient.post("/api/google-connections/connect", (value) => {
        if (
          typeof value !== "object" ||
          value === null ||
          !("url" in value) ||
          typeof value.url !== "string"
        )
          throw new Error("Invalid OAuth URL");
        const url = new URL(value.url);
        if (
          url.origin !== "https://accounts.google.com" ||
          url.pathname !== "/o/oauth2/v2/auth"
        )
          throw new Error("Invalid OAuth URL");
        return url.href;
      }),
    onSuccess: (url) => {
      window.location.assign(url);
    },
  });
}
export function useDisconnectGoogle() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      bffClient.delete(
        `/api/google-connections/${encodeURIComponent(id)}`,
        (value) => {
          if (
            typeof value !== "object" ||
            value === null ||
            !("status" in value) ||
            value.status !== "ok"
          )
            throw new Error("Invalid disconnect response");
          return value;
        },
      ),
    onSuccess: async () => {
      await client.cancelQueries({
        predicate: (q) =>
          ["accounts", "locations", "location"].includes(String(q.queryKey[0])),
      });
      client.removeQueries({
        predicate: (q) =>
          ["accounts", "locations", "location"].includes(String(q.queryKey[0])),
      });
      await client.invalidateQueries({ queryKey: ["google-connections"] });
    },
  });
}
export function withConnection(path: string, connectionId?: string): string {
  if (!connectionId) return path;
  return `${path}${path.includes("?") ? "&" : "?"}connectionId=${encodeURIComponent(connectionId)}`;
}
