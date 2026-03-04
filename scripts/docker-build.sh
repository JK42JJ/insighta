#!/bin/bash
# =============================================================================
# TubeArchive - Docker Build Script
# =============================================================================
# Builds all Docker images for the TubeArchive platform.
# =============================================================================

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}========================================${NC}"
echo -e "${BLUE}  TubeArchive Docker Build            ${NC}"
echo -e "${BLUE}========================================${NC}"
echo ""

# Navigate to project root
cd "$(dirname "$0")/.."
PROJECT_ROOT=$(pwd)

# Parse arguments
BUILD_API=true
BUILD_FRONTEND=true
NO_CACHE=""

while [[ $# -gt 0 ]]; do
    case $1 in
        --api-only)
            BUILD_FRONTEND=false
            shift
            ;;
        --frontend-only)
            BUILD_API=false
            shift
            ;;
        --no-cache)
            NO_CACHE="--no-cache"
            shift
            ;;
        -h|--help)
            echo "Usage: $0 [OPTIONS]"
            echo ""
            echo "Options:"
            echo "  --api-only       Build only the API image"
            echo "  --frontend-only  Build only the frontend image"
            echo "  --no-cache       Build without using cache"
            echo "  -h, --help       Show this help message"
            exit 0
            ;;
        *)
            echo -e "${RED}Unknown option: $1${NC}"
            exit 1
            ;;
    esac
done

# Build API image
if [ "$BUILD_API" = true ]; then
    echo -e "${YELLOW}Building API image...${NC}"
    docker build $NO_CACHE -t tubearchive-api:latest .
    echo -e "${GREEN}✓ API image built successfully${NC}"
    echo ""
fi

# Build Frontend image
if [ "$BUILD_FRONTEND" = true ]; then
    echo -e "${YELLOW}Building Frontend image...${NC}"
    docker build $NO_CACHE -t tubearchive-frontend:latest ./frontend
    echo -e "${GREEN}✓ Frontend image built successfully${NC}"
    echo ""
fi

echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}  Build Complete!                      ${NC}"
echo -e "${GREEN}========================================${NC}"
echo ""
echo "To start the services, run:"
echo -e "  ${BLUE}docker-compose up -d${NC}"
echo ""
echo "To view logs:"
echo -e "  ${BLUE}docker-compose logs -f${NC}"
