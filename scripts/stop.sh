#!/bin/bash

# Stop script for DWI-BS game
# Kills all Node processes on ports 3000 and 5173

echo "⏹️  Stopping DWI-BS..."

# Kill processes on ports
lsof -ti:3000 | xargs kill -9 2>/dev/null && echo "✅ Server stopped (port 3000)" || echo "ℹ️  No server running on port 3000"
lsof -ti:5173 | xargs kill -9 2>/dev/null && echo "✅ Client stopped (port 5173)" || echo "ℹ️  No client running on port 5173"

echo "✅ All processes stopped"

