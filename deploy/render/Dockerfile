FROM node:24-bookworm-slim AS build
RUN apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*
WORKDIR /app/server
COPY youji-app/server/package.json youji-app/server/package-lock.json ./
RUN npm ci
COPY youji-app/server ./
RUN npm run db:generate && npm run build

FROM node:24-bookworm-slim AS runtime
RUN apt-get update && apt-get install -y --no-install-recommends python3 openssl && rm -rf /var/lib/apt/lists/*
WORKDIR /app/server
COPY --from=build /app/server/package.json /app/server/package-lock.json ./
COPY --from=build /app/server/node_modules ./node_modules
COPY --from=build /app/server/prisma ./prisma
COPY --from=build /app/server/dist ./dist
COPY deploy/local/runtime.py deploy/local/storage.py /app/local/
COPY deploy/render/runtime.py /app/render/runtime.py
RUN mkdir -p /var/data && chown node:node /var/data
USER node
ENV NODE_ENV=production HOST=0.0.0.0 PORT=10000 DATA_DIR=/var/data/youtrace BACKUP_DIR=/var/data/backups
EXPOSE 10000
CMD ["python3", "/app/render/runtime.py"]
