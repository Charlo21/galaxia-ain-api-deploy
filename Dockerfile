FROM node:18-alpine

WORKDIR /app

# Copy package files
COPY package*.json ./
COPY tsconfig.json ./

# Install dependencies (package has no local lockfile in the monorepo layout)
RUN npm install

# psql for migration entrypoint
RUN apk add --no-cache postgresql-client

# Copy source code
COPY src ./src
COPY database ./database

# Build TypeScript
RUN npm run build

# Prune devDependencies for runtime image size
RUN npm prune --omit=dev

# Copy scripts
COPY scripts ./scripts
RUN chmod +x scripts/docker-entrypoint.sh

# Expose port
EXPOSE 3000

# Migrations + server (Render/production)
ENTRYPOINT ["sh", "scripts/docker-entrypoint.sh"]
