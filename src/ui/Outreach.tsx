/* Outreach.tsx —— 客户经营: 今天该联系哪个行业的客户
 *
 * 这一页替代了原来"该推哪只票"的位置。区别不是措辞, 是**主体**:
 *   原来: 主体是股票 → 输出"买什么"      → 荐股(需持牌)
 *   现在: 主体是客户 → 输出"什么时候联系" → 客户经营
 *
 * 所以界面上**一个股票代码都不该出现**。这不是"少显示一点",
 * 而是这个页面能否成立的前提。
 */
import React from "react";
import { api } from "./api";
import type { OutreachResult } from "./types";

export function OutreachPanel(): React.ReactElement {
  const [data, setData] = React.useState<OutreachResult | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [err, setErr] = React.useState("");

  const load = React.useCallback(async () => {
    setBusy(true);
    setErr("");
    try {
      const r = await api.outreach();
      if (!r.ok) throw new Error(r.error || "生成失败");
      setData(r);
    } catch (e) {
      setErr(String(e));
    } finally {
      setBusy(false);
    }
  }, []);

  React.useEffect(() => { void load(); }, [load]);

  return (
    <div className="grid">
      <section className="card intro-hero">
        <div className="scene-head">
          <div>
            <h2 className="hero-title">今天该联系哪个行业的客户</h2>
            <p className="hero-lede">
              销售卡住的往往不是"不知道该推什么"，而是<b>手上几十个客户，今天该主动联系谁</b>。
              scanner 提供行业整体动向，crm 提供该行业的在跟进客户 —— 组合出的是<b>联系时机</b>，不是买卖建议。
            </p>
          </div>
          <button className="ghost slim" disabled={busy} onClick={() => void load()}>
            {busy ? "计算中…" : "重新计算"}
          </button>
        </div>

        {data && (
          <div className="kpis">
            <div className="kpi ok">
              <b>{data.coverage.with_contact}</b>
              <span>可形成联系由头的行业</span>
            </div>
            <div className="kpi">
              <b>{data.coverage.industries_total}</b>
              <span>已知行业</span>
            </div>
            <div className="kpi">
              <b>{data.coverage.skipped}</b>
              <span>因数据不足跳过</span>
            </div>
            <div className="kpi">
              <b>{data.coverage.min_sample}</b>
              <span>行业最小样本</span>
            </div>
          </div>
        )}
        {err && <p className="note bad">{err}</p>}
      </section>

      {data?.items.map((it) => (
        <section className="card outreach-card" key={it.industry}>
          <div className="scene-head">
            <div>
              <h2>
                {it.industry}
                <span className="tag" data-tone="ok" style={{ marginLeft: 8 }}>
                  {it.customers} 个客户在跟进
                </span>
              </h2>
              <p className="tagline">{it.headline}</p>
            </div>
            <div className="outreach-meta">
              <span className="hint">样本 {it.sample_size} 只</span>
            </div>
          </div>
          <p className="hook">{it.hook}</p>
          <p className="hint">
            下一步由销售决定：可以先问客户最近怎么看这个行业，再谈具体需求。
            <b>本页不提供任何标的或买卖方向。</b>
          </p>
        </section>
      ))}

      {data && data.items.length === 0 && (
        <section className="card">
          <p className="note">
            当前没有可用于联系由头的行业。原因见下。
          </p>
        </section>
      )}

      {data && data.skipped.length > 0 && (
        <section className="card">
          <h2>被跳过的行业 <span className="hint">跳过的理由比留下的结果更能说明数据质量</span></h2>
          <ul className="gap-list">
            {data.skipped.map((s) => (
              <li key={s.industry}>
                <span>{s.industry}</span>
                <span className="hint">{s.reason}</span>
              </li>
            ))}
          </ul>
          <p className="note">
            「样本不足」意味着该行业在实体索引里只有 1 只标的 ——
            用 1 只标的代表整个行业会让人误以为看到了行业趋势。
            补齐索引后这些行业会自动进入清单。
          </p>
        </section>
      )}

      {data && (
        <p className="foot-note">{data.boundary}</p>
      )}
    </div>
  );
}
