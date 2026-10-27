FROM node:24-alpine
RUN apk add --no-cache su-exec
WORKDIR /app
COPY package*.json ./
RUN npm install --include=dev --no-audit --no-fund
COPY . .
RUN npm run build
ENV NODE_ENV=production
ENV RAILWAY_RUN_UID=0
EXPOSE 8080
CMD ["npm","start"]

