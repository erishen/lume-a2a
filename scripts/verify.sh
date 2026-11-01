#!/usr/bin/env bash
# verify.sh — 起两个节点, 把三条链路各跑一遍, 然后关掉。
#
# 为什么要有这个脚本: 演示项目的价值在于"能跑通", 而能跑通这件事最容易
# 在改了一行之后悄悄失效。所以把验收做成可重复执行的一条命令, 而不是
# 写在 README 里让人手动点。
#
# 用法:
#   ./scripts/verify.sh           # 默认端口 18190/18191
#   ./scripts/verify.sh 18190 18191
#
# 退出码: 0 全通过; 1 有断言失败; 2 环境问题(二进制/端口)。
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$HERE"

PORT_A="${1:-18190}"
PORT_B="${2:-18191}"
SHARED="verify-secret"
LUME="${LUME:-../lume/bin/lume}"
LOG_A="$(mktemp -t a2a-a)"
LOG_B="$(mktemp -t a2a-b)"
PIDS=()

if [ ! -x "$LUME" ] && [ ! -f "$LUME" ]; then
  echo "找不到 lume 二进制: $LUME" >&2
  exit 2
fi

cleanup() {
  for p in "${PIDS[@]:-}"; do
    [ -n "$p" ] && kill "$p" 2>/dev/null
  done
}
trap cleanup EXIT

wait_up() {
  local port="$1" i=0
  while [ $i -lt 50 ]; do
    if curl -sf -m 1 "http://127.0.0.1:$port/api/state" >/dev/null 2>&1; then
      return 0
    fi
    sleep 0.2
    i=$((i + 1))
  done
  return 1
}

echo "▶ 启动 node-a:$PORT_A / node-b:$PORT_B"
PEER_SHARED="$SHARED" PEER_NAME=node-a PEER_PORT="$PORT_A" "$LUME" node.lume >"$LOG_A" 2>&1 &
PIDS+=($!)
PEER_SHARED="$SHARED" PEER_NAME=node-b PEER_PORT="$PORT_B" "$LUME" node.lume >"$LOG_B" 2>&1 &
PIDS+=($!)

if ! wait_up "$PORT_A" || ! wait_up "$PORT_B"; then
  echo "节点没起来。node-a 日志:" >&2
  tail -20 "$LOG_A" >&2
  echo "node-b 日志:" >&2
  tail -20 "$LOG_B" >&2
  exit 2
fi

PEER_NAME=node-a PEER_SHARED="$SHARED" "$LUME" "$HERE/scripts/probe.lume" "$PORT_A" "$PORT_B" "$SHARED"
rc=$?

if [ $rc -ne 0 ]; then
  echo "--- node-a 日志尾部 ---"
  tail -15 "$LOG_A"
fi
exit $rc
