/* ⚠️ 已退役 —— 项目收敛时移除。
 * 保留文件是为了让历史讨论可追溯; 它不被任何页面引用, 也不参与构建。
 * 退役原因: 荐股语义(合规) / 无实际内容 / 依赖已删除的演示能力。
 * 确认无需回看后可以直接删除整个文件。*/

/* Scenarios.tsx —— 三个「多轮」场景, 每个都把 A2A 的一次完整交互摊开
 *
 * 为什么要做成引导式而不是一个自由表单:
 *   原来的「调用」面板什么都能填, 但看到的是一个孤立的结果。A2A 的价值恰恰
 *   在**往返过程**里 —— 缺参数反问、任务中途可取消、事件按序到达。这些用
 *   一个输入框 + 一个 JSON 输出是看不出来的。
 *
 * 所以每个场景都是一个"按钮 → 分步展开"的脚本: 点一下, 把它内部发生的
 * 每一跳依次显示出来, 让「为什么需要协议」一眼可见。
 */
import React from "react";
import type { CallRecord, Task, TaskState } from "./types";
import { STATE_LABEL, artifactText, stateTone } from "./types";
import { api } from "./api";

interface Step {
  label: string;
  detail: string;
  state?: TaskState | "info";
}

const STATE_OF = (s: string): TaskState | "info" =>
  ["submitted", "working", "input-required", "completed", "failed", "canceled", "rejected"].includes(s)
    ? (s as TaskState)
    : "info";

function useSteps() {
  const [steps, setSteps] = React.useState<Step[]>([]);
  const [busy, setBusy] = React.useState(false);
  const [finalTask, setFinalTask] = React.useState<Task | null>(null);
  const add = (s: Step) => setSteps((p) => [...p, s]);
  const reset = () => { setSteps([]); setFinalTask(null); };
  return { steps, busy, setBusy, finalTask, setFinalTask, add, reset };
}

/* ── 场景 1: 多轮补全 ─────────────────────────────────────────────── */
export function ScenarioMultiTurn({ onCall }: { onCall: (r: CallRecord) => void }): React.ReactElement {
  const s = useSteps();

  async function run() {
    s.reset();
    s.setBusy(true);
    try {
      // 第 1 轮: 故意只给主题 —— 模拟"人只说了半句"
      const t1 = await api.a2aSend("", {
        text: "帮我做份报告",
        capability: "report.compose",
        args: { subject: "Q3 销量" },
      });
      const ask1 = t1.status.message as { parts?: { text: string }[] } | undefined;
      s.add({
        label: "① 只说主题就发过去",
        detail: `对端回 ${STATE_LABEL[t1.status.state]}：「${ask1?.parts?.[0]?.text ?? ""}」`,
        state: STATE_OF(t1.status.state),
      });
      s.setFinalTask(t1);

      // 第 2 轮: 补一个参数, 另一个还缺 —— 说明它是逐项收敛的, 不是一次问完
      const t2 = await api.a2aSend("", {
        text: "周期 2026 Q3",
        capability: "report.compose",
        args: { period: "2026 Q3" },
        contextId: t1.contextId,
        resumeId: t1.id,
      });
      const ask2 = t2.status.message as { parts?: { text: string }[] } | undefined;
      s.add({
        label: "② 在同一 taskId 上补「周期」",
        detail: `仍缺一项：「${ask2?.parts?.[0]?.text ?? ""}」—— 注意「主题」没丢`,
        state: STATE_OF(t2.status.state),
      });

      // 第 3 轮: 补齐最后一个, 这次该出结果了
      const t3 = await api.a2aSend("", {
        text: "给管理层看",
        capability: "report.compose",
        args: { audience: "管理层" },
        contextId: t1.contextId,
        resumeId: t1.id,
      });
      s.add({
        label: "③ 补齐「读者」",
        detail: `产出完成, history 里有 ${t3.history.length} 条消息 —— 全过程可追溯`,
        state: STATE_OF(t3.status.state),
      });
      s.setFinalTask(t3);

      // 第 4 轮: 已终结的任务不能再续 —— 规范要求开新任务
      try {
        await api.a2aSend("", {
          text: "再改一下",
          capability: "report.compose",
          args: { audience: "全员" },
          contextId: t1.contextId,
          resumeId: t1.id,
        });
        s.add({ label: "④ 对已完成任务续发", detail: "（意外）居然接受了", state: "info" });
      } catch (e) {
        s.add({
          label: "④ 对已完成任务续发",
          detail: `被拒: ${String(e).slice(0, 80)} —— 任务不可变, 追问要开新任务`,
          state: "info",
        });
      }

      onCall({
        id: `s1-${Date.now()}`,
        at: Math.floor(Date.now() / 1000),
        capability: "report.compose",
        target: "self",
        transport: "a2a",
        state: t3.status.state,
        latencyMs: 0,
        taskId: t3.id,
      });
    } catch (e) {
      s.add({ label: "失败", detail: String(e), state: "info" });
    } finally {
      s.setBusy(false);
    }
  }

  return (
    <ScenarioCard
      title="① 多轮补全"
      tagline="缺参数就反问, 补齐后同一任务继续"
      why="很多实现遇到缺参数直接失败, 或自己猜个默认值接着跑。后者更糟 —— 用猜的参数产出一份「看起来成功」的报告, 而调用方完全不知道数据是编的。"
      steps={s.steps}
      busy={s.busy}
      onRun={run}
      runLabel="跑一遍"
      task={s.finalTask}
    />
  );
}

