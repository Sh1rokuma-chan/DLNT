FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY . .

# セキュリティ: 非rootユーザーで実行
RUN addgroup -S appgroup && adduser -S appuser -G appgroup \
    && mkdir -p /app/data/conversations \
    && chown -R appuser:appgroup /app

USER appuser

EXPOSE 3002

CMD ["node", "server.js"]
