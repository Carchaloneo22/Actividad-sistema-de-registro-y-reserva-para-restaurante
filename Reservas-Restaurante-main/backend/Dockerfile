FROM node:20-alpine

ENV NODE_ENV=production
WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --chown=node:node . .
RUN mkdir -p /app/logs /app/uploads /app/backups && chown -R node:node /app

USER node
EXPOSE 3000
CMD ["node", "server.js"]
