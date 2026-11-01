#!/usr/bin/env python3
"""sse_pretty.py — 把 /react/api/chat 的 SSE 流打成人类可读的样子

只做显示，不产生任何业务逻辑：问答本身由 lume 框架驱动。
留这个脚本的原因是调试时要看"它第几轮调了什么"，而 curl 原样输出
是一堆 data: {...}，工具调用那两行很容易被答案的 token 流淹掉。

用法:
    curl -sN -X POST localhost:10190/react/api/chat \
      -H 'Content-Type: application/json' -d '{"message":"..."}' \
      | python3 scripts/sse_pretty.py
"""
import json
import sys


def main() -> int:
    for line in sys.stdin:
        line = line.strip()
        if not line.startswith("data:"):
            continue
        try:
            ev = json.loads(line[5:].strip())
        except ValueError:
            continue
        t = ev.get("t")
        if t == "note":
            # 工具调用与轮次：这是"它在干什么"的唯一可见信号
            print(f"\n· {ev.get('d', '')}", flush=True)
        elif t == "delta":
            print(ev.get("d", ""), end="", flush=True)
        elif t == "error":
            print(f"\n✘ {ev.get('d', '')}", flush=True)
        elif t == "done":
            print()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