/* ── 场景 2: 长任务 + 取消 ────────────────────────────────────────── */
export function ScenarioLongTask({ onCall }: { onCall: (r: CallRecord) => void }): React.ReactElement {
  const s = useSteps();

  async function run(mode: "poll" | "cancel") {
    s.reset();
    s.setBusy(true);
    try {
      const t = await api.a2aSend("", {
        text: "批量处理",
        capability: "batch.process",
        args: { items: "订单-001,订单-002,订单-003", secs: 6 },
      });
      s.add({
        label: "① 提交",
        detail: `立即返回 ${STATE_LABEL[t.status.state]} + taskId ${t.id.slice(0, 10)}…（不等处理完）`,
        state: STATE_OF(t.status.state),
      });
      s.setFinalTask(t);

      if (mode === "cancel") {
        const c = await api.tasksCancel("", t.id);
        s.add({
          label: "② 中途取消",
          detail: `状态变为 ${STATE_LABEL[c.status.state]} —— 执行方下一轮扫到后就不再推进`,
          state: STATE_OF(c.status.state),
        });
        s.setFinalTask(c);
        onCall({ id: `s2-${Date.now()}`, at: Math.floor(Date.now() / 1000),
                 capability: "batch.process", target: "self", transport: "a2a",
                 state: c.status.state, latencyMs: 0, taskId: t.id });
        return;
      }

      // 轮询: 每 1.2s 问一次, 直到终结或超时
      let last = t;
      for (let i = 0; i < 30; i++) {
        await new Promise((r) => setTimeout(r, 1200));
        last = await api.tasksGet("", t.id);
        const st = last.status.state;
        const note = last.metadata?.trace?.slice(-1)[0]?.note ?? "";
        s.add({
          label: `② 轮询第 ${i + 1} 次`,
          detail: `${STATE_LABEL[st]}${note ? " · " + note : ""}`,
          state: STATE_OF(st),
        });
        if (["completed", "failed", "canceled"].includes(st)) break;
      }
      s.setFinalTask(last);
      onCall({ id: `s2-${Date.now()}`, at: Math.floor(Date.now() / 1000),
               capability: "batch.process", target: "self", transport: "a2a",
               state: last.status.state, latencyMs: 0, taskId: t.id });
    } catch (e) {
      s.add({ label: "失败", detail: String(e), state: "info" });
    } finally {
      s.setBusy(false);
    }
  }

  return (
    <ScenarioCard
      title="② 长任务"
      tagline="提交即返回, 轮询看进度, 中途可取消"
      why="lume 没有 spawn/exec, http_* 又是同步阻塞 —— 所以「后台慢慢跑」由宿主 worker 推进。任务落盘, 重启不丢; 取消真的生效, 而不是干完活才发现被取消。"
      steps={s.steps}
      busy={s.busy}
      onRun={() => void run("poll")}
      onCancel={() => void run("cancel")}
      runLabel="提交并轮询"
      cancelLabel="提交后取消"
      task={s.finalTask}
    />
  );
}

