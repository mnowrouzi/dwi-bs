#!/bin/bash

# Restart script for DWI-BS game
# Kills existing processes and starts server and client

echo "🔄 Restarting DWI-BS..."

# Kill existing Node processes on ports 3000 and 5173
echo "⏹️  Stopping existing processes..."
lsof -ti:3000 | xargs kill -9 2>/dev/null || true
lsof -ti:5173 | xargs kill -9 2>/dev/null || true

# Wait a moment
sleep 1

# Start server
echo "🚀 Starting server on port 3000..."
cd "$(dirname "$0")/../server"
npm start > ../logs/server.log 2>&1 &
SERVER_PID=$!
echo "   Server PID: $SERVER_PID"

# Wait for server to start
sleep 2

# Start client
echo "🚀 Starting client on port 5173..."
cd "$(dirname "$0")/../client"
npm run dev > ../logs/client.log 2>&1 &
CLIENT_PID=$!
echo "   Client PID: $CLIENT_PID"

# Create logs directory if it doesn't exist
mkdir -p "$(dirname "$0")/../logs"

echo ""
echo "✅ Restart complete!"
echo "📊 Server: http://localhost:3000 (PID: $SERVER_PID)"
echo "🎮 Client: http://localhost:5173 (PID: $CLIENT_PID)"
echo ""
echo "📝 Logs:"
echo "   Server: logs/server.log"
echo "   Client: logs/client.log"
echo ""
echo "To stop: kill $SERVER_PID $CLIENT_PID"

