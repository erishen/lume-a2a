/* Negotiate.tsx —— A2A 协商: 两个 agent 谈出方案
 *
 * 这一页要回答的核心问题:**为什么需要两个 agent, 一个不够吗?**
 *
 * 所以界面上必须同时看到三件事, 少一件就退化成"又一个标的列表":
 *   1. 选股侧提了什么(以及它的排序依据);
 *   2. 客户侧为什么否决(约束是什么, 不是"不合适");
 *   3. 谁让了步 —— 选股侧换了标的, 还是客户侧降了门槛。
 *
 * 只展示"最终方案"而不展示过程, 就分不清这是协商出来的,
 * 还是一开始就算出来的。
 */
import React from "react";
import { api } from "./api";
import type { LLMNegotiation, LLMRound, Negotiation, NegotiationRound } from "./types";

const ACTION_LABEL: Record<string, string> = {
  propose: "提议",
  reject: "否决",
  accept: "接受",
  exhausted: "无候选",
  blocked: "不可用",
};

export function NegotiatePanel(): React.ReactElement {
  // 两种引擎共用这一页, 因为它俩要回答的是同一个问题:
  // "两个 agent 能不能谈出一个方案"。并排看才分得出差别在哪。
  const [engine, setEngine] = React.useState<"rules" | "llm">("llm");
  const [data, setData] = React.useState<Negotiation | null>(null);
  const [llmData, setLlmData] = React.useState<LLMNegotiation | null>(null);
  const [llmErr, setLlmErr] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [err, setErr] = React.useState("");
  const [goal, setGoal] = React.useState("为本周有信号的标的选定一个优先跟进对象");

  const loadLLM = React.useCallback(async () => {
    try {
      const r = await api.negotiateLLM();
      if (!r.ready || !r.result) {
        setLlmErr(r.error || "LLM 协商尚未运行");
        setLlmData(null);
        return;
      }
      setLlmData(r.result);
      setLlmErr("");
    } catch (e) {
      setLlmErr(String(e));
    }
  }, []);

  const run = React.useCallback(async () => {
    setBusy(true);
    setErr("");
    try {
      if (engine === "llm") { await loadLLM(); }
      else {
        const r = await api.negotiate(goal);
        if (!r.ok) throw new Error("协商失败");
        setData(r.result);
      }
    } catch (e) {
      setErr(String(e));
    } finally {
      setBusy(false);
    }
  }, [goal, engine, loadLLM]);

  React.useEffect(() => { void run(); }, [engine]);

  // 两种引擎的输出归一化成同一形状, 免得模板里到处 if
  const view = engine === "llm" ? llmData : data;
  const roundsAll: (NegotiationRound | LLMRound)[] = view?.rounds ?? [];

  // 按轮次分组: 一轮里双方各说了什么, 要放在一起看
  const byRound = new Map<number, (NegotiationRound | LLMRound)[]>();
  roundsAll.forEach((r) => {
    const arr = byRound.get(r.round) ?? [];
    arr.push(r);
    byRound.set(r.round, arr);
  });

  return (
    <div className="grid">
      <section className="card intro-hero">
        <div className="scene-head">
          <div>
            <h2 className="hero-title">两个 agent 谈出一个方案</h2>
            <p className="hero-lede">
              选股侧按信号强度提案，客户侧带自己的约束审议 ——
              <b>谈不拢就各自让步</b>，直到达成一致或谈崩。
            </p>
          </div>
          <button className="ghost slim" disabled={busy} onClick={() => void run()}>
            {busy ? "协商中…" : "重新协商"}
          </button>
        </div>

        <label className="field" style={{ marginTop: 14 }}>
          <span>协商引擎</span>
          <div className="seg">
            <button className={engine === "llm" ? "on" : ""} onClick={() => setEngine("llm")}>
              LLM 推理（真 agent）
            </button>
            <button className={engine === "rules" ? "on" : ""} onClick={() => setEngine("rules")}>
              规则驱动（可复现）
            </button>
          </div>
        </label>

        {engine === "rules" && (
          <label className="field">
            <span>协商目标</span>
            <input value={goal} onChange={(e) => setGoal(e.target.value)} />
          </label>
        )}

        {engine === "llm" && (
          <p className="hint" style={{ marginTop: 8 }}>
            由 <b>deepseek-chat</b> 扮演两个 agent 通过 A2A 取数后协商 ·
            结果由 <code>make llm-negotiate</code> 生成快照，这里只读
          </p>
        )}

        {view && (
          <>
            <div className="verdict" data-ok={view.converged}>
              <b>{view.converged ? "达成一致" : "未达成一致"}</b>
              <span>{view.verdict}</span>
            </div>
            <p className="hint" style={{ marginTop: 8 }}>
              {view.round_count} 轮 · {roundsAll.length} 条发言
              {engine === "llm" && llmData && (
                <> · {llmData.llm.model} 调用 {llmData.llm.calls} 次 / {llmData.llm.tokens} tokens</>
              )}
            </p>
          </>
        )}
        {engine === "llm" && llmErr && (
          <p className="note bad">
            {llmErr}
            <br />
            <span className="hint">在宿主执行 <code>make llm-negotiate</code> 生成结果后刷新。</span>
          </p>
        )}
        {err && <p className="note bad">{err}</p>}
      </section>

      {[...byRound.entries()].map(([round, items]) => (
        <section className="card round" key={round}>
          <h2 className="round-title">第 {round} 轮</h2>
          {items.map((it, i) => (
            <div className={"turn role-" + it.role} key={i}>
              <div className="turn-head">
                <span className="role-tag">{it.role === "scanner" ? "选股侧" : "客户侧"}</span>
                <span
                  className="tag"
                  data-tone={
                    it.action === "accept" ? "ok"
                      : it.action === "reject" ? "bad"
                        : undefined
                  }
                >
                  {ACTION_LABEL[it.action] ?? it.action}
                </span>
                {it.name && <span className="turn-target">{it.name}</span>}
                {it.code_reason && <span className="hint mono">{it.code_reason}</span>}
              </div>
              <p className="turn-text">{it.text}</p>
              {"requirement" in it && it.requirement && (
                <p className="turn-extra">要求：{it.requirement}</p>
              )}
              {"concession" in it && it.concession && (
                <p className="turn-extra concession">让步：{it.concession}</p>
              )}
            </div>
          ))}
        </section>
      ))}

      {view?.converged && view.plan && (
        <section className="card plan-card">
          <h2>协商收敛结果 <span className="hint">双方约束下的一个可行解</span></h2>
          <div className="plan-main">
            <div>
              <div className="plan-name">{String(view.plan.name)}</div>
            </div>
            <div className="plan-metrics">
              <div><b>{String(view.plan.score)}</b><span>信号评分</span></div>
              <div><b>{Number(view.plan.change).toFixed(2)}%</b><span>当日涨跌</span></div>
              <div><b>{String(view.plan.agreed_stage ?? "—")}</b><span>达成时的阶段要求</span></div>
            </div>
          </div>
          <p className="note">
            这个结果不是"分数最高的那只"—— 分数最高的被客户侧否了。
            它是<b>在双方约束下能达成一致的可行解</b>，
            这一点和单方排序得到的结果不同。
          </p>
          <p className="note bad" style={{ marginTop: 6 }}>
            仅用于验证协商机制能否收敛，<b>不构成任何证券投资建议</b>。
          </p>
        </section>
      )}

      {engine === "llm" && llmData?.facts && (
        <section className="card">
          <h2>双方各自看到的事实 <span className="hint">谁也不读对方的库</span></h2>
          <p className="why">
            这两个 agent 谈得成，前提是它们拿的是**不同但都真实**的事实。
            如果把它们塞进同一个大 prompt，数据边界就没了 —— 那退化成"一个模型看两份数据"，
            跟 A2A 没关系了。
          </p>
          <div className="facts">
            <div className="fact-col">
              <h3>选股侧（scanner 节点）</h3>
              <div className="fact-num">{llmData.facts.candidates}</div>
              <p className="hint">当日候选标的，来自 <code>scanner.picks</code></p>
              <p className="hint">
                它只知道代码、分数、涨跌幅、信号名 —— <b>不知道任何客户信息</b>
              </p>
            </div>
            <div className="fact-col">
              <h3>客户侧（crm 节点）</h3>
              <div className="fact-num">{llmData.facts.customer_count}</div>
              <p className="hint">
                客户总数，分布在 {llmData.facts.industries.length} 个行业，来自 <code>crm.industries</code>
              </p>
              <div className="ind-chips">
                {llmData.facts.industries.map((i) => (
                  <span key={i.industry} className="tag">
                    {i.industry} {i.customers}
                  </span>
                ))}
              </div>
              <p className="hint" style={{ marginTop: 6 }}>
                它只知道行业与人数 —— <b>拿不到姓名、邮箱、电话</b>
              </p>
            </div>
          </div>
        </section>
      )}

      <p className="foot-note">
        当前引擎：{engine === "llm" ? "LLM 推理（结论不可复现）" : "规则驱动（可复现）"}。
        切换引擎可对比两种协商方式的差异。
      </p>
    </div>
  );
}
