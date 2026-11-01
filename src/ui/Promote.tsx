/* ⚠️ 已退役 —— 项目收敛时移除。
 * 保留文件是为了让历史讨论可追溯; 它不被任何页面引用, 也不参与构建。
 * 退役原因: 荐股语义(合规) / 无实际内容 / 依赖已删除的演示能力。
 * 确认无需回看后可以直接删除整个文件。*/

/* Promote.tsx —— 技术演示: 用 CRM 行业分布 × scanner 当日信号做一次跨节点联合查询
 *
 * ⚠️ 这一页展示的是**数据关联能力**, 不是投资建议。
 *    "某行业有信号 + 该行业有客户" 是一个 join 结果, 到此为止。
 *    要不要把它变成对客户的建议, 是另一个问题 —— 那需要持牌。
 *
 * 这是整个演示的落点: 前面几页讲的是"协议怎么工作", 这一页回答
 * "两个项目拼起来能干什么"。
 *
 * 界面上必须守住的区分(否则这一页就退化成一张股票列表):
 *   ● 今日有信号   —— scanner 今天选出来了(仅表示信号存在, 不代表该推)
 *   ○ 潜在关注     —— 同行业、但今天没信号, 只作背景参考
 *
 * 数据来源也写在页面上: 客户行业由 crm 自己汇总(不含明细), 行业映射表是
 * 人工维护的 —— 这两点读者有权知道, 否则会以为 stock→industry 是上游字段。
 */
import React from "react";
import { api } from "./api";
import type { PromoteResult } from "./types";

export function PromotePanel(): React.ReactElement {
  const [data, setData] = React.useState<PromoteResult | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [err, setErr] = React.useState("");

  const load = React.useCallback(async () => {
    setBusy(true);
    setErr("");
    try {
      const r = await api.promote();
      if (!r.ok) throw new Error(r.error || "生成失败");
      setData(r.result);
    } catch (e) {
      setErr(String(e));
    } finally {
      setBusy(false);
    }
  }, []);

  React.useEffect(() => { void load(); }, [load]);

  const cov = data?.coverage;
  const totalSignaled =
    data?.recommendations.reduce((n, r) => n + r.signal_count, 0) ?? 0;

  return (
    <div className="grid">
      <section className="card intro-hero">
        <div className="scene-head">
          <div>
            <h2 className="hero-title">客户行业 × 今日信号：一次跨节点关联</h2>
            <p className="hero-lede">
              crm 知道「我们有哪些行业的客户」，scanner 知道「今天哪些股票在放信号」。
              这份知识跨在两个系统上 —— 于是把两边的事实合起来算一次。
            </p>
            <p className="hint" style={{ marginTop: 8 }}>
              这里只做<b>关联</b>：某行业有客户、且该行业有标的在放信号。
              <b>不建议买卖、不面向客户</b>。把这种关联变成对客户的投资建议是另一回事。
            </p>
          </div>
          <button className="ghost slim" disabled={busy} onClick={() => void load()}>
            {busy ? "计算中…" : "重新计算"}
          </button>
        </div>

        {data && cov && (
          <div className="kpis">
            <div className="kpi">
              <b>{cov.customer_industries}</b>
              <span>客户行业</span>
            </div>
            <div className="kpi">
              <b>{cov.industries_covered}</b>
              <span>可对接行业</span>
            </div>
            <div className="kpi ok">
              <b>{totalSignaled}</b>
              <span>今日有信号标的</span>
            </div>
            <div className="kpi">
              <b>{cov.unclassified_customers}</b>
              <span>客户未能归类</span>
            </div>
          </div>
        )}
        {err && <p className="note bad">{err}</p>}
      </section>

      {data?.recommendations.map((rec) => (
        <section className="card scene" key={rec.industry}>
          <div className="scene-head">
            <div>
              <h2>
                {rec.industry}
                <span className="tag" style={{ marginLeft: 8 }}>
                  {rec.customers} 个客户
                </span>
                {/* 依据可靠度必须显眼: exact 是查出来的, keyword 是猜的。
                    不标这个, 使用者会把两者当成同等可信 —— 差一个数量级。 */}
                <span
                  className="tag"
                  data-tone={rec.basis === "exact" ? "ok" : undefined}
                  style={{ marginLeft: 6 }}
                  title={
                    rec.basis === "exact"
                      ? "该行业标的已通过实体索引(USCC/证券代码)确认"
                      : rec.basis === "mixed"
                        ? "部分标的经实体确认, 其余依赖关键词规则"
                        : "全部来自公司名关键词规则, 尚未做实体对齐"
                  }
                >
                  {rec.basis === "exact" ? "实体已对齐" : rec.basis === "mixed" ? "部分对齐" : "关键词推断"}
                </span>
                {rec.signal_count > 0 ? (
                  <span className="tag" data-tone="ok" style={{ marginLeft: 6 }}>
                    {rec.signal_count} 只今日有信号
                  </span>
                ) : (
                  <span className="tag" style={{ marginLeft: 6 }}>
                    今日无信号
                  </span>
                )}
              </h2>
              <p className="tagline">{rec.reason}</p>
            </div>
          </div>

          <div className="stock-list">
            {rec.targets.map((t) => (
              <div className={"stock-row" + (t.signaled ? " is-signaled" : "")} key={t.code}>
                <span className={"dot-mark " + (t.signaled ? "on" : "off")} />
                <span className="mono stock-code">{t.code}</span>
                <span className="stock-name">{t.name}</span>
                {t.signaled ? (
                  <>
                    <span className="tag" data-tone="ok">今日入选</span>
                    <span className="mono stock-score">score {t.score}</span>
                    <span className="chg" data-up={t.change >= 0}>
                      {t.change >= 0 ? "+" : ""}{t.change.toFixed(2)}%
                    </span>
                    <span className="hint">{t.signals.join(" · ")}</span>
                  </>
                ) : (
                  <span className="hint">同行业潜在关注（今日未入选）</span>
                )}
              </div>
            ))}
          </div>
        </section>
      ))}

      {data && data.recommendations.length === 0 && (
        <section className="card">
          <p className="note">
            没有可对接的行业。{data.not_in_map.length > 0 &&
              "以下行业不在映射表里：" + data.not_in_map.map((n) => n.industry).join("、")}
          </p>
        </section>
      )}

      {data && (
        <section className="card">
          <h2>数据怎么来的 <span className="hint">三个来源, 各自边界不同</span></h2>
          <ul className="src-list">
            <li>
              <b>客户行业</b>
              <span className="mono">{data.sources.customers}</span>
              <span className="hint">
                crm 只交出「每个行业几个客户」，不交姓名/邮箱/电话 —— 这是它的 peer 面
                刻意守住的边界
              </span>
            </li>
            <li>
              <b>当日信号</b>
              <span className="mono">{data.sources.picks}</span>
              <span className="hint">scanner 当日选出的标的，日期 {data.as_of}</span>
            </li>
            <li>
              <b>行业映射</b>
              <span className="mono">{data.sources.industry_map}</span>
              <span className="hint">
                上游两个项目都没有行业字段，这张表是人工维护的
              </span>
            </li>
          </ul>

          <h3>请求轨迹</h3>
          <ol className="trace">
            {data.trace.map((t, i) => (
              <li key={i}>
                <span className="tag">{t.node}</span>
                <span>{t.note}</span>
              </li>
            ))}
          </ol>
        </section>
      )}
    </div>
  );
}
