# Chiron backend image. BUILD FROM THE REPO ROOT so the workspace is available:
#   docker build -f apps/server/Dockerfile -t chiron-server .
# (docker-compose.yml at the repo root already sets this context.)

# --- Builder: install the server + shared workspaces and bundle to dist ------
FROM node:20-alpine AS builder
WORKDIR /app

# Only the server + shared workspaces are needed to build the backend. The root
# package.json's "apps/*"/"packages/*" globs then match just these on disk.
COPY package.json ./
COPY packages/shared ./packages/shared
COPY apps/server ./apps/server

RUN npm install --no-audit --no-fund
# tsup bundles @chiron/shared (noExternal) into a self-contained dist/index.js.
RUN npm run build --workspace @chiron/server

# --- Runner: minimal image with only the runtime deps + built bundle ---------
FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=8787

COPY --from=builder /app/apps/server/dist ./dist
COPY apps/server/package.json ./package.json
# The workspace dep is bundled into dist, so drop it and install only the
# external runtime deps (hono, @hono/node-server, openai, @supabase/supabase-js).
RUN node -e "const p=require('./package.json'); delete p.dependencies['@chiron/shared']; delete p.devDependencies; delete p.scripts; require('fs').writeFileSync('./package.json', JSON.stringify(p,null,2))" \
  && npm install --omit=dev --no-audit --no-fund \
  && npm cache clean --force

EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8787)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "dist/index.js"]
