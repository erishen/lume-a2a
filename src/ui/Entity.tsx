/* Entity.tsx —— 实体对齐面板: 这套东西现在有多可信, 一眼能看出
 *
 * 为什么单独一页, 而不是塞进业务场景里:
 *   「推荐结果」回答"该推哪只票"; 「实体对齐」回答"我凭什么相信它"。
 *   后者是前者的地基, 混在一起会让人只看到结论、看不到依据。
 *
 * 页面上的三个数字, 任何一个难看都必须如实显示:
 *   索引实体数        —— 太少就是太少
 *   USCC 校验通过率    —— 算法保证, 不是人工拍的最好凭据
 *   当日信号命中率     —— 索引覆盖不到的缺口在哪, 直接列出来
 */
import React from "react";
import { api } from "./api";
import type { EntityCoverage, EntityRecord } from "./types";

export function EntityPanel(): React.ReactElement {
  const [cov, setCov] = React.useState<EntityCoverage | null>(null);
  const [ents, setEnts] = React.useState<EntityRecord[]>([]);
  const [err, setErr] = React.useState("");
  const [busy, setBusy] = React.useState(false);

  const load = React.useCallback(async () => {
    setBusy(true);
    try {
      const [c, s] = await Promise.all([api.entityCoverage(), api.entityStats()]);
      setCov(c);
      setEnts(s.entities);
      setErr("");
    } catch (e) {
      setErr(String(e));
    } finally {
      setBusy(false);
    }
  }, []);

  React.useEffect(() => { void load(); }, [load]);

  const rate = cov && cov.scanned_total > 0
    ? Math.round((cov.matched_in_scan / cov.scanned_total) * 100)
    : 0;

  return (
    <div className="grid">
      <section className="card intro-hero">
        <div className="scene-head">
          <div>
            <h2 className="hero-title">实体对齐：把「客户」和「股票」认成同一个东西</h2>
            <p className="hero-lede">
              名字不可靠——会重名、会改、简称全称不一致。这里用
              <b>统一社会信用代码</b>与<b>证券代码</b>做实体主键，
              每一跳都靠稳定标识连接，而不是靠字符串像不像。
            </p>
          </div>
          <button className="ghost slim" disabled={busy} onClick={() => void load()}>
            {busy ? "统计中…" : "重新统计"}
          </button>
        </div>

        {cov && (
          <div className="kpis">
            <div className="kpi"><b>{cov.indexed}</b><span>索引实体</span></div>
            <div className="kpi ok"><b>{cov.verified_uscc}</b><span>USCC 校验通过</span></div>
            <div className="kpi"><b>{cov.matched_in_scan}/{cov.scanned_total}</b><span>当日信号命中索引</span></div>
            <div className="kpi"><b>{rate}%</b><span>信号覆盖率</span></div>
          </div>
        )}
        {err && <p className="note bad">{err}</p>}
      </section>

      <section className="card">
        <h2>索引里的实体 <span className="hint">主键：证券代码 + USCC</span></h2>
        {ents.length === 0 ? (
          <p className="hint">索引为空（.data/entity-index.json）</p>
        ) : (
          <table className="tbl">
            <thead>
              <tr><th>代码</th><th>名称</th><th>USCC</th><th>行业</th><th>别名</th></tr>
            </thead>
            <tbody>
              {ents.map((e) => (
                <tr key={e.code}>
                  <td className="mono">{e.code}</td>
                  <td><b>{e.name}</b></td>
                  <td className="mono hint">{e.uscc || "—"}</td>
                  <td><span className="tag">{e.industry || "—"}</span></td>
                  <td className="hint">{e.aliases?.join(" / ") || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="card">
        <h2>当日信号里索引没覆盖的 <span className="hint">缺口直接列出来</span></h2>
        {cov && cov.missing_in_scan.length > 0 ? (
          <ul className="gap-list">
            {cov.missing_in_scan.map((m) => (
              <li key={m.code}>
                <span className="mono">{m.code}</span>
                <span>{m.name}</span>
                <span className="hint">{m.reason}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="hint">没有缺口（当日信号全部在索引内）。</p>
        )}
        <p className="note">
          这些标的的行业只能靠关键词规则推断，不是查出来的。
          补齐方式：查到它们的统一社会信用代码后登记进索引
          （<code>POST /api/entity/upsert</code>，USCC 会做校验位校验）。
        </p>
      </section>
    </div>
  );
}
