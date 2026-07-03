#!/bin/zsh

set -e

cd "$(dirname "$0")"

START_PORT=4173

is_adsflow_server() {
  curl -fsS "$1" 2>/dev/null | grep -q "AdsFlow Studio"
}

if ! command -v npm >/dev/null 2>&1; then
  osascript -e 'display alert "Không tìm thấy Node.js/npm" message "Hãy cài Node.js rồi mở lại ứng dụng." as critical'
  exit 1
fi

if [ ! -d node_modules ]; then
  npm install
fi

PORT=$START_PORT
while lsof -nP -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; do
  URL="http://localhost:$PORT"
  if is_adsflow_server "$URL"; then
    open "$URL"
    exit 0
  fi
  PORT=$((PORT + 1))
done

URL="http://localhost:$PORT"
npm run dev -- --port "$PORT" --strictPort > /tmp/meta-ads-app.log 2>&1 &
SERVER_PID=$!

for _ in {1..40}; do
  if is_adsflow_server "$URL"; then
    open "$URL"
    exit 0
  fi

  if ! kill -0 "$SERVER_PID" >/dev/null 2>&1; then
    osascript -e 'display alert "Không thể mở Meta Ads App" message "Xem lỗi tại /tmp/meta-ads-app.log" as critical'
    exit 1
  fi

  sleep 0.25
done

osascript -e 'display alert "Không thể mở Meta Ads App" message "Xem lỗi tại /tmp/meta-ads-app.log" as critical'
exit 1
