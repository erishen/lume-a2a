/* App.tsx —— 控制台外壳: 顶栏 + 三个页面
 *
 * ══ 为什么只剩三个页面 ═══════════════════════════════════════════════
 * 之前有 8 个标签, 其中:
 *   「调用」「拓扑」依赖的能力(echo.roundtrip / relay)在收敛时已删除,
 *   打开就是坏的 —— 坏的页面比没有页面更伤信任。
 *   「这是什么」与首页内容重复, 「真实节点」与「接口」职责重叠。
 *
 * 现在只留三个, 每个回答一个独立问题:
 *   客户经营   这个项目对外产出什么
 *   实体对齐   产出依据有多可靠
 *   A2A 协商   两个 agent 怎么谈出结论
 *
 * 节点身份、能力清单、Agent Card 这类"查得到就行"的信息,
 * 收进顶栏与页脚, 不再各占一个标签 —— 它们不构成"一页"。
 */
import React from "react";
import type { AgentCard, Capability, NodeState } from "./types";
import { fmtTime } from "./types";
import { api } from "./api";
import { EntityPanel } from "./Entity";
import { NegotiatePanel } from "./Negotiate";
import { AgentPanel } from "./Agent";
import { OutreachPanel } from "./Outreach";
import { AskPanel } from "./Ask";

type Tab = "ask" | "outreach" | "entity" | "negotiate" | "agent";

const TABS: [Tab, string, string][] = [
  ["ask", "问 Agent", "它自己决定查什么"],
  ["outreach", "客户经营", "今天该联系谁"],
  ["entity", "实体对齐", "凭什么相信这些结论"],
  ["negotiate", "A2A 协商", "两个 agent 怎么谈拢"],
  ["agent", "Agent 过程", "节点之间实际发生了什么"],
];

function App(): React.ReactElement {
  const [tab, setTab] = React.useState<Tab>("ask");
  const [state, setState] = React.useState<NodeState | null>(null);
  const [card, setCard] = React.useState<AgentCard | null>(null);
  const [caps, setCaps] = React.useState<Capability[]>([]);
  const [err, setErr] = React.useState("");
  const [showCard, setShowCard] = React.useState(false);

  const refresh = React.useCallback(async () => {
    try {
      const [s, c] = await Promise.all([api.state(), api.capabilities()]);
      setState(s);
      setCaps(c.capabilities);
      setErr("");
    } catch (e) {
      setErr(String(e));
    }
  }, []);

  React.useEffect(() => {
    void refresh();
    const id = window.setInterval(() => void refresh(), 5000);
    return () => window.clearInterval(id);
  }, [refresh]);

  React.useEffect(() => {
    api.card().then(setCard).catch(() => { /* 卡片失败不影响主页面 */ });
  }, []);

  return (
    <div className="shell">
      {/* 顶栏: 身份 + 三个切页。节点状态收在这里, 不再单独占一页。 */}
      <header className="topbar">
        <div className="brand">
          <span className="live" data-on={!!state} />
          <h1>Lume A2A</h1>
          <span className="sub">
            {state ? (
              <>
                <b>{state.node}</b> · {state.mode} · {caps.length} 项能力
              </>
            ) : (
              "连接中…"
            )}
          </span>
        </div>
        <nav className="tabs">
          {TABS.map(([k, label]) => (
            <button
              key={k}
              className={tab === k ? "tab on" : "tab"}
              onClick={() => setTab(k)}
            >
              {label}
            </button>
          ))}
        </nav>
      </header>

      <div className="disclaimer">
        <b>技术演示 · 不构成投资建议</b>
        <span>
          仅用于验证 A2A 协议与多智能体协商，数据为演示数据。
          <b>不得用于向真实客户提供证券投资建议</b>；面向客户提供个股建议须持牌经营。
        </span>
      </div>

      {err && <div className="banner bad">{err}</div>}

      <main>
        {tab === "ask" && <AskPanel />}
        {tab === "outreach" && <OutreachPanel />}
        {tab === "entity" && <EntityPanel />}
        {tab === "negotiate" && <NegotiatePanel />}
        {tab === "agent" && <AgentPanel />}
      </main>

      {/* 页脚: 协议入口与能力清单。查得到就行, 不值得独占一页。 */}
      <footer className="foot">
        <div className="foot-row">
          <span>
            A2A <code>/.well-known/agent-card.json</code> ·{" "}
            <code>POST /a2a</code> · peer <code>POST /peer/invoke</code>
          </span>
          <span className="mono">{state ? fmtTime(state.ts) : "—"}</span>
        </div>
        <details className="foot-details" open={showCard} onToggle={(e) =>
          setShowCard((e.target as HTMLDetailsElement).open)}>
          <summary>本节点声明的能力（{caps.length}）与 Agent Card</summary>
          <ul className="cap-inline">
            {caps.map((c) => (
              <li key={c.name}>
                <span className="mono">{c.name}</span>
                <span className="hint">{c.title}</span>
              </li>
            ))}
          </ul>
          {card && <pre className="code">{JSON.stringify(card, null, 2)}</pre>}
        </details>
      </footer>
    </div>
  );
}

export default App;
