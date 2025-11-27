#!/bin/bash

# Smart restart script
# Restarts only what's needed based on changed files

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

# Colors
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

# Check what files have changed (staged or unstaged)
CHANGED_FILES=$(git diff --name-only HEAD 2>/dev/null || echo "")
STAGED_FILES=$(git diff --cached --name-only 2>/dev/null || echo "")
ALL_CHANGED="$CHANGED_FILES $STAGED_FILES"

# Determine what needs restart
NEED_SERVER_RESTART=false
NEED_CLIENT_RESTART=false

# Check for server changes
if echo "$ALL_CHANGED" | grep -qE "(^server/|^shared/|^VERSION|^scripts/|^package\.json)"; then
    NEED_SERVER_RESTART=true
fi

# Check for client changes
if echo "$ALL_CHANGED" | grep -qE "(^client/|^shared/)"; then
    NEED_CLIENT_RESTART=true
fi

# If no specific changes detected, check if processes are running
if [ "$NEED_SERVER_RESTART" = false ] && [ "$NEED_CLIENT_RESTART" = false ]; then
    # Check what's currently running
    if lsof -ti:3000 > /dev/null 2>&1; then
        NEED_SERVER_RESTART=true
    fi
    if lsof -ti:5173 > /dev/null 2>&1; then
        NEED_CLIENT_RESTART=true
    fi
    
    # If nothing is running, start both
    if [ "$NEED_SERVER_RESTART" = false ] && [ "$NEED_CLIENT_RESTART" = false ]; then
        NEED_SERVER_RESTART=true
        NEED_CLIENT_RESTART=true
    fi
fi

echo -e "${BLUE}🔄 Smart Restart Analysis...${NC}"

if [ "$NEED_SERVER_RESTART" = true ]; then
    echo -e "${YELLOW}📊 Server restart needed${NC}"
fi

if [ "$NEED_CLIENT_RESTART" = true ]; then
    echo -e "${YELLOW}🎮 Client restart needed${NC}"
fi

# Stop what needs to be restarted
if [ "$NEED_SERVER_RESTART" = true ]; then
    echo -e "\n${YELLOW}⏹️  Stopping server...${NC}"
    lsof -ti:3000 | xargs kill -9 2>/dev/null && echo -e "${GREEN}✅ Server stopped${NC}" || echo -e "${YELLOW}ℹ️  Server was not running${NC}"
fi

if [ "$NEED_CLIENT_RESTART" = true ]; then
    echo -e "\n${YELLOW}⏹️  Stopping client...${NC}"
    lsof -ti:5173 | xargs kill -9 2>/dev/null && echo -e "${GREEN}✅ Client stopped${NC}" || echo -e "${YELLOW}ℹ️  Client was not running${NC}"
fi

# Wait a moment
sleep 1

# Start what needs to be started
if [ "$NEED_SERVER_RESTART" = true ]; then
    echo -e "\n${YELLOW}🚀 Starting server...${NC}"
    cd "$PROJECT_ROOT/server"
    npm start > "$PROJECT_ROOT/logs/server.log" 2>&1 &
    SERVER_PID=$!
    echo $SERVER_PID > "$PROJECT_ROOT/logs/server.pid"
    echo -e "${GREEN}✅ Server started (PID: $SERVER_PID)${NC}"
    sleep 2
fi

if [ "$NEED_CLIENT_RESTART" = true ]; then
    echo -e "\n${YELLOW}🚀 Starting client...${NC}"
    cd "$PROJECT_ROOT/client"
    npm run dev > "$PROJECT_ROOT/logs/client.log" 2>&1 &
    CLIENT_PID=$!
    echo $CLIENT_PID > "$PROJECT_ROOT/logs/client.pid"
    echo -e "${GREEN}✅ Client started (PID: $CLIENT_PID)${NC}"
fi

# Create logs directory
mkdir -p "$PROJECT_ROOT/logs"

echo -e "\n${GREEN}✅ Smart restart complete!${NC}"
if [ "$NEED_SERVER_RESTART" = true ]; then
    echo -e "${BLUE}📊 Server: http://localhost:3000${NC}"
fi
if [ "$NEED_CLIENT_RESTART" = true ]; then
    echo -e "${BLUE}🎮 Client: http://localhost:5173${NC}"
fi

