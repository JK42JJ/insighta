#!/bin/bash
# =============================================================================
# TubeArchive - Development Environment Startup Script
# =============================================================================
# Starts both API server and frontend development server concurrently.
# =============================================================================

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}========================================${NC}"
echo -e "${BLUE}  TubeArchive Development Environment  ${NC}"
echo -e "${BLUE}========================================${NC}"
echo ""

# Navigate to project root
cd "$(dirname "$0")/.."
PROJECT_ROOT=$(pwd)

# Check if node_modules exist
if [ ! -d "node_modules" ]; then
    echo -e "${YELLOW}Installing backend dependencies...${NC}"
    npm install
fi

if [ ! -d "frontend/node_modules" ]; then
    echo -e "${YELLOW}Installing frontend dependencies...${NC}"
    cd frontend && npm install && cd ..
fi

# Check for .env file
if [ ! -f ".env" ]; then
    echo -e "${RED}Warning: .env file not found. Copying from .env.example...${NC}"
    if [ -f ".env.example" ]; then
        cp .env.example .env
        echo -e "${YELLOW}Please update .env with your configuration.${NC}"
    fi
fi

# Generate Prisma client if needed
if [ ! -d "node_modules/.prisma" ]; then
    echo -e "${YELLOW}Generating Prisma client...${NC}"
    npx prisma generate
fi

echo ""
echo -e "${GREEN}Starting development servers...${NC}"
echo -e "${BLUE}  API Server:  ${NC}http://localhost:3000"
echo -e "${BLUE}  Frontend:    ${NC}http://localhost:8080"
echo -e "${BLUE}  API Docs:    ${NC}http://localhost:3000/api/docs"
echo ""

# Start services concurrently
npx concurrently \
    --names "API,FRONTEND" \
    --prefix-colors "blue,green" \
    --prefix "[{name}]" \
    --kill-others-on-fail \
    "npm run api:dev" \
    "cd frontend && npm run dev"
