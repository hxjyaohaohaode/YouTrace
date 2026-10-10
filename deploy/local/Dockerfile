FROM node:24-bookworm-slim AS build
RUN apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY youji-app/package.json youji-app/package-lock.json ./
RUN npm ci
COPY youji-app ./
RUN VITE_API_BASE_URL=/api npm run build
WORKDIR /app/server
RUN npm ci && npm run db:generate && npm run build

FROM node:24-bookworm-slim AS api
RUN apt-get update && apt-get install -y --no-install-recommends python3 openssl && rm -rf /var/lib/apt/lists/*
WORKDIR /app/server
COPY --from=build /app/server/package.json /app/server/package-lock.json ./
COPY --from=build /app/server/node_modules ./node_modules
COPY --from=build /app/server/prisma ./prisma
COPY --from=build /app/server/dist ./dist
COPY deploy/local/runtime.py deploy/local/storage.py /app/local/
RUN mkdir /data /backups && chown node:node /data /backups
USER node
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3000 DATA_DIR=/data
EXPOSE 3000
CMD ["python3", "/app/local/runtime.py"]

FROM nginx:stable-alpine AS web
COPY --from=build /app/dist /usr/share/nginx/html
COPY deploy/local/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 8443
