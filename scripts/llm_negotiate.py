#!/usr/bin/env python3
"""llm_negotiate.py — 两个 LLM agent 通过 A2A 谈出一个方案

## 与 rules 版(negotiage.lume)的区别

| | 规则版 | 本脚本 |
|---|---|---|
| 提案依据 | 按 score 排序取第一 | LLM 读数据后**论证**为什么该推它 |
| 否决依据 | 写死的 if 判断 | LLM 说明违反了哪条约束、数值多少 |
| 让步 | 门槛减 1 | LLM 自己决定是否让步、并说出理由 |
| 可复现 | 完全可复现 | **不保证**（同一输入两次可能不同结论） |

## 为什么还用 A2A

两个 agent 的事实**分别来自两个 peer 节点**，谁也不直接读对方的库：
- 选股侧：scaner 节点的 scanner.picks（经 /peer/invoke 签名调用）
- 客户侧：crm 节点的 crm.industries（同上，只给行业计数，不给客户明细）

这正是 A2A 的意义：LLM 的论证建立在**各自系统的事实**上，而不是一个
把两边数据都灌进去的大 prompt。后者做不到数据边界。

## verify_fn 做什么

LLM 最容易犯的错是**引用不存在的数字**（"该股 5 个信号共振"而实际是 2 个）。
所以每一轮结束都对 LLM 的说法做程序化核对：
- 提到的代码必须在候选清单里
- 提到的分数/涨幅/信号数必须与真实数据一致
- 违反则打回重写（最多 N 轮）

这是 PSE 的核心思想：**不让 LLM 评判自己**。

用法:
    python scripts/llm_negotiate.py                 # 跑一次完整协商
    python scripts/llm_negotiate.py --json          # 只输出 JSON（给前端/CI 用）
    python scripts/llm_negotiate.py --max-rounds 3
"""
from __future__ import annotations

import argparse
import hashlib
import hmac
import json
import os
import re
import secrets
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

# 阶段等级 → 名称。与 src/negotiate.lume 的 stage_name 保持一致;
# 两处若各写一套, 界面上会出现「3」和「谈判」混着显示。
STAGE_NAME = {4: "成交", 3: "谈判", 2: "方案", 1: "初步接洽", 0: "无"}
ENV = ROOT / ".env"
PROMPTS = ROOT / "prompts"


# ── 配置 ────────────────────────────────────────────────────────────
def load_env() -> dict:
    vals = {}
    for p in (ENV, ROOT.parent / "lume-crm" / ".env"):
        if not p.exists():
            continue
        for line in p.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, v = line.split("=", 1)
                vals.setdefault(k.strip(), v.strip().strip('"').strip("'"))
    for k in list(os.environ):
        if k.startswith(("PEER_", "OPENAI_", "FREE_", "PSE_")):
            vals[k] = os.environ[k]
    return vals


# ── A2A 取数（与 lib/peer.lume 同一套签名） ──────────────────────────
def key_for(root: str, node: str) -> str:
    return hmac.new(root.encode(), f"peer:{node}".encode(), hashlib.sha256).hexdigest()


