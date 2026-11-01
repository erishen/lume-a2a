/* ⚠️ 已退役 —— UI 简化时移出导航。
 * 保留文件便于回看; 不被 App.tsx 引用, 不参与构建。
 * Intro: 内容与首页重复。Fleet: 节点状态已收进顶栏。
 * 确认无需回看后可删除整个文件。*/

/* Fleet.tsx —— 真实节点面板: crm / scanner
 *
 * 这个面板替换了原来的「自造能力」演示。区别很关键:
 *   自造节点测的是"我的代码对不对"; 真实节点测的是"两个独立项目能不能
 *   互相认出来并交换真实业务数据" —— 后者才是 A2A 要解决的问题。
 *
 * 界面上刻意区分三种故障, 因为修法完全不同:
 *   认证被拒(401)  → 密钥模式不一致 / 对端注册表里没有我
 *   连不上         → 进程没起 / 端口不对
 *   能力不存在     → 名字拼错 / 对端没升级
 * 统一显示"离线"会让排障从这里开始找网络, 而真正的原因可能是一行注册表。
 */
import React from "react";
import type { FleetNode } from "./types";
import { api } from "./api";

export function FleetPanel(): React.ReactElement {
  const [nodes, setNodes] = React.useState<FleetNode[]>([]);
  const [self, setSelf] = React.useState<{ name: string; mode: string }>({ name: "—", mode: "" });
  const [err, setErr] = React.useState("");
  const [loading, setLoading] = React.useState(true);

  const refresh = React.useCallback(async () => {
    try {
      const r = await api.fleet();
      setNodes(r.nodes);
      setSelf({ name: r.self, mode: r.mode });
      setErr("");
    } catch (e) {
      setErr(String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => { void refresh(); }, [refresh]);

  const online = nodes.filter((n) => n.online).length;

  return (
    <div className="grid">
      <section className="card">
        <div className="scene-head">
          <div>
            <h2>真实 peer 节点</h2>
            <p className="tagline">
              本节点 <b className="mono">{self.name}</b>
              <span className="tag" style={{ marginLeft: 8 }}>{self.mode || "—"}</span>
              <span className="hint" style={{ marginLeft: 8 }}>
                签名模式 derived = 按节点名从 PEER_ROOT 派生密钥
              </span>
            </p>
          </div>
          <button className="ghost slim" onClick={() => void refresh()}>
            重新探测
          </button>
        </div>
        {loading && <p className="hint">探测中…</p>}
        {err && <p className="note bad">{err}</p>}
        {!loading && (
          <p className="hint" style={{ marginTop: 8 }}>
            {online}/{nodes.length} 在线
          </p>
        )}
      </section>

      {nodes.map((n) => (
        <NodeCard key={n.name} node={n} onDone={() => void refresh()} />
      ))}
    </div>
  );
}

function NodeCard({ node, onDone }: { node: FleetNode; onDone: () => void }): React.ReactElement {
  const [busy, setBusy] = React.useState<string>("");
  const [out, setOut] = React.useState<Record<string, { ok: boolean; text: string }>>({});

  async function run(cap: string) {
    setBusy(cap);
    try {
      const r = await api.fleetInvoke(node.name, cap);
      setOut((p) => ({
        ...p,
        [cap]: {
          ok: r.ok,
          text: r.ok ? JSON.stringify(r.result, null, 2) : r.error || "失败",
        },
      }));
    } catch (e) {
      setOut((p) => ({ ...p, [cap]: { ok: false, text: String(e) } }));
    } finally {
      setBusy("");
      onDone();
    }
  }

  return (
    <section className="card scene">
      <div className="scene-head">
        <div>
          <h2>
            {node.name}
            <span
              className="tag"
              data-tone={node.online ? "ok" : "bad"}
              style={{ marginLeft: 8 }}
            >
              {node.online ? "在线" : "离线"}
            </span>
          </h2>
          <p className="tagline mono">{node.host}</p>
        </div>
        {node.online && (
          <span className="hint mono">{node.tools.length} 个能力</span>
        )}
      </div>

      {!node.online && (
        <p className="note bad">
          {node.error || "不可达"}
          <br />
          <span className="hint">
            认证被拒 → 检查 PEER_ROOT 是否一致、对端 peers-identity.json 里有没有本节点；
            连不上 → 检查进程与端口。
          </span>
        </p>
      )}

      {node.online && node.summary && <p className="why">{node.summary}</p>}

      {node.online && (
        <div className="cap-list">
          {node.tools.map((t) => (
            <div key={t.name} className="cap-row">
              <div className="cap-meta">
                <span className="mono cap-name">{t.name}</span>
                <span className="hint">{t.desc}</span>
              </div>
              <button
                className="ghost slim"
                disabled={busy === t.name}
                onClick={() => void run(t.name)}
              >
                {busy === t.name ? "调用中…" : "调用"}
              </button>
              {out[t.name] && (
                <pre className={out[t.name].ok ? "code ok" : "code bad"}>
                  {out[t.name].text}
                </pre>
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
