#!/bin/bash
set -e

# =============================================================================
# TubeArchive - Development Docker Environment Script
# =============================================================================
# Manages TubeArchive containers with local Supabase integration
# Usage: ./scripts/dev-docker.sh {start|stop|restart|logs|migrate|studio|status}
# =============================================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
SUPABASE_DIR="${SUPABASE_DIR:-$HOME/cursor/superbase}"
COMPOSE_FILE="docker-compose.local.yml"
ENV_FILE=".env.docker.local"

# =============================================================================
# Colors for output
# =============================================================================
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# =============================================================================
# Logging functions
# =============================================================================
log_info() { echo -e "${GREEN}[INFO]${NC} $1"; }
log_warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1"; }
log_step() { echo -e "${BLUE}[STEP]${NC} $1"; }

# =============================================================================
# Print banner
# =============================================================================
print_banner() {
    echo -e "${CYAN}"
    echo "========================================"
    echo "  TubeArchive Docker Development"
    echo "  with Local Supabase Integration"
    echo "========================================"
    echo -e "${NC}"
}

# =============================================================================
# Check if Supabase is running
# =============================================================================
check_supabase() {
    log_step "Checking Supabase status..."
    if docker ps --format '{{.Names}}' | grep -q 'supabase-db-dev\|supabase_db'; then
        log_info "✅ Supabase PostgreSQL is running"
        return 0
    else
        log_error "❌ Supabase is not running!"
        echo ""
        log_info "Start Supabase with:"
        echo -e "  ${CYAN}cd $SUPABASE_DIR && docker compose -f docker-compose.dev.yml --env-file .env.dev up -d${NC}"
        echo ""
        return 1
    fi
}

# =============================================================================
# Check if Supabase network exists
# =============================================================================
check_network() {
    if docker network ls --format '{{.Name}}' | grep -q 'supabase-dev_supabase-dev\|supabase_default'; then
        log_info "✅ Supabase network available"
        return 0
    else
        log_error "❌ Supabase network not found"
        log_info "Make sure Supabase is started first"
        return 1
    fi
}

# =============================================================================
# Check and create environment file
# =============================================================================
check_env_file() {
    if [ ! -f "$PROJECT_DIR/$ENV_FILE" ]; then
        log_warn "⚠️  $ENV_FILE not found"
        if [ -f "$PROJECT_DIR/.env.docker.example" ]; then
            log_info "Creating from .env.docker.example..."
            cp "$PROJECT_DIR/.env.docker.example" "$PROJECT_DIR/$ENV_FILE"
            log_warn "Please edit $ENV_FILE with your configuration"
            return 1
        else
            log_error "No template file found. Please create $ENV_FILE manually."
            return 1
        fi
    fi
    log_info "✅ Environment file exists"
    return 0
}

# =============================================================================
# Start TubeArchive
# =============================================================================
start() {
    print_banner
    log_step "Starting TubeArchive local development..."

    check_supabase || exit 1
    check_network || exit 1
    check_env_file || exit 1

    cd "$PROJECT_DIR"

    log_step "Building and starting containers..."
    docker compose -f "$COMPOSE_FILE" up -d --build

    echo ""
    log_info "🚀 TubeArchive started successfully!"
    echo ""
    echo -e "  ${GREEN}Frontend:${NC}  http://localhost:8080"
    echo -e "  ${GREEN}API:${NC}       http://localhost:3000"
    echo -e "  ${GREEN}API Docs:${NC}  http://localhost:3000/documentation"
    echo -e "  ${GREEN}Health:${NC}    http://localhost:3000/health"
    echo ""
    echo -e "  ${CYAN}Supabase Studio:${NC} http://localhost:8000"
    echo ""
    log_info "View logs with: ./scripts/dev-docker.sh logs"
}

# =============================================================================
# Stop TubeArchive
# =============================================================================
stop() {
    print_banner
    log_step "Stopping TubeArchive..."
    cd "$PROJECT_DIR"
    docker compose -f "$COMPOSE_FILE" down
    log_info "✅ TubeArchive stopped"
}

# =============================================================================
# Restart TubeArchive
# =============================================================================
restart() {
    stop
    echo ""
    start
}

# =============================================================================
# View logs
# =============================================================================
logs() {
    cd "$PROJECT_DIR"
    local service="${1:-}"
    if [ -n "$service" ]; then
        docker compose -f "$COMPOSE_FILE" logs -f "$service"
    else
        docker compose -f "$COMPOSE_FILE" logs -f
    fi
}

