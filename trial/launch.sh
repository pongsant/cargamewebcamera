#!/bin/bash
cd "$(dirname "$0")"

echo "======================================="
echo "  Race Control - Starting..."
echo "======================================="

# Check Python
if ! command -v python3 &>/dev/null; then
    echo "ERROR: Python 3 is not installed."
    echo "Install it from https://python.org or via your package manager."
    read -p "Press Enter to exit."
    exit 1
fi

# Install dependencies
echo "Checking dependencies..."
python3 -m pip install -r requirements.txt --quiet 2>/dev/null

# Start server in background
echo "Starting backend server..."
python3 camera_test.py &
SERVER_PID=$!

# Wait for server to be ready
sleep 2

# Open browser (works on macOS and most Linux desktops)
echo "Opening browser..."
if command -v open &>/dev/null; then
    open http://localhost:8000          # macOS
elif command -v xdg-open &>/dev/null; then
    xdg-open http://localhost:8000     # Linux
fi

echo ""
echo "Race Control is running at http://localhost:8000"
echo "Press Ctrl+C to stop the server."
echo ""

# Wait for server process
wait $SERVER_PID
