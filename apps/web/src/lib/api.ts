// Where the standalone Chiron backend lives. In dev we default to the
// same-origin proxy (/chiron-api → backend) so remote port-forwarding only
// needs :3000. Override with NEXT_PUBLIC_API_URL for direct access or prod
// (e.g. https://api.chiron.example).
function resolveApiUrl(): string {
  const configured = process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, "");
  if (configured) return configured;
  if (process.env.NODE_ENV === "development") return "/chiron-api";
  return "http://localhost:8787";
}

export const API_URL = resolveApiUrl();

/** The frontend identity this client sends to the channel-aware backend. */
export const CHANNEL = "web" as const;

/** On by default in dev; force with NEXT_PUBLIC_VERBOSE_LOGGING=true */
export const VERBOSE_LOGGING =
  process.env.NEXT_PUBLIC_VERBOSE_LOGGING === "true" ||
  process.env.NODE_ENV === "development";

export function logApi(...args: unknown[]): void {
  if (VERBOSE_LOGGING) console.log("[chiron-web]", ...args);
}

export function apiUrl(path: string): string {
  return `${API_URL}${path.startsWith("/") ? path : `/${path}`}`;
}
