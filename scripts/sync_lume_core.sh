#!/usr/bin/env bash
# sync_lume_core.sh —— 把 ../lume-core/lib 同步进本项目的 .runtime/，并校验
#
# ══ 为什么需要这个脚本 ════════════════════════════════════════════════════
# Docker 不允许 COPY ../（构建上下文之外），而 lume 应用源码里写的是
#
#     import "../lume-core/lib/peer.lume" as peer;
#
# 从容器 WORKDIR=/app 解析出来就是 /lume-core/lib/peer.lume。所以构建前必须
# 先把宿主的 lume-core/lib 复制到构建上下文里（.runtime/），再由 Dockerfile
# COPY 进镜像根目录。
#
# ══ 它解决的真实问题 ══════════════════════════════════════════════════════
# 之前每个项目各自写了一遍这个复制逻辑（或手工 copy 一次），**没有校验**。
# 结果：lume-core 更新后，某些项目的 .runtime 还是旧的，而一切看起来正常 ——
# 直到某个新函数缺失才炸，报错还指向别处。这次就是这样暴露的：
#
#     lume: line 42: module 'peer' has no export 'config_warnings'
#
# 那句话说的是"peer 模块没有这个函数"，看起来像写错了调用，实际是镜像里
# 放着一份 13KB 的旧 peer.lume（宿主已经 17KB）。
#
# 所以这里做两件事：复制 + **逐文件 sha256 对比**。不一致就报错退出，
# 而不是让旧副本静默进镜像。
#
# ══ 用法 ══════════════════════════════════════════════════════════════════
#   bash scripts/sync_lume_core.sh          # 同步并校验
#   bash scripts/sync_lume_core.sh --check  # 只校验, 不写（CI / 预检用）
#
# 从项目根目录执行（Makefile 里就是这么调的）。
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SRC="$ROOT/../lume-core/lib"
DST="$ROOT/.runtime/lume-core/lib"
CHECK_ONLY=0
[ "${1:-}" = "--check" ] && CHECK_ONLY=1

if [ ! -d "$SRC" ]; then
  echo "✗ 找不到 $SRC" >&2
  echo "  三个 lume 项目（a2a / lan / scanner）都依赖同级的 lume-core/" >&2
  exit 1
fi

# ── 只校验 ────────────────────────────────────────────────────────────
if [ "$CHECK_ONLY" = "1" ]; then
  if [ ! -d "$DST" ]; then
    echo "✗ .runtime/lume-core/lib 不存在（先跑: make sync-core）" >&2
    exit 1
  fi
  bad=0
  for f in "$SRC"/*.lume; do
    n=$(basename "$f")
    if [ ! -f "$DST/$n" ]; then
      echo "✗ 缺文件: $n" >&2; bad=1; continue
    fi
    a=$(shasum -a 256 "$f" | awk '{print $1}')
    b=$(shasum -a 256 "$DST/$n" | awk '{print $1}')
    if [ "$a" != "$b" ]; then
      echo "✗ 内容不一致: $n ($(wc -c < "$f" | tr -d ' ') vs $(wc -c < "$DST/$n" | tr -d ' ') 字节)" >&2
      bad=1
    fi
  done
  # 反向：.runtime 里有但宿主没有的（通常是宿主删过的旧模块）
  for f in "$DST"/*.lume; do
    [ -e "$f" ] || continue
    n=$(basename "$f")
    if [ ! -f "$SRC/$n" ]; then
      echo "✗ 多余文件（宿主已无）: $n" >&2; bad=1
    fi
  done
  if [ "$bad" != "0" ]; then
    echo "✗ lume-core 副本与宿主不一致，跑 make sync-core 修复" >&2
    exit 1
  fi
  echo "✓ lume-core 副本与宿主一致（$(ls -1 "$SRC"/*.lume | wc -l | tr -d ' ') 个模块）"
  exit 0
fi

# ── 同步 ──────────────────────────────────────────────────────────────
mkdir -p "$DST"
# 先清空：宿主删掉的模块不该留在镜像里（旧模块可能 import 已废弃的东西）
find "$DST" -maxdepth 1 -name '*.lume' -delete 2>/dev/null || true
cp "$SRC"/*.lume "$DST"/

echo "▶ 已同步 lume-core/lib → .runtime/lume-core/lib"
# 同步完立刻自检：复制本身出错（权限、磁盘）也要抓出来，不能等到构建
exec bash "${BASH_SOURCE[0]}" --check