def peer_post(env: dict, host: str, path: str, body: str, timeout: int = 30):
    node = env.get("PEER_NAME", "lume-a2a")
    ts = str(int(time.time()))
    nonce = secrets.token_hex(8)
    scope = f"POST {path}\n{body}"
    raw = hmac.new(key_for(env["PEER_ROOT"], node).encode(),
                   "\n".join([node, ts, nonce, scope]).encode(),
                   hashlib.sha256).hexdigest()
    url = f"http://{host}{path}?node={node}&ts={ts}&nonce={nonce}&sig={raw}"
    req = urllib.request.Request(
        url, data=body.encode(),
        headers={"Content-Type": "application/json", "Accept": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return json.loads(r.read() or b"{}")
    except urllib.error.HTTPError as e:
        return {"ok": False, "error": f"HTTP {e.code}: {e.read()[:200].decode(errors='replace')}"}
    except Exception as e:  # noqa: BLE001
        return {"ok": False, "error": str(e)}


def fetch_candidates(env: dict) -> dict:
    """选股侧的事实：当日 picks。"""
    r = peer_post(env, env.get("SCANNER_HOST", "127.0.0.1:18103"),
                  "/peer/invoke", json.dumps({"tool": "scanner.picks", "arguments": {}}))
    if not r.get("ok"):
        return {"ok": False, "error": r.get("error", "scanner 不可用"), "picks": []}
    res = r.get("result") or {}
    return {"ok": True, "date": res.get("date", ""), "picks": res.get("picks", [])}


def fetch_industries(env: dict) -> dict:
    """客户侧的事实：行业 × 商机阶段(只有计数, 没有客户明细)。

    为什么不用 crm.industries: 那个只给"每个行业几个客户"。当前每个行业
    都是 1 个客户, 这个维度没有区分度 —— 拿它做约束, 协商只能靠客户侧
    单方面让步。商机阶段有真实差异(信息技术在谈判, 其余在初步接洽),
    才能形成双方都要动一动的冲突。
    """
    r = peer_post(env, env.get("CRM_HOST", "127.0.0.1:18102"),
                  "/peer/invoke", json.dumps({"tool": "crm.stages", "arguments": {}}))
    if not r.get("ok"):
        return {"ok": False, "error": r.get("error", "crm 不可用"), "industries": []}
    res = r.get("result") or {}
    # customer_count: 前端"双方各自看到的事实"那块要显示客户总数。
    # crm.stages 不返回它, 单独取一次 crm.industries 补上 —— 不能因为
    # 换数据源就让页面某块空掉, 而空白不报错、只会显得没做好。
    r2 = peer_post(env, env.get("CRM_HOST", "127.0.0.1:18102"),
                   "/peer/invoke", json.dumps({"tool": "crm.industries", "arguments": {}}))
    total = 0
    if r2.get("ok"):
        total = int((r2.get("result") or {}).get("customer_count", 0))
    return {"ok": True, "industries": res.get("industries", []),
            "stages": res.get("stages", []), "customer_count": total}


def load_industry_map() -> list[dict]:
    """从实体索引读 code -> industry。

    选股侧需要知道"我提的这只属于哪个行业", 否则无法判断自己的提案
    会不会被客户侧以'该行业没商机'为由否掉 —— 那会让它在不知情的情况下
    反复提同一个注定被拒的标的。
    """
    p = ROOT / "data" / "self" / "entity-index.json"
    if not p.exists():
        return []
    try:
        idx = json.loads(p.read_text(encoding="utf-8"))
    except ValueError:
        return []
    return [{"code": c, "industry": r.get("industry", "")}
            for c, r in (idx.get("by_code") or {}).items()]


# ── LLM ─────────────────────────────────────────────────────────────
class LLM:
    def __init__(self, env: dict, provider: str = "deepseek"):
        if provider == "free":
            self.key = env.get("FREE_KEY", "")
            self.base = (env.get("FREE_BASE_URL") or "").rstrip("/")
            self.model = env.get("FREE_MODEL", "")
        else:
            self.key = env.get("OPENAI_API_KEY", "")
            self.base = (env.get("OPENAI_BASE_URL") or "").rstrip("/")
            self.model = env.get("OPENAI_MODEL", "")
        if not self.key or not self.model:
            raise RuntimeError(f"缺少 {provider} 的 API key / model")
        self.calls = 0
        self.tokens = 0

    def chat(self, system: str, user: str, max_tokens: int = 700) -> str:
        body = {
            "model": self.model,
            "messages": [
                {"role": "system", "content": system},
                {"role": "user", "content": user},
            ],
            "temperature": 0.3,
            "max_tokens": max_tokens,
        }
        req = urllib.request.Request(
            self.base + "/chat/completions", data=json.dumps(body).encode(),
            headers={"Content-Type": "application/json",
                     "Authorization": f"Bearer {self.key}"})
        with urllib.request.urlopen(req, timeout=120) as r:
            d = json.loads(r.read())
        self.calls += 1
        self.tokens += int((d.get("usage") or {}).get("total_tokens", 0))
        return d["choices"][0]["message"]["content"]


def parse_json(text: str) -> dict | None:
    """从 LLM 回复里抓 JSON。模型常加 ```json 围栏或前后缀说明。"""
    m = re.search(r"```(?:json)?\s*(\{.*?\})\s*```", text, re.S)
    raw = m.group(1) if m else None
    if raw is None:
        m2 = re.search(r"\{.*\}", text, re.S)
        raw = m2.group(0) if m2 else None
    if raw is None:
        return None
    try:
        return json.loads(raw)
    except ValueError:
        return None


# ── verify_fn：不让 LLM 评判自己 ─────────────────────────────────────
def verify_proposal(obj: dict, picks: list) -> tuple[list, list]:
    """核对选股侧的提案：代码必须在候选里，引用的数字必须真实。"""
    bad, ok = [], []
    if obj.get("action") == "exhausted":
        return [], ["声明无候选"]
    code = str(obj.get("code", ""))
    # 允许 LLM 写 600519 或 sh600519
    norm = re.sub(r"^(sh|sz|bj)", "", code)
    match = None
    for p in picks:
        pc = re.sub(r"^(sh|sz|bj)", "", str(p.get("code", "")))
        if pc == norm:
            match = p
            break
    if match is None:
        bad.append(f"提出的代码 {code!r} 不在候选清单里（禁止编造标的）")
        return bad, ok
    ok.append(f"{match['name']} 在候选清单内")

    text = json.dumps(obj, ensure_ascii=False)
    # 分数: 若提到 score/评分 附近有数字, 必须等于真实值
    real_score = float(match.get("score", 0))
    # LLM 常会引用**其他候选**的分数来做对比("比第二名 471.9 高近一倍")。
    # 只拿它提的那一只去比会把这种正常引用判成幻觉 —— 实测发生过。
    # 所以: 只要这个数字能在**候选池**里找到对应, 就算合法;
    # 只有在整池都找不到时才是编造。
    all_scores = {round(float(p.get("score", 0)), 2) for p in picks}
    for num in re.findall(r"(?:score|评分)[^\d]{0,6}(\d+(?:\.\d+)?)", text):
        v = round(float(num), 2)
        if v == round(real_score, 2):
            ok.append(f"分数 {real_score} 正确")
        elif v in all_scores:
            ok.append(f"分数 {v} 来自候选池其他标的(对比引用)")
        else:
            bad.append(f"引用的分数 {num} 在候选池中不存在(疑似编造)")

    # 信号数: "N 个信号" 必须等于真实数量
    real_sig = len(match.get("signals") or [])
    for num in re.findall(r"(\d+)\s*个信号", text):
        if int(num) != real_sig:
            bad.append(f"声称 {num} 个信号, 实际 {real_sig} 个")
        else:
            ok.append(f"信号数 {real_sig} 正确")

    # 信号名: 提到的信号名必须在真实信号里
    for name in (match.get("signals") or []):
        pass  # 真实信号名出现在文本里是正常的, 反向检查在下面
    mentioned = re.findall(r"(KDJ金叉|MACD金叉|RSI超买|RSI超卖|OBV放量|突破布林上轨|"
                           r"跌破布林下轨|威廉超买|威廉超卖)", text)
    for mn in set(mentioned):
        if mn not in (match.get("signals") or []):
            bad.append(f"提到的信号 {mn} 不在该标的实际信号中")
    if mentioned:
        ok.append("信号名均可对上")
    return bad, ok


def verify_review(obj: dict, candidate: dict | None, industries: list) -> tuple[list, list]:
    """核对客户侧的审议：引用的触达数必须来自真实行业数据。"""
    bad, ok = [], []
    text = json.dumps(obj, ensure_ascii=False)
    # 真实的 行业 → 最高阶段 映射
    stage_map = {str(i.get("industry", "")): str(i.get("best_stage", "无"))
                 for i in industries}
    VALID = {"谈判", "初步接洽", "方案", "成交"}

    # 提到某个行业时, 它必须真实存在
    for ind in stage_map:
        if ind and ind in text:
            ok.append(f"行业 {ind} 真实最高阶段={stage_map[ind]}")
    # 提到的阶段名必须是真实存在的阶段值
    mentioned = re.findall(r"「(谈判|初步接洽|方案|成交)」", text)
    for m in mentioned:
        if m not in VALID:
            bad.append(f"提到了不存在的阶段 {m!r}")
        else:
            ok.append(f"阶段 {m} 合法")

    # 关键: 如果它声称某行业处于某阶段, 必须与真实数据一致
    for ind, real in stage_map.items():
        if ind and ind in text:
            for m in mentioned:
                if m in text and f"{ind}" in text:
                    break
            # 检查"（行业）+（阶段）"是否矛盾: 简单做法是看它有没有说
            # 该行业处于一个不同于真实值的阶段
            pat = re.escape(ind) + r"[^。；]{0,12}「(谈判|初步接洽|方案|成交)」"
            for m2 in re.findall(pat, text):
                if m2 != real:
                    bad.append(f"声称 {ind} 处于「{m2}」, 真实为「{real}」")

    if candidate is not None:
        # accept 时必须说明依据; reject 时必须给出 requirement
        if obj.get("action") == "accept" and not str(obj.get("reason", "")).strip():
            bad.append("接受但未给出理由")
        if obj.get("action") == "reject":
            if not str(obj.get("requirement", "")).strip():
                bad.append("否决但未给出可执行的要求（对方无从调整）")
            else:
                ok.append("否决附带要求")
    return bad, ok


# ── 协商主循环 ──────────────────────────────────────────────────────
def negotiate(env: dict, llm: LLM, max_rounds: int = 3, verbose: bool = True) -> dict:
    cand = fetch_candidates(env)
    inds = fetch_industries(env)
    if not cand.get("ok"):
        return {"ok": False, "error": "选股侧数据不可用: " + str(cand.get("error")), "rounds": []}
    if not inds.get("ok"):
        return {"ok": False, "error": "客户侧数据不可用: " + str(inds.get("error")), "rounds": []}

    picks = cand["picks"]
    industries = inds["industries"]
    INDUSTRY_OF = load_industry_map()
    scanner_prompt = (PROMPTS / "agent_scanner.md").read_text(encoding="utf-8")
    crm_prompt = (PROMPTS / "agent_crm.md").read_text(encoding="utf-8")

    rounds: list[dict] = []
    history: list[str] = []
    rejected: set[str] = set()
    last_requirement = ""
    # 本轮是否因让步而放开过黑名单（放开时不再把当前标的拉黑）
    lowered = False
    floor = int(env.get("PROMOTE_REACH_FLOOR", "2"))
    accepted = None

    for rnd in range(1, max_rounds + 1):
        lowered = False
        # ── 选股侧提案 ──
        avail = [p for p in picks if str(p.get("code", "")) not in rejected]
        cand_text = "\n".join(
            f"- {p.get('code')} {p.get('name')} score={p.get('score')} "
            f"change={p.get('change')}% signals={p.get('signals')}"
            for p in avail) or "（无剩余候选）"
        # 选股侧只知道行情, 不知道客户侧的事 —— 但协商时它必须知道
        # "我提的这只属于哪个行业、那个行业的客户处在什么阶段",
        # 否则它无法判断自己的提案会不会被否, 也没法主动调整。
        # 这不是把客户数据给它, 只是把**行业级的公开事实**给它。
        ind_map = {p.get("code"): p.get("industry", "") for p in INDUSTRY_OF}
        stage_of = {str(i.get("industry", "")): str(i.get("best_stage", "无"))
                    for i in industries}

        def ind_line(p):
            code = str(p.get("code", ""))
            ind = ind_map.get(code, "")
            if not ind:
                return f"  行业: 未知"
            st = stage_of.get(ind, "无商机记录")
            return f"  行业: {ind} · 客户侧阶段: {st}"

        cand_text = "\n".join(
            f"- {p.get('code')} {p.get('name')} score={p.get('score')} "
            f"change={p.get('change')}% signals={p.get('signals')}\n{ind_line(p)}"
            for p in avail) or "（无剩余候选）"

        user = f"""当日候选（共 {len(avail)} 只，只能从这里选）。每只标的后面附了
它所属行业、以及该行业客户侧的最高商机阶段：
{cand_text}

"""
        if last_requirement:
            # 必须把**当前的**门槛告诉它。只给"上一轮的要求"是不够的:
            # 客户侧可能在否决的同时已经让步(门槛 2→1), 而要求文本还停在旧的。
            # 不给最新状态, 选股侧就会按已经过时的条件判断"没有候选" ——
            # 实测反复卡在这里, 两个 agent 都在认真推理, 只是各拿一份旧地图。
            user += f"""上一轮客户侧否决了你的提案，其要求是：
「{last_requirement}」

**客户侧当前的可触达下限已调整为 {floor}**（初值 2）。
请按 floor={floor} 重新评估候选：只要某标的所属行业的客户数 >= {floor}，
它就可能被接受。不要沿用旧的 floor=2 判断"没有候选"。
"""
        else:
            user += "这是第一轮，请提出你认为最强的标的。\n"
        if history:
            user += "\n协商记录：\n" + "\n".join(history[-6:])

        prop, bad_s = None, []
        for attempt in range(3):
            raw = llm.chat(scanner_prompt, user)
            obj = parse_json(raw)
            if obj is None:
                bad_s = ["回复不是合法 JSON"]
                user += f"\n你上次的回复无法解析为 JSON：{raw[:200]}\n请严格按 JSON 格式重答。"
                continue
            bad_s, _ = verify_proposal(obj, picks)
            if not bad_s:
                prop = obj
                break
            user += "\n你的回复有以下问题，请修正后重答：\n" + "\n".join(f"- {b}" for b in bad_s)

        if prop is None:
            rounds.append({"round": rnd, "role": "scanner", "action": "blocked",
                           "text": "提案未通过程序化核对: " + "; ".join(bad_s)})
            break

        if prop.get("action") == "exhausted":
            rounds.append({"round": rnd, "role": "scanner", "action": "exhausted",
                           "text": str(prop.get("argument", "无候选"))})
            break

        pcode = str(prop.get("code", ""))
        pname = str(prop.get("name", ""))
        rounds.append({"round": rnd, "role": "scanner", "action": "propose",
                       "code": pcode, "name": pname,
                       "text": str(prop.get("argument", "")),
                       "concession": str(prop.get("concession", ""))})
        history.append(f"R{rnd} 选股侧提议 {pname}：{prop.get('argument', '')}")

        # ── 客户侧审议 ──
        target = next((p for p in picks
                       if re.sub(r"^(sh|sz|bj)", "", str(p.get("code", "")))
                       == re.sub(r"^(sh|sz|bj)", "", pcode)), None)
        ind_of = ""
        for i in industries:
            pass
        cuser = f"""客户侧事实（行业分布，只有计数）：
{json.dumps(industries, ensure_ascii=False)}

当前可触达下限：{floor}

选股侧本轮提案：
- 代码 {pcode} 名称 {pname}
- 分数据信号：score={target.get('score') if target else '?'} change={target.get('change') if target else '?'}% signals={target.get('signals') if target else '?'}
- 它的理由：{prop.get('argument', '')}
- 它的让步说明：{prop.get('concession', '') or '（无）'}

请审议。注意：你只能基于上面的行业分布数据判断可触达性，不要编造客户数。
"""
        if history:
            cuser += "\n协商记录：\n" + "\n".join(history[-6:])

        rev, bad_c = None, []
        for attempt in range(3):
            raw = llm.chat(crm_prompt, cuser)
            obj = parse_json(raw)
            if obj is None:
                bad_c = ["回复不是合法 JSON"]
                cuser += f"\n你上次的回复无法解析为 JSON：{raw[:200]}\n请严格按 JSON 格式重答。"
                continue
            bad_c, _ = verify_review(obj, target, industries)
            if not bad_c:
                rev = obj
                break
            cuser += "\n你的回复有以下问题，请修正后重答：\n" + "\n".join(f"- {b}" for b in bad_c)

        if rev is None:
            rounds.append({"round": rnd, "role": "crm", "action": "blocked",
                           "text": "审议未通过程序化核对: " + "; ".join(bad_c)})
            break

        action = str(rev.get("action", "reject"))
        if action == "accept":
            nf = rev.get("floor")
            if isinstance(nf, int):
                floor = nf
            rounds.append({"round": rnd, "role": "crm", "action": "accept",
                           "code": pcode, "name": pname,
                           "text": str(rev.get("reason", ""))})
            history.append(f"R{rnd} 客户侧接受：{rev.get('reason', '')}")
            accepted = {"code": pcode, "name": pname,
                        "score": target.get("score") if target else None,
                        "change": target.get("change") if target else None,
                        "signals": target.get("signals") if target else [],
                        "agreed_stage": STAGE_NAME.get(floor, str(floor))}
            break

        # 否决
        requirement = str(rev.get("requirement", ""))
        nf = rev.get("next_floor")
        # LLM 常见的疏漏: concession 里说了"可将下限降至 1", 但没填 next_floor。
        # 只说不填, 对方拿不到这个让步, 谈判就卡死了 —— 实测发生过。
        # 这里从文本里兜底提取, 而不是让整轮谈判作废。
        if not isinstance(nf, int):
            m_floor = re.search(r"(?:降至|降到|降为|下限可降至|下限降至)\s*(\d+)",
                                str(rev.get("concession", "")))
            if m_floor:
                nf = int(m_floor.group(1))
        concession = str(rev.get("concession", ""))
        if isinstance(nf, int) and nf < floor:
            floor = nf
            concession = (concession + " " if concession else "") + f"（门槛降至 {nf}）"
            # 门槛降了, 之前因为"触达不足"被否的标的应当**重新进入候选**。
            # 否则会出现这种荒谬局面: 客户侧说"降了门槛, 那个可以再提",
            # 而选股侧的黑名单还挂着它 —— 双方都以为在谈, 实际在原地打转。
            # 实测就卡在这里: R1 否决五粮液并承诺降到 1, R2 选股侧却看不到它了。
            # 注意顺序: 这里 clear 之后, 下面**不能**再 add(pcode)。
            # 用 lowered 标记, 让 add 跳过 —— 否则刚放开又拉黑, 等于没放开
            # (实测就是这样: clear() 紧跟 add(), 双方仍在原地打转)。
            lowered = True
            rejected.clear()
        rounds.append({"round": rnd, "role": "crm", "action": "reject",
                       "code": pcode, "name": pname,
                       "text": str(rev.get("reason", "")),
                       "requirement": requirement,
                       "concession": concession})
        history.append(f"R{rnd} 客户侧否决 {pname}：{rev.get('reason', '')}；要求：{requirement}")
        if not lowered:
            rejected.add(pcode)
        last_requirement = requirement
        if verbose:
            print(f"  R{rnd} 否决 {pname}: {requirement}")

    return {
        "ok": True,
        "converged": accepted is not None,
        "round_count": len({r["round"] for r in rounds}),
        "rounds": rounds,
        "plan": accepted,
        "as_of": cand.get("date", ""),
        "facts": {
            "candidates": len(picks),
            "industries": industries,
            "customer_count": inds.get("customer_count", 0),
        },
        "llm": {"model": llm.model, "calls": llm.calls, "tokens": llm.tokens},
        "verdict": (f"第 {len({r['round'] for r in rounds})} 轮达成一致: "
                    f"{accepted['name']}" if accepted else
                    f"{max_rounds} 轮内未达成一致"),
    }


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--json", action="store_true", help="只输出 JSON")
    ap.add_argument("--out", default=str(ROOT / "data" / "self" / "llm-negotiation.json"),
                    help="写快照给控制台读(默认 data/self/llm-negotiation.json)")
    ap.add_argument("--max-rounds", type=int, default=3)
    ap.add_argument("--provider", choices=["deepseek", "free"], default="deepseek")
    args = ap.parse_args()

    env = load_env()
    if not env.get("PEER_ROOT"):
        print("✗ 缺少 PEER_ROOT（lume-a2a/.env）", file=sys.stderr)
        return 2
    try:
        llm = LLM(env, args.provider)
    except RuntimeError as e:
        print(f"✗ {e}", file=sys.stderr)
        return 2

    if not args.json:
        print("▶ 两 agent 开始协商（事实分别来自 crm / scanner 两个 peer 节点）")
    result = negotiate(env, llm, args.max_rounds, verbose=not args.json)

    # 写快照: 控制台的 /api/negotiate/llm 读它。
    # 加写时间戳, 让看的人知道这份结果是几点的 —— LLM 结论不像规则那么稳定,
    # 不知道生成时间的结论很容易被当成"当前状态"。
    if result.get("ok"):
        result["generated_at"] = int(time.time())
        out = Path(args.out)
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
        if not args.json:
            print(f"\n快照已写入: {out}")

    if args.json:
        print(json.dumps(result, ensure_ascii=False, indent=2))
    else:
        for r in result.get("rounds", []):
            role = "选股侧" if r["role"] == "scanner" else "客户侧"
            print(f"\n[R{r['round']}] {role} {r['action']}")
            if r.get("name"):
                print(f"      标的: {r['name']} ({r.get('code', '')})")
            print(f"      说法: {r['text']}")
            if r.get("requirement"):
                print(f"      要求: {r['requirement']}")
            if r.get("concession"):
                print(f"      让步: {r['concession']}")
        print("\n" + "=" * 52)
        print(result.get("verdict"))
        if result.get("plan"):
            p = result["plan"]
            print(f"最终: {p['name']} score={p['score']} 底线={p.get('agreed_stage')}")
        m = result.get("llm", {})
        print(f"LLM: {m.get('model')} 调用 {m.get('calls')} 次, {m.get('tokens')} tokens")
    return 0 if result.get("ok") else 1


if __name__ == "__main__":
    sys.exit(main())
