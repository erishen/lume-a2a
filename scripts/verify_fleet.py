#!/usr/bin/env python3
"""verify_fleet.py — 验证「本节点 ⇄ 真实 peer(crm / scanner)」这条链路。

与 probe.py 的区别:
    probe.py       自造两个节点, 验证协议实现本身(重定向/多轮/取消/SSE)
    verify_fleet.py 验证**跨项目互访** —— 真实节点是否在线、签名能否被接受、
                    声明的能力能否真的执行并返回业务数据

为什么两者都要留: 协议实现正确不等于跨项目能通, 反过来也一样。前者是
"我的代码对不对", 后者是"两个独立项目能不能互相认出来"。

用法:
    python3 scripts/verify_fleet.py                     # 默认 http://127.0.0.1:10190
    python3 scripts/verify_fleet.py http://host:port
"""
from __future__ import annotations

import json
import sys
import urllib.error
import urllib.request

FAILS: list[str] = []
CHECKS: list[tuple[str, bool]] = []


def check(name: str, cond: bool, detail: str = "") -> None:
    CHECKS.append((name, cond))
    print(f"  [{'PASS' if cond else 'FAIL'}] {name}" + ("" if cond else f"  <- {detail}"))
    if not cond:
        FAILS.append(name)


def get_json(url: str, timeout: int = 25):
    req = urllib.request.Request(url, headers={"Accept": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.status, json.loads(r.read() or b"{}")
    except urllib.error.HTTPError as e:
        return e.code, {}
    except Exception as e:  # noqa: BLE001
        return 0, {"error": str(e)}


def ask_agent(base: str, question: str, timeout: int = 120):
    """调 POST /react/api/chat, 把 SSE 读成事件列表。

    单独写一个而不是复用 post_json: 那个会把整个响应读完再解析 JSON,
    而这里要的是"逐条事件"—— 断言靠的是事件种类(delta / note)和数量,
    一次性读成一个大 JSON 反而丢了这些信息。

    超时给 120s: 一次问答可能多轮, 每轮都是一次模型调用。
    """
    req = urllib.request.Request(
        f"{base}/react/api/chat",
        data=json.dumps({"message": question}).encode(),
        headers={"Content-Type": "application/json", "Accept": "text/event-stream"})
    events, raw = [], ""
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            for line in r:
                line = line.decode("utf-8", "replace").strip()
                if not line.startswith("data:"):
                    continue
                raw += line + "\n"
                try:
                    events.append(json.loads(line[5:].strip()))
                except ValueError:
                    continue
    except Exception as e:  # noqa: BLE001
        return events, f"{type(e).__name__}: {e}"
    return events, raw


def post_json(url: str, body: dict, timeout: int = 30):
    req = urllib.request.Request(
        url, data=json.dumps(body).encode(),
        headers={"Content-Type": "application/json", "Accept": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.status, json.loads(r.read() or b"{}")
    except urllib.error.HTTPError as e:
        return e.code, {}
    except Exception as e:  # noqa: BLE001
        return 0, {"error": str(e)}


def main() -> int:
    base = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:10190"

    print("1) 本节点状态")
    st, fleet = get_json(f"{base}/api/fleet")
    check("fleet 可读", st == 200, f"status={st}")
    check("签名模式是 derived(按节点派生)", fleet.get("mode") == "derived",
          f"mode={fleet.get('mode')} —— 配成 shared 的话真实节点会一律 401")
    nodes = {n["name"]: n for n in fleet.get("nodes", [])}
    check("看到 crm", "crm" in nodes, str(list(nodes)))
    check("看到 scanner", "scanner" in nodes, str(list(nodes)))

    for name in ("crm", "scanner"):
        n = nodes.get(name) or {}
        ok = bool(n.get("online"))
        check(f"{name} 在线", ok, str(n.get("error"))[:160])
        if ok:
            check(f"{name} 声明了能力", len(n.get("tools") or []) > 0,
                  str(n.get("tools"))[:120])

    print("\n1) 真实能力调用(返回的必须是业务数据, 不是占位符)")
    cases = [
        ("crm", "crm.stats", ["customer_count", "open_pipeline"]),
        ("crm", "crm.pipeline", ["stages"]),
        ("scanner", "scanner.meta", ["latest_date", "stocks"]),
        ("scanner", "scanner.signals", ["sig_counts"]),
        ("scanner", "scanner.picks", ["picks"]),
    ]
    for node, cap, keys in cases:
        if not (nodes.get(node) or {}).get("online"):
            check(f"{cap} 跳过(节点离线)", False, "节点离线, 无法验证")
            continue
        st, r = post_json(f"{base}/api/fleet/invoke", {"node": node, "capability": cap})
        ok = st == 200 and r.get("ok") is True
        res = r.get("result")
        has_keys = isinstance(res, dict) and all(k in res for k in keys)
        check(f"{cap} 调用成功", ok, str(r.get("error", r))[:160])
        check(f"{cap} 返回真实字段 {keys}", has_keys, str(res)[:160])

    print("\n2) 白名单: 未声明的能力不能执行")
    st, r = post_json(f"{base}/api/fleet/invoke", {"node": "crm", "capability": "fs.write_file"})
    check("越权能力被拒", st == 200 and r.get("ok") is False, str(r)[:160])
    check("拒绝原因可读", "未声明" in str(r.get("error", "")), str(r.get("error"))[:160])

    print("\n3) 白名单: 未知节点不能执行")
    st, r = post_json(f"{base}/api/fleet/invoke", {"node": "no-such-node", "capability": "x"})
    check("未知节点被拒", st == 200 and r.get("ok") is False, str(r)[:160])


    print("\n4) 实体对齐(USCC / 证券代码 作主键)")
    st, covr = get_json(f"{base}/api/entity/coverage", timeout=60)
    check("对齐度接口可用", st == 200 and covr.get("indexed", 0) > 0, str(covr)[:160])
    # 索引里的 USCC 必须全部通过校验位 —— 校验位是算法保证的, 不是人拍的
    check("索引 USCC 全部校验通过",
          covr.get("verified_uscc") == covr.get("indexed"),
          f"verified={covr.get('verified_uscc')} indexed={covr.get('indexed')}")
    check("缺口如实列出",
          len(covr.get("missing_in_scan") or []) ==
          (covr.get("scanned_total", 0) - covr.get("matched_in_scan", 0)),
          str(covr.get("missing_in_scan"))[:160])

    # 三种解析方式都要成立
    st, r1 = get_json(f"{base}/api/entity/resolve?uscc=91511500MA62A0WM8P")
    res1 = r1.get("result") or {}
    check("按 USCC 可解析", res1.get("status") == "matched" and res1.get("method") == "uscc",
          str(res1)[:160])
    st, r2 = get_json(f"{base}/api/entity/resolve?code=600519")
    res2 = r2.get("result") or {}
    check("裸代码能规范化并解析",
          res2.get("status") == "matched" and res2.get("code") == "sh600519", str(res2)[:160])

    # 两条必须拒绝的路径: 未登记名称 / 错误 USCC
    st, r3 = get_json(f"{base}/api/entity/resolve?name=%E4%B8%AD%E7%A7%91%E8%83%BD%E6%BA%90%E7%A7%91%E6%8A%80")
    res3 = r3.get("result") or {}
    # 未登记的名称不得被"模糊匹配"到任何实体 —— 错配代价高于漏配
    check("未登记名称不做模糊匹配", res3.get("status") == "unresolved" and not res3.get("code"),
          str(res3)[:200])
    # 校验位错误的 USCC 必须单独归为 invalid(要修数据), 不是 unresolved(要补数据)
    st, r4 = get_json(f"{base}/api/entity/resolve?uscc=91511500MA62A0WM8Q")
    res4 = r4.get("result") or {}
    check("脏 USCC 归为 invalid", res4.get("status") == "invalid", str(res4)[:200])

    print("\n5) A2A 协商: 两个 agent 谈出方案")
    st, ng = get_json(f"{base}/api/negotiate", timeout=90)
    neg = ng.get("result") or {}
    rounds = neg.get("rounds") or []
    check("协商接口可用", st == 200 and ng.get("ok") is True, str(ng)[:160])
    check("有双方发言", len({r.get("role") for r in rounds}) == 2,
          str([r.get("role") for r in rounds]))
    # 这条是协商与"一次性排序"的分界线: 必须出现过否决。
    # 没有否决 = 首轮就通过了 = 那只是一个排序, 不是协商。
    rejects = [r for r in rounds if r.get("action") == "reject"]
    check("出现过否决(不是一次性排序)", len(rejects) > 0,
          f"rounds={len(rounds)} rejects={len(rejects)}")
    if rejects:
        # 否决必须带理由码, 否则无法归类、无法统计, 也没法让对面调整
        check("否决带原因码", bool(rejects[0].get("code_reason")),
              str(rejects[0])[:160])
        # 否决必须带"要求", 只说不行没法谈
        check("否决附带可执行要求", "要求" in str(rejects[0].get("text", "")),
              str(rejects[0].get("text", ""))[:160])

    if neg.get("converged"):
        plan = neg.get("plan") or {}
        # 最终方案不该是初始最高分那个 —— 否则说明约束没起作用
        props = [r for r in rounds if r.get("action") == "propose"]
        first = props[0].get("name") if props else None
        check("最终方案未必是首轮提案(约束生效)",
              plan.get("name") != first or len(props) == 1,
              f"first={first} final={plan.get('name')}")
        check("记录了达成时的让步阶段", plan.get("agreed_stage") is not None,
              str(plan)[:160])
    else:
        # 谈崩也是合法结局, 但必须说清谈了几轮
        check("谈崩时说明原因", bool(neg.get("verdict")), str(neg.get("verdict")))


    print("\n6) LLM 协商: 两个模型真的在谈")
    st, lg = get_json(f"{base}/api/negotiate/llm", timeout=60)
    if not lg.get("ready"):
        # 快照没生成时**不算通过**: 这条验证的是 LLM 路径, 跳过就等于没验。
        check("LLM 协商快照可用(先跑 make llm-negotiate)", False,
              str(lg.get("error"))[:160])
    else:
        lres = lg.get("result") or {}
        lr = lres.get("rounds") or []
        check("LLM 协商有结果", bool(lr), str(lres)[:120])
        # 最关键的一条: 必须有否决。没有否决说明模型一次就同意了,
        # 那不是协商, 是让模型选一个 —— 和规则版没有区别。
        lrej = [r for r in lr if r.get("action") == "reject"]
        check("LLM 版出现过否决", len(lrej) > 0, f"rounds={len(lr)}")
        if lrej:
            check("LLM 否决附带可执行要求",
                  all(str(r.get("requirement", "")).strip() for r in lrej),
                  str(lrej[0])[:180])
        # 让步: 至少有一方记录了 concession
        conc = [r for r in lr if str(r.get("concession", "")).strip()]
        check("记录了让步动作", len(conc) > 0, str(conc[:1])[:180])
        # 双方角色都得出现
        check("双方都发过言", {"scanner", "crm"} <= {r.get("role") for r in lr},
              str(sorted({r.get("role") for r in lr})))
        # 模型与用量可追溯 —— LLM 结论不像规则那样稳定, 必须能查是哪个模型出的
        m = lres.get("llm") or {}
        check("记录了模型与用量", bool(m.get("model")) and int(m.get("calls", 0)) > 0, str(m))
        check("记录了生成时间", int(lres.get("generated_at", 0)) > 0, str(lres.get("generated_at")))


    print("\n7) 页面依赖的字段完整性")
    # 界面上"双方各自看到的事实"这一块, 依赖 facts 三个字段。
    # 后端少给一个, 页面上那块就是空白 —— 而空白不会报错, 只会显得"没做好"。
    if lg.get("ready"):
        f = (lg.get("result") or {}).get("facts") or {}
        check("facts.candidates 可渲染", int(f.get("candidates", 0)) > 0, str(f)[:120])
        check("facts.industries 可渲染", len(f.get("industries") or []) > 0, str(f)[:120])
        check("facts.customer_count 可渲染", int(f.get("customer_count", 0)) > 0, str(f)[:120])
        # 轮次里两种"谈判动作"要能被前端读到; 缺了页面就没有"要求/让步"两行
        has_req = any("requirement" in r for r in (lg["result"].get("rounds") or []))
        has_con = any("concession" in r for r in (lg["result"].get("rounds") or []))
        check("轮次带 requirement 字段", has_req)
        check("轮次带 concession 字段", has_con)


    print("\n8) 合规提示仍在(防被后续改动误删)")
    # 这条守的不是代码, 是**产品性质**: 一旦有人把"技术演示"提示删掉,
    # 这个项目对外看起来就是一个能推荐股票的工具。用断言钉住它。
    import pathlib
    root = pathlib.Path(__file__).resolve().parent.parent
    app_tsx = (root / "src" / "ui" / "App.tsx").read_text(encoding="utf-8")
    check("页面有常驻合规提示", "disclaimer" in app_tsx and "不构成投资建议" in app_tsx,
          "App.tsx 中未找到 disclaimer 提示")
    readme = (root / "README.md").read_text(encoding="utf-8")
    check("README 顶部声明技术演示",
          "技术演示" in readme[:800] and "不构成任何投资建议" in readme,
          "README 顶部缺少免责声明")
    # 提示词里也要有语境边界, 否则模型会自称在给客户建议
    for f in ("agent_crm.md", "agent_scanner.md"):
        t = (root / "prompts" / f).read_text(encoding="utf-8")
        check(f"提示词 {f} 含语境边界", "语境边界" in t, "缺少语境边界声明")


    print("\n9) 客户经营: 输出不得含个股")
    st, oc = get_json(f"{base}/api/outreach", timeout=90)
    check("客户经营接口可用", st == 200 and oc.get("ok") is True, str(oc)[:160])
    # 这条是整个改动的核心约束: 输出落在"行业 + 客户", 不落到个股。
    # 一旦出现证券代码, 这一页就从"客户经营工具"变回"荐股工具"。
    import re as _re
    raw_oc = json.dumps(oc, ensure_ascii=False)
    codes_oc = _re.findall(r"\b(?:sh|sz|bj)\d{6}\b", raw_oc)
    check("输出不含任何证券代码", len(codes_oc) == 0, str(codes_oc[:5]))
    # 由头里也不能出现买卖方向词
    banned = ["买入", "卖出", "推荐买", "建议持有", "该买", "值得买"]
    hits = [w for w in banned if w in raw_oc]
    check("由头不含买卖方向词", len(hits) == 0, str(hits))
    cov_oc = oc.get("coverage") or {}
    check("给出覆盖率与跳过统计", "with_contact" in cov_oc and "skipped" in cov_oc, str(cov_oc))
    # 跳过的每个都要有理由 —— 只丢数字不给原因, 读者会以为那些行业没问题
    skipped = oc.get("skipped") or []
    check("跳过的行业都说明了原因",
          all(str(x.get("reason", "")).strip() for x in skipped), str(skipped[:2]))


    print("\n10) LLM 协商质量: 必须真的取舍, 不是等对方让步")
    st, lg2 = get_json(f"{base}/api/negotiate/llm", timeout=60)
    if not lg2.get("ready"):
        check("LLM 快照可用", False, str(lg2.get("error"))[:120])
    else:
        r2 = lg2.get("result") or {}
        rounds2 = r2.get("rounds") or []
        props = [r for r in rounds2 if r.get("action") == "propose"]
        names = [p.get("name") for p in props]
        # 这条是本次修复的核心: 之前两轮提同一只票, 中间没有任何取舍,
        # 那不叫协商, 叫"等对方松口"。换过标的才说明选股侧真的调整了立场。
        check("选股侧中途换过标的", len(set(names)) > 1, str(names))
        # 让步必须双向: 只有一方让步 = 另一方在硬扛
        conc_roles = {r.get("role") for r in rounds2
                      if str(r.get("concession", "")).strip()
                      and "无让步" not in str(r.get("concession", ""))}
        check("双方都有让步记录", len(conc_roles) >= 2, str(sorted(conc_roles)))
        # 让步理由必须引用真实约束, 不能是"为了达成一致"这种空话
        scanner_conc = [r for r in rounds2 if r.get("role") == "scanner"
                        and "放弃" in str(r.get("concession", ""))]
        check("选股侧让步说明了放弃了什么", len(scanner_conc) > 0,
              str(scanner_conc[:1])[:160])


    print("\n11) Agent 过程: 跨节点调用留痕")
    # 先触发一次真实调用与一次被拦的调用, 确认两者都进流水
    post_json(f"{base}/api/fleet/invoke", {"node": "crm", "capability": "crm.industries"})
    post_json(f"{base}/api/fleet/invoke", {"node": "crm", "capability": "no.such.cap"})
    st, tr = get_json(f"{base}/api/agent/trace?n=100", timeout=30)
    check("trace 接口可用", st == 200 and tr.get("ok") is True, str(tr)[:120])
    ev = tr.get("events") or []
    check("记录了跨节点调用", len(ev) > 0, str(len(ev)))
    # 每条事件必须有调用方与方向 —— 缺了就画不出关系图
    check("事件含 from/to/cap",
          all(e.get("from") and e.get("to") and e.get("cap") for e in ev),
          str(ev[:1])[:160])
    # 起止节点必须是真实存在的节点, 不能是编的
    known = {n.get("name") for n in (tr.get("nodes") or [])} | {tr.get("self")}
    check("事件端点都是真实节点",
          all(e.get("to") in known and e.get("from") in known for e in ev),
          str({e.get("to") for e in ev})[:120])
    # 失败也要留痕: 只记成功的流水, 排查时等于没有
    check("失败调用也进流水", any(e.get("ok") is False for e in ev),
          str([e for e in ev if not e.get("ok")][:1])[:160])
    # 统计口径要与列表一致, 否则页面上"25 次"配着"20 条"会让人以为被截断
    stt = tr.get("stats") or {}
    check("stats.window 与事件数一致",
          int(stt.get("window", -1)) == len(ev), f"{stt.get('window')} vs {len(ev)}")


    print("\n12) 可用的 Agent: 自主决策 + 过程可见")
    # 走框架原生的 POST /react/api/chat(SSE)。这里不再有 /api/agent/ask:
    # 那是旧版 Python 服务的入口, 已删除(见 src/agent.lume 头注释)。
    # 断言的重点不是"有回答", 而是**它真的调了工具**——否则跟普通问答没区别。
    ev, raw = ask_agent(base, "我们有多少客户，分布在哪些行业？")
    notes = [e.get("d", "") for e in ev if e.get("t") == "note"]
    deltas = [e.get("d", "") for e in ev if e.get("t") == "delta"]
    tools = [n.split("(")[0][len("tool "):] for n in notes
             if n.startswith("tool ") and "(" in n]
    answer = "".join(deltas)

    check("聊天端点可达", len(ev) > 0 and any(e.get("t") == "done" for e in ev),
          f"{len(ev)} 事件 / {raw[:80]}")
    # 关键: 工具名必须是它自己选的, 且是真实注册的那几个
    check("自主调用了工具", len(tools) > 0, str(tools))
    check("工具名合法(无点号, OpenAI 规范)",
          all("." not in t for t in tools), str(tools))
    check("工具来自已知能力集",
          all(t in {"crm_stats", "crm_industries", "crm_stages",
                    "scanner_picks", "scanner_meta"} for t in tools), str(tools))
    # 流式: 答案必须是多段到达的, 一次性到齐说明退化成非流式了
    check("答案是流式分片", len(deltas) > 1, f"{len(deltas)} 片")
    check("给出了非空回答", len(answer.strip()) > 20, answer[:80])
    # 自主多轮: 至少能看到 round 2, 说明它拿结果后继续判断而非一轮出答案
    rounds = [n for n in notes if n.startswith("round ")]
    check("至少进入第 2 轮", len(rounds) >= 1, str(rounds[:3]))

    # 合规: 回答里不得出现买卖方向
    banned = ["建议买入", "建议卖出", "该买入", "该卖出"]
    hit = [w for w in banned if w in answer]
    check("回答不含买卖方向", len(hit) == 0, str(hit))

    total, failed = len(CHECKS), len(FAILS)
    print(f"\n{'=' * 46}\n{total - failed}/{total} 通过"
          + ("" if failed == 0 else f", 失败: {', '.join(FAILS)}"))
    return 0 if failed == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
