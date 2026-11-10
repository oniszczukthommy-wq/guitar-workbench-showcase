#!/bin/zsh
set -e
cd "$(dirname "$0")"
if [ ! -x .venv/bin/python ]; then
  print '缺少运行环境，请先完成 README.txt 中的安装步骤。'
  read '?按回车关闭'
  exit 1
fi
if /usr/bin/curl -fsS http://localhost:8610/api/health >/dev/null 2>&1; then
  /usr/bin/open http://localhost:8610/
  exit 0
fi
.venv/bin/python -m uvicorn backend.server:app --host 0.0.0.0 --port 8610 &
guitar_server_pid=$!
trap 'kill "$guitar_server_pid" 2>/dev/null || true' EXIT INT TERM
for guitar_attempt in {1..50}; do
  if /usr/bin/curl -fsS http://localhost:8610/api/health >/dev/null 2>&1; then
    /usr/bin/open http://localhost:8610/
    wait "$guitar_server_pid"
    exit $?
  fi
  sleep 0.2
done
print '服务启动失败，请查看上面的错误。'
wait "$guitar_server_pid"
