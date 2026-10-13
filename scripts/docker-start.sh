#!/bin/sh
# Container start-up: set up the database, load the source files and build the embeddings
# the first time only, then serve the app. Later starts skip straight to the server.
set -e
cd /app/apps/api

echo "==> Setting up the database"
npx tsx src/db/migrate.ts

loaded=$(npx tsx scripts/curricula-count.ts)
if [ "$loaded" = "0" ]; then
  echo "==> Loading data/source (first start only)"
  npx tsx src/ingest/cli.ts
fi

echo "==> Building search embeddings (first start takes a few minutes; later starts skip this)"
npx tsx src/matching/cli.ts embed

echo "==> Ready: open http://localhost:8080"
exec npx tsx src/server.ts
