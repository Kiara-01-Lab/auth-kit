FROM node:20-alpine

WORKDIR /app

# Install server dependencies
COPY package*.json ./
RUN npm ci

# Install client dependencies
COPY client/package*.json ./client/
RUN cd client && npm install

# Copy source and build the client
COPY . .
RUN cd client && npm run build

# Prune server dev dependencies
RUN npm prune --omit=dev

ENV NODE_ENV=production
ENV PORT=3001

EXPOSE 3001

CMD ["node", "server.js"]
