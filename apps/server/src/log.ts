import { env } from "./config";

/** Log when VERBOSE_LOGGING=true in apps/server/.env */
export function logVerbose(scope: string, ...args: unknown[]): void {
  if (!env.verboseLogging) return;
  console.log(`[${scope}]`, ...args);
}
