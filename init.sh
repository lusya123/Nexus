#!/bin/bash
# Nexus - Agent Arena Monitor init script
# Run this to install dependencies and start the dev server

set -e

echo "=== Nexus Init ==="

# Install dependencies
if [ ! -d "node_modules" ]; then
  echo "Installing dependencies..."
  npm install
fi

# Start server
echo "Starting Nexus server on http://localhost:3000"
node server.js
