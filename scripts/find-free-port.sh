#!/bin/bash

# Find a free port starting from the given port
find_free_port() {
    local start_port=$1
    local port=$start_port
    
    while lsof -Pi :$port -sTCP:LISTEN -t >/dev/null 2>&1; do
        port=$((port + 1))
    done
    
    echo $port
}

# Find free ports
SERVER_PORT=$(find_free_port 3000)
CLIENT_PORT=$(find_free_port 5173)

echo "SERVER_PORT=$SERVER_PORT"
echo "CLIENT_PORT=$CLIENT_PORT"

