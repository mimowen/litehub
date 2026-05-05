FROM oven/bun:1 AS base
WORKDIR /app

# 安装依赖
COPY package.json ./
RUN bun install --frozen-lockfile 2>/dev/null || bun install

# 复制源码和静态文件
COPY src/ ./src/
COPY api/ ./api/
COPY public/ ./public/
COPY skills/ ./skills/

# 数据库持久化卷
VOLUME /app/data

ENV PORT=3000
ENV LITEHUB_DB=/app/data/litehub.db

EXPOSE 3000

CMD ["bun", "run", "src/server.ts"]
