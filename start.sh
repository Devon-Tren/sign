#!/usr/bin/env bash
# One-command local macOS/Linux development launcher.
set -euo pipefail
cd "$(dirname "$0")"
command -v node >/dev/null || { echo 'Node.js 20+ is required: https://nodejs.org'; exit 1; }
command -v npm >/dev/null || { echo 'npm is required.'; exit 1; }
command -v python3 >/dev/null || { echo 'Python 3.11+ is required.'; exit 1; }
if [ ! -d backend/.venv ]; then
  echo 'Creating backend virtual environment...'
  python3 -m venv backend/.venv
fi
source backend/.venv/bin/activate
if ! python -c 'import fastapi, websockets, dotenv; from openai import AsyncOpenAI' >/dev/null 2>&1; then
  echo 'Installing Python dependencies...'
  python -m pip install -r backend/requirements.txt
fi
if [ ! -f backend/.env ]; then cp backend/.env.example backend/.env; fi
if [ ! -d frontend/node_modules ]; then
  echo 'Installing web dependencies (internet required)...'
  (cd frontend && npm install)
fi
cleanup(){ if [ -n "${BACKEND_PID:-}" ]; then kill "$BACKEND_PID" 2>/dev/null || true; fi; }
trap cleanup EXIT INT TERM
(cd backend && python -m uvicorn main:app --host 127.0.0.1 --port 8000) &
BACKEND_PID=$!
echo ''
echo 'Sign will be at http://localhost:5173'
echo 'Set OPENAI_API_KEY in backend/.env and restart to enable the microphone.'
echo 'Ctrl+C stops both servers.'
(cd frontend && npm run dev)
