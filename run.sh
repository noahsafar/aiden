#!/bin/bash
echo "Starting Aiden Email Automation..."
echo "================================"
echo ""

# Check if required files exist
if [ ! -f "gmail_credentials.json" ]; then
    echo "⚠️  Warning: gmail_credentials.json not found!"
    echo "   Please place your Gmail API credentials in gmail_credentials.json"
    echo ""
fi

# Start frontend
echo "🚀 Starting frontend (Vite dev server)..."
npm run dev &
FRONTEND_PID=$!

# Wait a moment for frontend to start
sleep 2

# Start backend
echo "🚀 Starting backend (Tauri)..."
npm run tauri dev &
BACKEND_PID=$!

# Wait a moment for backend to start
sleep 2

# Start OAuth server
echo "🚀 Starting OAuth server..."
python3 oauth_server.py &
OAUTH_PID=$!

echo ""
echo "✅ All services started!"
echo "================================"
echo "Frontend:        http://localhost:1420"
echo "Desktop App:     Opening automatically..."
echo "OAuth Server:    http://localhost:8081"
echo ""
echo "Press Ctrl+C to stop all services"
echo ""

# Function to cleanup on exit
cleanup() {
    echo ""
    echo "Stopping all services..."
    kill $FRONTEND_PID $BACKEND_PID $OAUTH_PID 2>/dev/null
    echo "Done. Goodbye!"
    exit 0
}

# Set up trap for Ctrl+C
trap cleanup INT

# Wait for all background processes
wait