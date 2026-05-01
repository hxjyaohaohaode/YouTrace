FROM node:20-alpine AS builder

WORKDIR /app

COPY package.json package-lock.json ./
COPY server/package.json ./server/
COPY client/package.json ./client/

RUN npm ci

COPY server ./server
COPY client ./client

RUN cd server && npx prisma generate && npx tsc
RUN cd client && npm run build && cp -r dist ../server/public

FROM node:20-alpine AS runner

WORKDIR /app

COPY package.json package-lock.json ./
COPY server/package.json ./server/

RUN npm ci --omit=dev

COPY --from=builder /app/server/prisma ./server/prisma
COPY --from=builder /app/server/dist ./server/dist
COPY --from=builder /app/client/dist ./server/public

RUN cd server && npm install prisma @prisma/client && npx prisma generate

RUN mkdir -p server/uploads/thumbnails

ENV NODE_ENV=production
ENV PORT=10000

EXPOSE 10000

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:10000/api/health || exit 1

CMD ["sh", "-c", "cd server && npx prisma db push --accept-data-loss && node dist/index.js"]
