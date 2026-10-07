FROM node:24-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
RUN npm ci --omit=dev --no-audit --no-fund
COPY . .
RUN mkdir -p /opt/secureid-data && chown -R node:node /app /opt/secureid-data
ENV DATABASE_PATH=/opt/secureid-data/secureid.sqlite
USER node
EXPOSE 10000
CMD ["npm", "start"]
