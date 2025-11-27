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

# Check for client changes (including version.js)
if echo "$ALL_CHANGED" | grep -qE "(^client/|^shared/|client/src/version\.js)"; then
    NEED_CLIENT_RESTART=true
fi

# Also check if VERSION file changed (affects both)
if echo "$ALL_CHANGED" | grep -qE "^VERSION"; then
    NEED_SERVER_RESTART=true
    NEED_CLIENT_RESTART=true
fi

# Check if processes are running
SERVER_RUNNING=$(lsof -ti:3000 > /dev/null 2>&1 && echo "true" || echo "false")
CLIENT_RUNNING=$(lsof -ti:5173 > /dev/null 2>&1 && echo "true" || echo "false")

# If no specific changes detected, check what's running and what's not
if [ "$NEED_SERVER_RESTART" = false ] && [ "$NEED_CLIENT_RESTART" = false ]; then
    # If nothing changed but something is not running, start what's missing
    if [ "$SERVER_RUNNING" = "false" ] && [ "$CLIENT_RUNNING" = "false" ]; then
        # Both are down, start both
        NEED_SERVER_RESTART=true
        NEED_CLIENT_RESTART=true
    elif [ "$SERVER_RUNNING" = "false" ]; then
        # Server is down but client is running - start server (needed for game to work)
        NEED_SERVER_RESTART=true
    elif [ "$CLIENT_RUNNING" = "false" ]; then
        # Client is down but server is running - start client
        NEED_CLIENT_RESTART=true
    fi
else
    # We have specific changes, but also ensure dependencies are running
    # If server needs restart but client is not running, start client too
    if [ "$NEED_SERVER_RESTART" = true ] && [ "$CLIENT_RUNNING" = "false" ]; then
        NEED_CLIENT_RESTART=true
    fi
    # If client needs restart but server is not running, start server too
    if [ "$NEED_CLIENT_RESTART" = true ] && [ "$SERVER_RUNNING" = "false" ]; then
        NEED_SERVER_RESTART=true
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

