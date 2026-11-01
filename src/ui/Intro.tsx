/* ⚠️ 已退役 —— UI 简化时移出导航。
 * 保留文件便于回看; 不被 App.tsx 引用, 不参与构建。
 * Intro: 内容与首页重复。Fleet: 节点状态已收进顶栏。
 * 确认无需回看后可删除整个文件。*/

/* Intro.tsx —— 首屏: 先讲清"这是什么、为什么要有", 再让人点
 *
 * 之前的版本一上来就是 crm / scanner 两张卡片 + 一堆调用按钮, 对**第一次
 * 打开的人**等于: "我不认识这两个东西, 也不知道它俩凑一起要干什么"。
 *
 * 所以这一屏只做三件事:
 *   1. 一句话说清这是什么(用对比句, 不用术语)
 *   2. 现场对比"普通 HTTP API" 与 "peer/A2A" 的差别 —— 同一个 CRM,
 *      一个 404 一个能取数, 这个反差比任何解释都直接
 *   3. 给出三条可以马上点的路
 *
 * 刻意不写"A2A 是 Google 提出的 agent 间协议"这类背景: 那不是读者此刻
 * 的疑问。他的疑问是"我有个 HTTP 接口了, 为什么还要这个"。
 */
import React from "react";

export function Intro({
  onGoOutreach,
  onGoNegotiate,
  onGoFleet,
}: {
  onGoOutreach: () => void;
  onGoNegotiate: () => void;
  onGoFleet: () => void;
}): React.ReactElement {
  return (
    <div className="grid">
      <section className="card intro-hero">
        <h2 className="hero-title">两个已经跑着的项目，怎么互相调用？</h2>
        <p className="hero-lede">
          下面是真实的 <b>lume-crm</b>（客户/商机）和 <b>lume-scanner</b>（行情信号/选股），
          两个项目互不认识彼此的代码。这个页面做的事只有一件：
          <b>让它们互相发现，并调用对方的能力</b>。
        </p>
      </section>

      <section className="card">
        <h2>那为什么不直接调它的 HTTP 接口？</h2>
        <p className="why">
          因为真实的调用方往往<b>不认识</b>对方长什么样。它只知道「我需要客户数据」，
          不知道对方到底有个 <code>/api/stats</code> 还是 <code>/api/v2/report</code>，
          也不知道有没有权限。
        </p>

        <div className="compare">
          <div className="compare-col bad">
            <h3>普通 HTTP</h3>
            <ul>
              <li>调用方要<b>预先知道</b>路径与字段</li>
              <li>对方改个字段名，调用方就崩</li>
              <li>没有身份概念，谁拿到地址都能调</li>
              <li>只会「成功/失败」，不会说「我还缺参数」</li>
            </ul>
          </div>
          <div className="compare-col good">
            <h3>peer / A2A</h3>
            <ul>
              <li>对方<b>自己声明</b>「我能做什么」（Agent Card）</li>
              <li>签名绑定到<b>具体这个节点</b>，冒充不了</li>
              <li>缺参数会<b>反问</b>，补上后同一个任务继续</li>
              <li>任务可查询、可取消、有历史</li>
            </ul>
          </div>
        </div>

        <button className="primary slim" style={{ marginTop: 14 }} onClick={onGoOutreach}>
          看它实际在做什么 →
        </button>
      </section>

      <section className="card">
        <h2>从哪看起</h2>
        <ol className="paths">
          <li>
            <button className="link" onClick={onGoOutreach}>
              ① 客户经营
            </button>
            <span className="hint">
              行业动向 × 客户覆盖 → 今天该联系谁。主体是客户，不碰个股
            </span>
          </li>
          <li>
            <button className="link" onClick={onGoNegotiate}>
              ② A2A 协商
            </button>
            <span className="hint">
              两个 agent 各持约束，提案–否决–让步，谈出一个可行解
            </span>
          </li>
          <li>
            <button className="link" onClick={onGoFleet}>
              ③ 真实节点
            </button>
            <span className="hint">
              看 crm / scanner 的实时状态与它们自己声明的能力
            </span>
          </li>
        </ol>
      </section>
    </div>
  );
}