/* ── 场景 3: 任务分解 / 谁认领 ────────────────────────────────────── */
export function ScenarioPlan({ onCall }: { onCall: (r: CallRecord) => void }): React.ReactElement {
  const s = useSteps();

  async function run() {
    s.reset();
    s.setBusy(true);
    try {
      const t = await api.a2aSend("", {
        text: "产出季度经营报告",
        capability: "plan.split",
        args: { goal: "产出季度经营报告" },
      });
      s.add({
        label: "① 只给目标, 不说要调谁的什么工具",
        detail: "调用方不需要预先知道对端有什么能力 —— 这正是 A2A 存在的理由",
        state: "info",
      });
      let plan: { can_handle?: unknown[]; needs_other?: { need: string; capability: string; owner: string; reason?: string }[] } = {};
      try { plan = JSON.parse(artifactText(t)) as typeof plan; } catch { /* 非法 JSON 时留空 */ }
      const others = plan.needs_other ?? [];
      s.add({
        label: "② 对端回报分工",
        detail: `自办 ${plan.can_handle?.length ?? 0} 项, 需要协作 ${others.length} 项`,
        state: STATE_OF(t.status.state),
      });
      others.forEach((o) => {
        s.add({
          label: `   · ${o.need}`,
          detail: o.capability
            ? `→ ${o.owner} 的 ${o.capability}`
            : `→ 无人认领：${o.reason ?? ""}`,
          state: "info",
        });
      });
      s.setFinalTask(t);
      onCall({ id: `s3-${Date.now()}`, at: Math.floor(Date.now() / 1000),
               capability: "plan.split", target: "self", transport: "a2a",
               state: t.status.state, latencyMs: 0, taskId: t.id });
    } catch (e) {
      s.add({ label: "失败", detail: String(e), state: "info" });
    } finally {
      s.setBusy(false);
    }
  }

  return (
    <ScenarioCard
      title="③ 任务分解"
      tagline="对端按自己的库存报缺口, 认不出的如实说不认"
      why="「无人认领」这一项是故意留的: 假装覆盖了会得到一份缺内容的报告, 而调用方以为完整。说「我不会」比编一个结果有用。"
      steps={s.steps}
      busy={s.busy}
      onRun={run}
      runLabel="跑一遍"
      task={s.finalTask}
    />
  );
}

/* ── 共用卡片 ─────────────────────────────────────────────────────── */
function ScenarioCard(props: {
  title: string;
  tagline: string;
  why: string;
  steps: Step[];
  busy: boolean;
  onRun: () => void;
  onCancel?: () => void;
  runLabel: string;
  cancelLabel?: string;
  task: Task | null;
}): React.ReactElement {
  const { title, tagline, why, steps, busy, onRun, onCancel, runLabel, cancelLabel, task } = props;
  return (
    <section className="card scene">
      <div className="scene-head">
        <div>
          <h2>{title}</h2>
          <p className="tagline">{tagline}</p>
        </div>
        <div className="scene-actions">
          <button className="primary slim" disabled={busy} onClick={onRun}>
            {busy ? "运行中…" : runLabel}
          </button>
          {onCancel && (
            <button className="ghost slim" disabled={busy} onClick={onCancel}>
              {cancelLabel}
            </button>
          )}
        </div>
      </div>

      <p className="why">{why}</p>

      {steps.length > 0 && (
        <ol className="steps">
          {steps.map((st, i) => (
            <li key={i} className="step">
              <span className="step-label">{st.label}</span>
              {st.state && st.state !== "info" && (
                <span className="tag" data-tone={stateTone(st.state)}>
                  {STATE_LABEL[st.state] ?? st.state}
                </span>
              )}
              <span className="step-detail">{st.detail}</span>
            </li>
          ))}
        </ol>
      )}

      {task && task.artifacts.length > 0 && (
        <details className="result">
          <summary>最终产物</summary>
          <pre className="code">{pretty(artifactText(task))}</pre>
        </details>
      )}
    </section>
  );
}

function pretty(s: string): string {
  try { return JSON.stringify(JSON.parse(s), null, 2); } catch { return s; }
}
