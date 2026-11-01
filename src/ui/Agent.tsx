/* Agent.tsx —— 三个节点之间的真实调用过程
 *
 * 这一页回答一个具体问题:**"这次结论是经过哪几个节点拿到的"**
 *
 * 数据来自 fleet.invoke 的埋点(所有跨节点调用的唯一入口), 不是现编的。
 * 所以能看到失败的、重试的、空手而归的调用 —— 那些恰恰是最该看的。
 *
 * 为什么不做成"漂亮的架构图": 架构图谁都能画, 画出来也和真实运行无关。
 * 这里画的是**从埋点里读出来的**: 某两个节点之间发生过几次调用、
 * 哪条边一次都没走过。没走过的边就该显示出来, 那说明它是摆设。
 */
import React from "react";
import { api } from "./api";
import type { AgentTrace } from "./types";

export function AgentPanel(): React.ReactElement {
  const [data, setData] = React.useState<AgentTrace | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [err, setErr] = React.useState("");
  const [filter, setFilter] = React.useState<string>("");

  const load = React.useCallback(async () => {
    setBusy(true);
    setErr("");
    try {
      const r = await api.agentTrace(80);
      if (!r.ok) throw new Error("读取失败");
      setData(r);
    } catch (e) {
      setErr(String(e));
    } finally {
      setBusy(false);
    }
  }, []);

  React.useEffect(() => {
    void load();
    // 每 5 秒自动刷新: 这一页看的是"刚才发生了什么",
    // 点一下刷新才更新会让人错过正在进行的调用。
    const id = window.setInterval(() => void load(), 5000);
    return () => window.clearInterval(id);
  }, [load]);

  const events = data?.events ?? [];
  // 从埋点里汇总出"节点 → 节点"的边。哪条边调用最多, 一眼能看出。
  const edges = new Map<string, { from: string; to: string; n: number; fail: number }>();
  events.forEach((e) => {
    const k = `${e.from}→${e.to}`;
    const cur = edges.get(k) ?? { from: e.from, to: e.to, n: 0, fail: 0 };
    cur.n += 1;
    if (!e.ok) cur.fail += 1;
    edges.set(k, cur);
  });

  const shown = filter
    ? events.filter((e) => e.to === filter || e.cap.startsWith(filter))
    : events;

  return (
    <div className="grid">
      <section className="card intro-hero">
        <div className="scene-head">
          <div>
            <h2 className="hero-title">Agent 之间发生了什么</h2>
            <p className="hero-lede">
              本节点编排，crm 与 scanner 供数。每次跨节点调用都留痕 ——
              包括失败的。<b>下面全部来自真实埋点，不是示意</b>。
            </p>
          </div>
          <button className="ghost slim" disabled={busy} onClick={() => void load()}>
            {busy ? "读取中…" : "刷新"}
          </button>
        </div>

        {data?.stats && (
          <div className="kpis">
            <div className="kpi">
              <b>{data.stats.window}</b>
              <span>最近调用</span>
            </div>
            <div className="kpi ok">
              <b>{data.stats.ok}</b>
              <span>成功</span>
            </div>
            <div className="kpi">
              <b>{data.stats.fail}</b>
              <span>失败</span>
            </div>
            <div className="kpi">
              <b>{(data.stats.total_bytes / 1024).toFixed(1)}</b>
              <span>累计返回 KB</span>
            </div>
          </div>
        )}
        {err && <p className="note bad">{err}</p>}
      </section>

      <section className="card">
        <h2>调用关系 <span className="hint">从埋点汇总，不是画的架构图</span></h2>
        <div className="agent-topo">
          <div className="agent-node self">
            <b>{data?.self ?? "lume-a2a"}</b>
            <span className="hint">编排方</span>
          </div>
          <div className="agent-edges">
            {[...edges.values()].map((e) => (
              <div className="agent-edge" key={`${e.from}-${e.to}`}>
                <span className="edge-line" />
                <span className="tag">{e.n} 次</span>
                {e.fail > 0 && (
                  <span className="tag" data-tone="bad">{e.fail} 失败</span>
                )}
              </div>
            ))}
            {edges.size === 0 && <span className="hint">暂无调用记录</span>}
          </div>
          <div className="agent-peers">
            {(data?.nodes ?? []).map((n) => {
              const cnt = (data?.stats.by_node ?? []).find((x) => x.node === n.name)?.count ?? 0;
              return (
                <button
                  key={n.name}
                  className={"agent-node peer" + (filter === n.name ? " on" : "")}
                  onClick={() => setFilter(filter === n.name ? "" : n.name)}
                  title={cnt > 0 ? `点击只看发给 ${n.name} 的调用` : "这个节点还没被调用过"}
                >
                  <b>{n.name}</b>
                  <span className="hint">{cnt > 0 ? `${cnt} 次调用` : "未被调用"}</span>
                  <span className="mono hint">{n.host}</span>
                </button>
              );
            })}
          </div>
        </div>
        <p className="note">
          若某个对端显示「未被调用」，说明它虽然配在 <code>PEER_FLEET</code> 里，
          但当前流程一次都没走到它 —— 这是一个真实的集成缺口，不是显示问题。
        </p>
      </section>

      <section className="card">
        <h2>
          调用流水
          <span className="hint">
            {filter ? `筛选：${filter}　` : ""}最新 {shown.length} 条
          </span>
          {filter && (
            <button className="link" style={{ marginLeft: 8 }} onClick={() => setFilter("")}>
              清除筛选
            </button>
          )}
        </h2>
        {shown.length === 0 ? (
          <p className="hint">暂无记录。去「客户经营」或「A2A 协商」跑一次，回来再看。</p>
        ) : (
          <table className="tbl trace-tbl">
            <thead>
              <tr>
                <th>时间</th>
                <th>调用方</th>
                <th>被调方</th>
                <th>能力</th>
                <th>结果</th>
                <th className="num">返回</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((e, i) => (
                <tr key={i} className={e.ok ? "" : "row-fail"}>
                  <td className="mono">{timeOf(e.ts)}</td>
                  <td className="mono">{e.from}</td>
                  <td className="mono">{e.to}</td>
                  <td className="mono">{e.cap}</td>
                  <td>
                    {e.ok ? (
                      <span className="tag" data-tone="ok">成功</span>
                    ) : (
                      <span className="tag" data-tone="bad" title={e.err}>
                        失败
                      </span>
                    )}
                  </td>
                  <td className="num mono">
                    {e.ok ? `${(e.bytes / 1024).toFixed(1)} KB` : "—"}
                    {e.note && <span className="hint"> · {e.note}</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <p className="foot-note">
        时间精度为秒（lume 的 <code>now()</code> 是秒级）。本机调用通常不足 10ms，
        所以这里不显示耗时 —— 显示恒为 0 的数字比不显示更误导。
      </p>
    </div>
  );
}

function timeOf(ts: number): string {
  const d = new Date(ts * 1000);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}
