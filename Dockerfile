FROM node:24.14.0-bookworm-slim
WORKDIR /app
RUN npm install --prefix /opt/contextledger --no-save --no-audit --no-fund @modelcontextprotocol/sdk@1.29.0 zod@3.25.76
COPY service ./service
COPY data ./data
COPY db ./db
COPY ui ./ui
CMD ["node", "service/server.mjs"]
