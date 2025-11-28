#!/bin/bash

# Development restart script
# Stops existing processes and restarts server and client
# This script is called automatically after code changes

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

echo "🔄 Restarting DWI-BS for testing..."

# Stop existing processes
"$SCRIPT_DIR/stop.sh"

# Wait a moment
sleep 1

# Start server in background
echo "🚀 Starting server..."
cd "$PROJECT_ROOT/server"
npm start > "$PROJECT_ROOT/logs/server.log" 2>&1 &
SERVER_PID=$!
echo $SERVER_PID > "$PROJECT_ROOT/logs/server.pid"

# Wait for server to initialize
sleep 2

# Start client in background
echo "🚀 Starting client..."
cd "$PROJECT_ROOT/client"
npm run dev > "$PROJECT_ROOT/logs/client.log" 2>&1 &
CLIENT_PID=$!
echo $CLIENT_PID > "$PROJECT_ROOT/logs/client.pid"

# Create logs directory
mkdir -p "$PROJECT_ROOT/logs"

echo ""
echo "✅ Restart complete!"
echo "📊 Server: http://localhost:3000 (PID: $SERVER_PID)"
echo "🎮 Client: http://localhost:5173 (PID: $CLIENT_PID)"
echo ""
echo "💡 You can now test the game in your browser"
echo "📝 Logs available in: logs/"


