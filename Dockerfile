# Bookworm 是 Debian 12 的代号，slim 为精简版 Node.js 基础镜像。
FROM node:24-bookworm-slim AS dependencies
WORKDIR /app
# 缺少预编译包的平台可从源码构建 canvas，编译工具不进入运行镜像。
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ pkg-config libcairo2-dev libpango1.0-dev \
    libjpeg-dev libgif-dev librsvg2-dev \
    && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

FROM node:24-bookworm-slim
ENV NODE_ENV=production PORT=4000 INK_DATA_DIR=/app/data INK_CONFIG_FILE=/app/config.json TZ=Asia/Shanghai
WORKDIR /app
# 中文常规及粗体字体随 public/fonts 提供，无需重复安装整套中日韩字体。
RUN apt-get update && apt-get install -y --no-install-recommends \
    libcairo2 libpango-1.0-0 libpangocairo-1.0-0 libjpeg62-turbo libgif7 librsvg2-2 \
    fontconfig tzdata ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && mkdir /app/data && chown node:node /app/data
COPY --from=dependencies /app/node_modules ./node_modules
COPY package.json config.json server.js ./
COPY lib ./lib
COPY public ./public
# 发布版本由 CI 注入，放在依赖安装之后以保留构建缓存。
ARG APP_VERSION=dev
ENV APP_VERSION=${APP_VERSION}
USER node
EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e 'fetch("http://127.0.0.1:"+process.env.PORT+"/api/health",{signal:AbortSignal.timeout(4000)}).then(async r=>{const d=await r.json();if(!r.ok||!d.ok||d.service!=="mojian")process.exit(1)}).catch(()=>process.exit(1))'
CMD ["node", "server.js"]
