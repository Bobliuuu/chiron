// Where the standalone Chiron backend lives. In dev it's localhost:8787; in
// production set NEXT_PUBLIC_API_URL to the backend's custom domain
// (e.g. https://api.chiron.example). The web app is now a thin client — all
// agent + data logic lives in the backend service.
export const API_URL = (
  process.env.NEXT_PUBLIC_API_URL || "http://localhost:8787"
).replace(/\/$/, "");

/** The frontend identity this client sends to the channel-aware backend. */
export const CHANNEL = "web" as const;

export function apiUrl(path: string): string {
  return `${API_URL}${path.startsWith("/") ? path : `/${path}`}`;
}
