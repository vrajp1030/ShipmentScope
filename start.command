#!/bin/bash
# Double-click this file to start PokéOrders
cd "$(dirname "$0")"

# Install dependencies if needed
if [ ! -d "node_modules" ]; then
  echo "Installing dependencies (first run only)..."
  npm install
fi

echo ""
echo "  Starting PokéOrders sync server..."
echo "  Opening app in browser..."
echo ""

# Start server in background
node server.js &
SERVER_PID=$!

# Wait a moment then open browser
sleep 1.5
open "http://localhost:3876"

echo "  PokéOrders is running! Close this window to stop the server."
echo ""

# Wait for server
wait $SERVER_PID
