#!/bin/zsh
set -e
cd "$(dirname "$0")"
.venv/bin/python scripts/prepare_https.py
print '手机摄像头：先在手机安装并信任上方的本地 CA 证书，再打开 HTTPS 地址。详见 README.txt。'
exec .venv/bin/python -m uvicorn backend.server:app --host 0.0.0.0 --port 8611 --ssl-keyfile data/tls/server.key --ssl-certfile data/tls/server.crt
