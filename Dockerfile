FROM node:20-alpine

WORKDIR /app

COPY package.json package-lock.json ./
COPY server/package.json ./server/
COPY client/package.json ./client/

RUN npm ci

COPY server ./server
COPY client ./client

RUN cd server && npx prisma generate && npx tsc
RUN cd client && npm run build && cp -r dist ../server/public

RUN rm -rf client/node_modules client/src server/src
RUN rm -rf /root/.npm

RUN mkdir -p server/uploads/thumbnails

ENV NODE_ENV=production
ENV PORT=10000

EXPOSE 10000

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:10000/api/health || exit 1

CMD ["sh", "-c", "cd server && retry=0; until npx prisma db push --accept-data-loss || [ $retry -ge 5 ]; do retry=$((retry+1)); echo \"Database not ready, retry $retry/5...\"; sleep 5; done && node dist/index.js"]
