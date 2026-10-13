# The app (API + built web pages) for `docker compose up`. Postgres and Ollama run as separate services.
FROM node:24-slim
RUN npm install -g pnpm@11.1.1
WORKDIR /app

# dependencies first, so code changes don't reinstall them
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/
RUN pnpm install --frozen-lockfile

COPY . .
RUN pnpm --filter @mapper/web build

ENV WEB_DIST=/app/apps/web/dist
CMD ["/app/scripts/docker-start.sh"]
