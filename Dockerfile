# ---- dependencies -------------------------------------------------------
FROM node:22-bookworm-slim AS deps
WORKDIR /app

COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/

RUN npm ci

# ---- build --------------------------------------------------------------
FROM deps AS build
WORKDIR /app

COPY . .

RUN npm run db:generate --workspace=apps/api
RUN npm run build

# ---- runtime ------------------------------------------------------------
FROM node:22-bookworm-slim AS runtime
WORKDIR /app

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=3000

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/apps/api/package.json ./apps/api/package.json
COPY --from=build /app/apps/api/dist ./apps/api/dist
COPY --from=build /app/apps/api/prisma ./apps/api/prisma
COPY --from=build /app/apps/api/prisma7.config.ts ./apps/api/prisma7.config.ts
COPY --from=build /app/apps/web/dist ./apps/web/dist

RUN mkdir -p /app/apps/api/data && chown -R node:node /app

USER node

EXPOSE 3000

# Apply the (single-file) SQLite schema, then start the API and dashboard.
CMD ["sh", "-c", "cd apps/api && npx prisma db push && exec node dist/server.js"]