# =============================================================================
# Run database migrations/push
# =============================================================================
migrate() {
    log_step "Running database schema push..."
    check_supabase || exit 1

    cd "$PROJECT_DIR"

    # Check if API container is running
    if docker ps --format '{{.Names}}' | grep -q 'tubearchive-api-local'; then
        docker compose -f "$COMPOSE_FILE" exec api npx prisma db push
    else
        log_warn "API container not running. Starting temporary container..."
        docker compose -f "$COMPOSE_FILE" run --rm api npx prisma db push
    fi

    log_info "✅ Database schema updated"
}

# =============================================================================
# Open Prisma Studio
# =============================================================================
studio() {
    log_step "Opening Prisma Studio..."
    check_supabase || exit 1

    cd "$PROJECT_DIR"

    # Run Prisma Studio locally with direct connection to localhost
    # (Supabase exposes PostgreSQL on localhost:5432)
    log_info "Connecting to Supabase PostgreSQL on localhost:5432..."
    DATABASE_URL="postgresql://postgres:j1sMYPQxTQZ7QLlFd6wpNbV30Y5P47fo@localhost:5432/postgres" \
        npx prisma studio
}

# =============================================================================
# Show status
# =============================================================================
status() {
    print_banner

    echo -e "${BLUE}=== Supabase Containers ===${NC}"
    docker ps --filter "name=supabase" --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}" 2>/dev/null || echo "No Supabase containers"
    echo ""

    echo -e "${BLUE}=== TubeArchive Containers ===${NC}"
    docker ps --filter "name=tubearchive" --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}" 2>/dev/null || echo "No TubeArchive containers"
    echo ""

    echo -e "${BLUE}=== Network Status ===${NC}"
    if docker network ls --format '{{.Name}}' | grep -q 'supabase-dev_supabase-dev'; then
        echo -e "${GREEN}✅ Supabase network: supabase-dev_supabase-dev${NC}"
    else
        echo -e "${RED}❌ Supabase network not found${NC}"
    fi

    if docker network ls --format '{{.Name}}' | grep -q 'tubearchive-local'; then
        echo -e "${GREEN}✅ TubeArchive network: tubearchive-local${NC}"
    else
        echo -e "${YELLOW}⚠️  TubeArchive network not created (start containers first)${NC}"
    fi
}

# =============================================================================
# Build containers without starting
# =============================================================================
build() {
    print_banner
    log_step "Building TubeArchive containers..."
    cd "$PROJECT_DIR"
    docker compose -f "$COMPOSE_FILE" build "$@"
    log_info "✅ Build complete"
}

# =============================================================================
# Execute command in API container
# =============================================================================
exec_api() {
    cd "$PROJECT_DIR"
    docker compose -f "$COMPOSE_FILE" exec api "$@"
}

# =============================================================================
# Run CLI command
# =============================================================================
cli() {
    cd "$PROJECT_DIR"
    docker compose -f "$COMPOSE_FILE" exec api node dist/cli/index.js "$@"
}

# =============================================================================
# Show help
# =============================================================================
usage() {
    print_banner
    echo "Usage: $0 <command> [options]"
    echo ""
    echo "Commands:"
    echo "  start       Start TubeArchive with local Supabase"
    echo "  stop        Stop TubeArchive containers"
    echo "  restart     Restart TubeArchive containers"
    echo "  logs [svc]  View container logs (optional: api|frontend)"
    echo "  migrate     Push database schema to Supabase"
    echo "  studio      Open Prisma Studio (database GUI)"
    echo "  status      Show container and network status"
    echo "  build       Build containers without starting"
    echo "  exec <cmd>  Execute command in API container"
    echo "  cli <args>  Run CLI command in API container"
    echo ""
    echo "Examples:"
    echo "  $0 start              # Start all services"
    echo "  $0 logs api           # View API logs only"
    echo "  $0 migrate            # Push Prisma schema to DB"
    echo "  $0 cli sync list      # Run CLI sync list command"
    echo ""
    echo "Environment:"
    echo "  SUPABASE_DIR    Path to Supabase project (default: ~/cursor/superbase)"
    echo ""
}

# =============================================================================
# Main
# =============================================================================
case "${1:-}" in
    start)      start ;;
    stop)       stop ;;
    restart)    restart ;;
    logs)       shift; logs "$@" ;;
    migrate)    migrate ;;
    studio)     studio ;;
    status)     status ;;
    build)      shift; build "$@" ;;
    exec)       shift; exec_api "$@" ;;
    cli)        shift; cli "$@" ;;
    -h|--help)  usage ;;
    *)          usage ;;
esac
