FROM node:20-slim

RUN apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json ./
COPY server/package.json ./server/
COPY client/package.json ./client/

RUN npm ci

COPY server ./server
COPY client ./client

RUN cd server && npx prisma generate && npx tsc -p tsconfig.build.json
RUN cd client && npm run build && cp -r dist ../server/public

RUN rm -rf client/node_modules client/src server/src
RUN rm -rf /root/.npm

RUN mkdir -p server/uploads/thumbnails

RUN chmod +x server/start.sh

ENV NODE_ENV=production
ENV PORT=10000

EXPOSE 10000

CMD ["sh", "-c", "cd server && ./start.sh"]
