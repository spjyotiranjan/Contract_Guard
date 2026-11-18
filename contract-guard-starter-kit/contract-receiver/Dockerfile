FROM node:22-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY server.mjs ./
ENV NODE_ENV=production PORT=9100 DATA_DIR=/data
EXPOSE 9100
CMD ["node", "server.mjs"]
