#!/bin/sh
set -e

MAX_RETRIES=10
RETRY_INTERVAL=5

echo "Waiting for database to be ready..."
for i in $(seq 1 $MAX_RETRIES); do
  if npx prisma db push --accept-data-loss; then
    echo "Database schema pushed successfully"
    break
  fi
  if [ "$i" -eq "$MAX_RETRIES" ]; then
    echo "Failed to connect to database after $MAX_RETRIES attempts"
    exit 1
  fi
  echo "Database not ready, retry $i/$MAX_RETRIES in ${RETRY_INTERVAL}s..."
  sleep $RETRY_INTERVAL
done

echo "Starting server..."
exec node dist/index.js
