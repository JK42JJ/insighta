# =============================================================================
# Stage 1: Builder
# =============================================================================
FROM node:20-alpine AS builder

# Install build dependencies for native modules (bcrypt)
RUN apk add --no-cache python3 make g++ libc6-compat

WORKDIR /app

# Copy package files for layer caching
COPY package*.json .npmrc ./
COPY prisma ./prisma/

# Install all dependencies (including devDependencies for build)
RUN npm ci

# Copy source files
COPY tsconfig.json ./
COPY src ./src

# Build TypeScript
RUN npm run build

# Generate Prisma client
RUN npx prisma generate

# =============================================================================
# Stage 2: Production Dependencies
# =============================================================================
FROM node:20-alpine AS deps

RUN apk add --no-cache libc6-compat

WORKDIR /app

COPY package*.json .npmrc ./

# Install production dependencies only (skip prepare script for husky)
RUN npm ci --omit=dev --ignore-scripts

# =============================================================================
# Stage 3: Runner
# =============================================================================
FROM node:20-alpine AS runner

# Install runtime dependencies including OpenSSL 3.x
RUN apk add --no-cache libc6-compat curl openssl

# Security: Create non-root user
RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 appuser

WORKDIR /app

# Copy production dependencies
COPY --from=deps /app/node_modules ./node_modules

# Copy built application
COPY --from=builder /app/dist ./dist

# Copy Prisma schema (not the generated client - we'll regenerate it)
COPY --from=builder /app/prisma ./prisma

# Regenerate Prisma client with correct OpenSSL version for this platform
RUN npx prisma generate

# Copy package.json for runtime
COPY package.json ./

# Create directories with proper permissions
RUN mkdir -p /app/cache /app/logs /app/data && \
    chown -R appuser:nodejs /app

# Copy entrypoint script and set permissions before switching user
COPY docker/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh && \
    chown appuser:nodejs /entrypoint.sh

# Switch to non-root user
USER appuser

# Environment defaults
ENV NODE_ENV=production
ENV API_HOST=0.0.0.0
ENV API_PORT=3000

# Expose API port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
    CMD curl -f http://localhost:${API_PORT:-3000}/health || exit 1

ENTRYPOINT ["/entrypoint.sh"]

# Default command (API server)
CMD ["api"]
