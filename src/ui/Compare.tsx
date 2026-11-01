/* ⚠️ 已退役 —— 项目收敛时移除。
 * 保留文件是为了让历史讨论可追溯; 它不被任何页面引用, 也不参与构建。
 * 退役原因: 荐股语义(合规) / 无实际内容 / 依赖已删除的演示能力。
 * 确认无需回看后可以直接删除整个文件。*/

/* Compare.tsx —— 现场对比: 同一个 CRM, 两条路走一遍
 *
 * 为什么这一页最重要: 讲"为什么需要 A2A"最容易变成念特性列表, 听完还是
 * 没感觉。这里改成**当场做两次请求**, 把结果并排放:
 *
 *   路线 A  直接打 CRM 的 peer 端口 /api/stats   → 404
 *   路线 B  带签名打同一个端口的 /peer/invoke     → 真实数据
 *
 * 404 这个结果很关键: 它说明 peer 端口**不是**一个普通 API, 而是一个
 * 有身份、有签名、只谈"能力"的接口。看一眼就懂, 不需要先读文档。
 *
 * 两个请求都由服务端代发(见 node.lume 的 /api/compare)。浏览器不直接打
 * 对端, 因为那会撞 CORS, 而且浏览器也不该持有密钥。
 */
import React from "react";
import { api } from "./api";

interface CompareRow {
  label: string;
  url: string;
  status: number;
  ok: boolean;
  note: string;
  body: string;
}

export function ComparePanel(): React.ReactElement {
  const [rows, setRows] = React.useState<CompareRow[]>([]);
  const [busy, setBusy] = React.useState(false);
  const [err, setErr] = React.useState("");

  async function run() {
    setBusy(true);
    setErr("");
    try {
      const r = await api.compare();
      setRows(r.rows);
    } catch (e) {
      setErr(String(e));
    } finally {
      setBusy(false);
    }
  }

  React.useEffect(() => { void run(); }, []);

  return (
    <div className="grid">
      <section className="card">
        <div className="scene-head">
          <div>
            <h2>同一个 CRM，两条路</h2>
            <p className="tagline">
              对端：lume-crm（一个真实在跑的独立项目）
            </p>
          </div>
          <button className="ghost slim" disabled={busy} onClick={() => void run()}>
            {busy ? "请求中…" : "重新请求"}
          </button>
        </div>
        <p className="why">
          左边是「直接调普通接口」，右边是「按 peer 协议带签名调能力」。
          注意左边返回的不是数据不足，而是 <b>404 —— 那个路径在 peer 端口上根本不存在</b>。
          peer 端口只谈「能力」，不暴露业务路径。
        </p>
        {err && <p className="note bad">{err}</p>}
      </section>

      {rows.map((r, i) => (
        <section className={"card compare-card " + (r.ok ? "is-ok" : "is-bad")} key={i}>
          <div className="scene-head">
            <div>
              <h2>
                <span className={"badge " + (r.ok ? "ok" : "bad")}>
                  {r.ok ? "拿到了" : "被拒了"}
                </span>
                {r.label}
              </h2>
              <p className="tagline mono">{r.url}</p>
            </div>
            <span className="tag" data-tone={r.ok ? "ok" : "bad"}>
              HTTP {r.status || "—"}
            </span>
          </div>
          <p className="note">{r.note}</p>
          <pre className={r.ok ? "code ok" : "code bad"}>{r.body || "(空)"}</pre>
        </section>
      ))}
    </div>
  );
}
