#!/usr/bin/env python3
"""a2a_worker.py — 推进长任务(submitted → working → completed)

为什么必须有这个进程
-------------------
lume 没有 spawn/exec, http_* 也是「收完整个响应才返回」的同步调用。所以
「立刻返回任务号、后台慢慢跑」在纯 lume 里做不到 —— 这不是偷懒, 是语言边界。

职责划分:
    node.lume / src/a2a.lume   登记任务、回答 tasks/get、处理 tasks/cancel
    本脚本                      扫到 submitted 的任务, 置 working, 干活, 置 completed

为什么任务状态要落盘而不是存内存: workers=2 时内存是两份, 重启即丢。
重启后任务挂在 submitted 是最容易被当成 bug 的现象。

用法
----
    python3 scripts/a2a_worker.py --dir .data --once    # 跑一轮(调试/CI)
    python3 scripts/a2a_worker.py --dir .data --loop    # 常驻(每 2s 一轮)

取消语义
--------
tasks/cancel 会把状态改成 canceled。本脚本每轮重新读任务, 发现已被取消
就不再推进 —— 而不是"先把活干完再发现被取消了"。后者在长任务上等于
取消无效。
"""
from __future__ import annotations

import json
import os
import sys
import time

POLL_SECS = 2


def task_files(task_dir: str) -> list[str]:
    """递归列出 task_dir 下所有任务 JSON。

    层级是 <挂载根>/a2a-tasks/<节点名>/<id>.json —— 而且挂载根本身
    每节点一个(data/node-a, data/node-b), 所以实际还要再深一层。
    写死层数的话, 换个挂载方式就静默扫到 0 个任务(实测踩过: worker
    日志只有"推进 0 个", 看不出是路径问题)。递归扫描不依赖层级假设。
    """
    out = []
    if not os.path.isdir(task_dir):
        return out
    for root, _dirs, files in os.walk(task_dir):
        for name in files:
            if name.endswith(".json") and not name.startswith("."):
                out.append(os.path.join(root, name))
    return sorted(out)


def load(path: str) -> dict | None:
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        # 读侧容忍半截 JSON(写入不是原子 rename), 下一轮再读
        return None


def save(path: str, task: dict) -> None:
    """写回任务。先写临时文件再 os.replace, 避免读侧读到半截。"""
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(task, f, ensure_ascii=False)
    os.replace(tmp, path)


def trace_add(task: dict, note: str, node: str = "worker") -> None:
    md = task.setdefault("metadata", {})
    md.setdefault("trace", []).append(
        {"node": node, "at": int(time.time()), "note": note,
         "hops": md.get("hops", 0), "cap": md.get("capability", "")}
    )


def artifact(text: str) -> dict:
    return {"artifactId": f"art-{int(time.time()*1000)}",
            "parts": [{"kind": "text", "text": text}]}


def run_batch(items: list, secs: int) -> str:
    """模拟批量处理。真实场景里这里会是调模型/跑脚本。"""
    done = []
    per = max(1, secs // max(1, len(items))) if secs > 0 else 0
    for it in items:
        if per:
            time.sleep(per)
        done.append(str(it))
    return json.dumps({"processed": done, "count": len(done)},
                      ensure_ascii=False)


def step(path: str) -> str:
    """推进一个任务一步。返回做了什么(给日志用)。"""
    task = load(path)
    if task is None:
        return "skip-corrupt"
    state = (task.get("status") or {}).get("state", "")

    # 已终结: 什么都不做。包括 canceled —— 取消必须真的生效。
    if state in ("completed", "failed", "canceled", "rejected", "input-required"):
        return ""

    md = task.get("metadata") or {}
    cap = md.get("capability", "")
    if cap != "batch.process":
        return ""  # 只推进长任务

    payload = md.get("payload") or md.get("job") or {}
    items = payload.get("items") or []
    secs = int(payload.get("secs", 0) or 0)

    if state == "submitted":
        task.setdefault("status", {})["state"] = "working"
        task["status"]["timestamp"] = str(int(time.time()))
        task["updated"] = int(time.time())
        trace_add(task, f"worker 接手, {len(items)} 个条目")
        save(path, task)
        return "submitted->working"

    if state == "working":
        # 再读一次: 干活期间可能被取消(取消要真的生效)
        fresh = load(path)
        if fresh and (fresh.get("status") or {}).get("state") == "canceled":
            return "canceled-during-work"
        body = run_batch(items, secs)
        task.setdefault("status", {})["state"] = "completed"
        task["status"]["timestamp"] = str(int(time.time()))
        task["artifacts"] = [artifact(body)]
        task["updated"] = int(time.time())
        trace_add(task, f"处理完成 {len(items)} 个条目")
        save(path, task)
        return "working->completed"
    return ""


def main() -> int:
    args = sys.argv[1:]
    task_dir = ".data"
    once = False
    loop = False
    for i, a in enumerate(args):
        if a == "--dir" and i + 1 < len(args):
            task_dir = args[i + 1]
        elif a == "--once":
            once = True
        elif a == "--loop":
            loop = True
    if not once and not loop:
        once = True

    while True:
        n = 0
        for p in task_files(task_dir):
            what = step(p)
            if what:
                n += 1
                print(f"[worker] {os.path.basename(p)}: {what}", flush=True)
        if once:
            print(f"[worker] 一轮结束, 推进 {n} 个", flush=True)
            return 0
        time.sleep(POLL_SECS)


if __name__ == "__main__":
    sys.exit(main())
