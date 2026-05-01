FROM node:20-alpine AS builder

WORKDIR /app

COPY server/package*.json ./server/
COPY client/package*.json ./client/

RUN cd server && npm ci
RUN cd client && npm ci

COPY server ./server
COPY client ./client

RUN cd server && npx prisma generate && npx tsc
RUN cd client && npm run build

FROM node:20-alpine AS runner

WORKDIR /app

COPY server/package*.json ./
RUN npm ci --omit=dev && npm install prisma

COPY --from=builder /app/server/prisma ./prisma
COPY --from=builder /app/server/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder /app/server/dist ./dist
COPY --from=builder /app/client/dist ./public

RUN mkdir -p uploads/thumbnails

ENV NODE_ENV=production
ENV PORT=10000

EXPOSE 10000

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:10000/api/health || exit 1

CMD ["sh", "-c", "npx prisma db push --accept-data-loss && node dist/index.js"]
