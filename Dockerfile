FROM node:24-bookworm-slim AS dependencies
WORKDIR /app
# canvas can compile from source on platforms without a prebuilt binary.
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ pkg-config libcairo2-dev libpango1.0-dev \
    libjpeg-dev libgif-dev librsvg2-dev \
    && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

FROM node:24-bookworm-slim
ENV NODE_ENV=production PORT=4000 INK_DATA_DIR=/app/data INK_CONFIG_FILE=/app/config.json TZ=Asia/Shanghai
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends \
    libcairo2 libpango-1.0-0 libpangocairo-1.0-0 libjpeg62-turbo libgif7 librsvg2-2 \
    fonts-noto-cjk fontconfig tzdata ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && mkdir /app/data && chown node:node /app/data
COPY --from=dependencies /app/node_modules ./node_modules
COPY package.json config.json server.js ./
COPY lib ./lib
COPY public ./public
USER node
EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e 'fetch("http://127.0.0.1:"+process.env.PORT+"/api/health",{signal:AbortSignal.timeout(4000)}).then(async r=>{const d=await r.json();if(!r.ok||!d.ok||d.service!=="ink-studio")process.exit(1)}).catch(()=>process.exit(1))'
CMD ["node", "server.js"]
