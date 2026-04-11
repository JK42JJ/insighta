# =============================================================================
# Insighta Frontend - Multi-stage Docker Build
# =============================================================================
# Stage 1: Build the React application (FSD architecture)
# Stage 2: Serve with nginx
# =============================================================================

# =============================================================================
# Stage 1: Builder
# =============================================================================
FROM node:20-alpine AS builder

WORKDIR /app

# Copy package files for layer caching
COPY package*.json ./

# Install dependencies (--no-package-lock: macOS lockfile misses Linux native
# binaries for rollup due to npm/cli#4828 optional deps bug)
RUN npm install --no-package-lock --no-audit

# Copy source files
COPY . .

# Build arguments for environment variables
ARG VITE_API_URL=/api
ARG VITE_SUPABASE_URL=http://localhost:8000
ARG VITE_SUPABASE_PUBLISHABLE_KEY=
ARG VITE_APP_NAME=Insighta
ARG VITE_APP_VERSION=2.0.0
ARG VITE_POSTHOG_KEY=

ENV VITE_API_URL=${VITE_API_URL}
ENV VITE_SUPABASE_URL=${VITE_SUPABASE_URL}
ENV VITE_SUPABASE_PUBLISHABLE_KEY=${VITE_SUPABASE_PUBLISHABLE_KEY}
ENV VITE_APP_NAME=${VITE_APP_NAME}
ENV VITE_APP_VERSION=${VITE_APP_VERSION}
ENV VITE_POSTHOG_KEY=${VITE_POSTHOG_KEY}

# Build the application
RUN npm run build

# =============================================================================
# Stage 2: Production with Nginx
# =============================================================================
FROM nginx:alpine AS runner

# Install envsubst for runtime environment variable substitution
RUN apk add --no-cache gettext

# Security: Create non-root user
RUN addgroup -g 1001 -S appgroup && \
    adduser -S -D -H -u 1001 -h /var/cache/nginx -s /sbin/nologin -G appgroup appuser

# Copy nginx configuration template
COPY nginx/nginx.conf.template /etc/nginx/templates/default.conf.template
COPY nginx/nginx.conf /etc/nginx/nginx.conf

# Copy built application
COPY --from=builder /app/dist /usr/share/nginx/html

# Create cache and run directories with proper permissions
RUN mkdir -p /var/cache/nginx /var/run /var/log/nginx /etc/nginx/conf.d && \
    chown -R appuser:appgroup /var/cache/nginx /var/run /var/log/nginx /usr/share/nginx/html /etc/nginx/templates /etc/nginx/conf.d /etc/nginx/nginx.conf && \
    chmod -R 755 /usr/share/nginx/html /etc/nginx/templates && \
    chmod 644 /etc/nginx/nginx.conf

# Environment variables for nginx config
ENV API_URL=http://api:3000
ENV NGINX_PORT=8081

# Use non-root user
USER appuser

# Expose port
EXPOSE 8081

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD wget -q --spider http://localhost:8081/ || exit 1

# Start nginx with environment variable substitution
CMD ["/bin/sh", "-c", "envsubst '${API_URL}' < /etc/nginx/templates/default.conf.template > /etc/nginx/conf.d/default.conf && nginx -g 'daemon off;'"]
