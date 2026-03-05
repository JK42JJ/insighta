#!/bin/sh
set -e

echo "=== Insighta Container ==="
echo "Mode: $1"
echo "Node ENV: $NODE_ENV"

# =============================================================================
# Wait for database connection
# =============================================================================
wait_for_db() {
    echo "Checking database connection..."

    max_attempts=30
    attempt=0

    while [ $attempt -lt $max_attempts ]; do
        if node -e "
            const { PrismaClient } = require('@prisma/client');
            const prisma = new PrismaClient();
            prisma.\$connect()
                .then(() => {
                    console.log('Database connected successfully');
                    return prisma.\$disconnect();
                })
                .then(() => process.exit(0))
                .catch((err) => {
                    console.error('Connection failed:', err.message);
                    process.exit(1);
                });
        " 2>/dev/null; then
            return 0
        fi

        attempt=$((attempt + 1))
        echo "Waiting for database... (attempt $attempt/$max_attempts)"
        sleep 2
    done

    echo "ERROR: Could not connect to database after $max_attempts attempts"
    exit 1
}

# =============================================================================
# Run database migrations
# =============================================================================
run_migrations() {
    echo "Running database schema sync (prisma db push)..."
    npx prisma db push --skip-generate
    echo "Database schema updated successfully"
}

# =============================================================================
# Main execution
# =============================================================================

# Wait for database
wait_for_db

# Schema sync is handled by CI/CD pipeline (deploy.yml)
# Only run at container start if explicitly requested
if [ "$RUN_SCHEMA_SYNC" = "true" ]; then
    run_migrations
fi

# Determine which service to run
case "$1" in
    api)
        echo "Starting API server on port ${API_PORT:-3000}..."
        exec node dist/api/server.js
        ;;

    scheduler)
        echo "Starting scheduler daemon..."
        exec node dist/cli/index.js schedule-start
        ;;

    cli)
        shift
        echo "Running CLI command: $*"
        exec node dist/cli/index.js "$@"
        ;;

    migrate)
        echo "Running migrations only..."
        run_migrations
        exit 0
        ;;

    shell)
        echo "Starting shell..."
        exec /bin/sh
        ;;

    *)
        # If command doesn't match, run it directly
        echo "Running custom command: $*"
        exec "$@"
        ;;
esac
