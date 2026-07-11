import dotenv from "dotenv";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const serverRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const repoRoot = path.resolve(serverRoot, "../..");

// Monorepo-friendly env loading. npm workspaces run with cwd=apps/server, so a
// plain `import "dotenv/config"` only sees apps/server/.env and misses the
// shared keys many folks keep at the repo root (.env / .env.local).
const envFiles = [
  path.join(repoRoot, ".env"),
  path.join(repoRoot, ".env.local"),
  path.join(serverRoot, ".env"),
];

for (const [index, file] of envFiles.entries()) {
  if (!fs.existsSync(file)) continue;
  dotenv.config({ path: file, override: index > 0 });
}
