#!/bin/bash

# Get the folder this script lives in
DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$DIR"

# Install dependencies if not already installed
if [ ! -d "node_modules" ]; then
  echo "📦 Installing dependencies (first time only)..."
  npm install
fi

# Kill any old instance on port 3876
lsof -ti:3876 | xargs kill -9 2>/dev/null

# Start the server in background
node server.js &
SERVER_PID=$!

# Wait for server to be ready
echo "⏳ Starting server..."
sleep 2

# Open the app in browser
open http://localhost:3876

echo ""
echo "✅ ShipmentScope is running!"
echo "   Close this window to stop the server."
echo ""

# Keep running until window is closed
wait $SERVER_PID
