/* Ask.tsx —— 可实际使用的 Agent：问一句，它自己去查
 *
 * 这一页和前面几页的根本区别：
 *   前面几页的流程是**写死的**（固定调哪几个接口），点按钮出固定报告。
 *   这一页把"该查什么"交给模型判断 —— 用户问什么，它自己决定调哪些节点。
 *
 * 所以界面必须把**过程**露出来，否则看起来就只是一个问答框：
 *   它调了什么（哪个能力）
 *   查了几轮（框架最多 8 轮）
 *   答案是怎么长出来的（流式，不是一个转圈然后整段蹦出来）
 *
 * ══ 为什么是流式 ═══════════════════════════════════════════════════
 * 数据源是 lume 框架原生的 POST /react/api/chat，它是 SSE：
 *   {"t":"note","d":"tool crm_stats({})"}     它决定调哪个工具
 *   {"t":"note","d":"round 2/8"}             进到第几轮
 *   {"t":"delta","d":"客户"}                  答案片段，逐段拼接
 *   {"t":"error","d":"..."}                  致命错误
 *   {"t":"done"}                             结束
 *
 * 这不是为了"看起来高级"。一次问答 2-6 秒、可能多轮，如果界面在期间
 * 完全没反馈，用户无法区分"它在查"和"它卡死了" —— 而这种不确定会让人
 * 反复点击，直接把 token 花掉几倍。工具调用和轮次必须在等待期间就显示。
 *
 * ══ 和上一版的区别 ═════════════════════════════════════════════════
 * 上一版调 /api/agent/ask（一个 Python 服务），返回一次性 JSON。
 * 那份 Python 手写了一遍 ReAct 循环 —— 而框架本来就自带。
 * 现在没有中间服务：没有"服务没起"这种失败方式，也不用额外跑进程。
 */
import React from "react";

const EXAMPLES = [
  "我们有多少客户，分布在哪些行业？",
  "哪个行业的客户推进得最靠前？",
  "今天有哪些标的在放信号？",
  "行情数据更新到哪天了？",
  "我网关今天烧了多少 token，成本怎么样？",
  "哪个 provider 在降级或延迟最高？",
];

/** 过程里的一条。tool/round 来自 SSE 的 note，其余是本地状态。 */
type Step =
  | { kind: "tool"; name: string; args: string }
  | { kind: "round"; n: string }
  | { kind: "error"; text: string };

/** HTML 转义（渲染前的第一道，防答案里的 < > 被当标签）。 */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** 拆一行 Markdown 表格：先去掉首尾的管道再按 | 切分并 trim。
 *  直接 split("|") 会因首尾 | 冒出两个空串，数据行的空单元格（合法）必须保留，
 *  所以先裁掉首尾管道再切 —— 表头与数据行用同一套逻辑，列数才对得上。 */
function splitTableRow(row: string): string[] {
  return row
    .replace(/^\s*\|/, "")
    .replace(/\|\s*$/, "")
    .split("|")
    .map((c) => c.trim());
}

/**
 * 轻量 Markdown 渲染（零依赖，覆盖 agent 答案常见语法）：
 * 代码块 / 标题 / 加粗 / 斜体 / 行内代码 / 链接 / 引用 / 有序无序列表 / 表格 / 分隔线。
 * 输出 HTML 字符串，交给 <div dangerouslySetInnerHTML>。类名带 md- 前缀，
 * 由 .answer-md 作用域样式控制（见 app.css）。
 */
function renderMarkdown(md: string): string {
  if (!md) return "";
  const codeBlocks: string[] = [];
  // 1) 先抽出 ``` 代码块，保护内容不被后续规则误伤
  md = md.replace(/```(\w*)\n?([\s\S]*?)```/g, (_, lang, code) => {
    codeBlocks.push(`<pre class="md-code"><code${lang ? ` class="language-${lang}"` : ""}>${escapeHtml(code.replace(/\n$/, ""))}</code></pre>`);
    return `\u0000CODE${codeBlocks.length - 1}\u0000`;
  });
  // 2) 整体转义
  md = escapeHtml(md);
  // 3) 行内语法
  md = md
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, "$1<em>$2</em>")
    .replace(/`([^`\n]+)`/g, "<code class=\"md-inline\">$1</code>")
    .replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
  // 4) 逐行处理块级语法
  const lines = md.split("\n");
  const out: string[] = [];
  let inUl = false;
  let inOl = false;
  let inQuote = false;
  let tableRows: string[] = [];
  const closeLists = () => {
    if (inUl) { out.push("</ul>"); inUl = false; }
    if (inOl) { out.push("</ol>"); inOl = false; }
  };
  const closeQuote = () => { if (inQuote) { out.push("</blockquote>"); inQuote = false; } };
  const flushTable = () => {
    if (tableRows.length < 2) {
      tableRows.forEach((r) => out.push(`<p>${r}</p>`));
      tableRows = [];
      return;
    }
    const header = splitTableRow(tableRows[0]);
    // 正常 Markdown 表格第 2 行是 |---| 分隔行（丢弃）；但若模型没输出分隔行，
    // 直接 slice(2) 会丢第一条数据。用"全格为短横线/冒号"识别分隔行。
    const isSep = (row: string) => row.split("|").map((c) => c.trim()).filter((c) => c).every((c) => /^:?-+:?$/.test(c));
    const body = tableRows.slice(1).filter((r) => !isSep(r));
    out.push("<table class=\"md-table\"><thead><tr>");
    header.forEach((c) => out.push(`<th>${c}</th>`));
    out.push("</tr></thead><tbody>");
    body.forEach((row) => {
      const cells = splitTableRow(row);
      out.push("<tr>");
      cells.forEach((c) => out.push(`<td>${c}</td>`));
      out.push("</tr>");
    });
    out.push("</tbody></table>");
    tableRows = [];
  };
  for (const raw of lines) {
    const line = raw.trim();
    if (line.startsWith("|") && line.endsWith("|")) {
      closeLists(); closeQuote();
      tableRows.push(line);
      continue;
    }
    flushTable();
    if (line === "") { closeLists(); closeQuote(); out.push(""); continue; }
    const hm = line.match(/^(#{1,6})\s+(.*)$/);
    if (hm) {
      closeLists(); closeQuote();
      const lvl = Math.min(hm[1].length, 6);
      out.push(`<h${lvl} class="md-h${lvl}">${hm[2]}</h${lvl}>`);
      continue;
    }
    if (/^(-{3,}|\*{3,})$/.test(line)) {
      closeLists(); closeQuote();
      out.push("<hr class=\"md-hr\">");
      continue;
    }
    if (line.startsWith(">")) {
      closeLists();
      if (!inQuote) { out.push("<blockquote class=\"md-quote\">"); inQuote = true; }
      out.push(`<p>${line.replace(/^>\s?/, "")}</p>`);
      continue;
    }
    closeQuote();
    if (/^[-*]\s+/.test(line)) {
      if (inOl) { out.push("</ol>"); inOl = false; }
      if (!inUl) { out.push("<ul class=\"md-ul\">"); inUl = true; }
      out.push(`<li>${line.replace(/^[-*]\s+/, "")}</li>`);
      continue;
    }
    if (/^\d+\.\s+/.test(line)) {
      if (inUl) { out.push("</ul>"); inUl = false; }
      if (!inOl) { out.push("<ol class=\"md-ol\">"); inOl = true; }
      out.push(`<li>${line.replace(/^\d+\.\s+/, "")}</li>`);
      continue;
    }
    closeLists();
    out.push(`<p>${line}</p>`);
  }
  closeLists(); closeQuote(); flushTable();
  let result = out.join("\n");
  // 5) 还原代码块
  result = result.replace(/\u0000CODE(\d+)\u0000/g, (_, i) => codeBlocks[parseInt(i, 10)] ?? "");
  // 折叠连续空行产生的空 <p>
  result = result.replace(/(<p>\s*<\/p>\s*)+/g, "");
  return result;
}

export function AskPanel(): React.ReactElement {
  const [q, setQ] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [err, setErr] = React.useState("");
  const [steps, setSteps] = React.useState<Step[]>([]);
  const [answer, setAnswer] = React.useState("");
  const [question, setQuestion] = React.useState("");
  // 每次提问自增，用来中途取消：上一个请求的 delta 不该落到新答案里。
  const runId = React.useRef(0);

  const ask = async (text?: string) => {
    const que = (text ?? q).trim();
    if (!que || busy) return;
    setQ(que);
    setBusy(true);
    setErr("");
    setSteps([]);
    setAnswer("");
    setQuestion(que);

    const my = ++runId.current;
    try {
      const res = await fetch("/react/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: que }),
      });
      if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);

      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = "";

      // SSE 是"行"协议，但网络分片不保证按行到达：一次 read 可能只拿到
      // 半行。所以必须攒缓冲、按 \n\n 切完整事件 —— 直接对每个 chunk 做
      // JSON.parse 会在长回答上随机失败，而失败的表现是"答案缺一段"。
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (my !== runId.current) return; // 已被新提问取代
        buf += dec.decode(value, { stream: true });

        let sep: number;
        while ((sep = buf.indexOf("\n\n")) >= 0) {
          const raw = buf.slice(0, sep);
          buf = buf.slice(sep + 2);
          const line = raw.split("\n").find((l) => l.startsWith("data:"));
          if (!line) continue;
          let ev: { t: string; d?: string };
          try {
            ev = JSON.parse(line.slice(5).trim());
          } catch {
            continue; // 半个事件，等下一片
          }
          if (ev.t === "delta" && ev.d) {
            setAnswer((prev) => prev + ev.d);
          } else if (ev.t === "note" && ev.d) {
            const d = ev.d;
            const m = /^tool\s+([A-Za-z0-9_]+)\((.*)\)$/.exec(d);
            if (m) {
              setSteps((prev) => [...prev, { kind: "tool", name: m[1], args: m[2] }]);
            } else if (d.startsWith("round ")) {
              setSteps((prev) => [...prev, { kind: "round", n: d.slice(6) }]);
            }
          } else if (ev.t === "error") {
            setSteps((prev) => [...prev, { kind: "error", text: ev.d || "未知错误" }]);
            setErr(ev.d || "调用失败");
          }
        }
      }
    } catch (e) {
      if (my === runId.current) setErr(String(e));
    } finally {
      if (my === runId.current) setBusy(false);
    }
  };

  const tools = steps.filter((s) => s.kind === "tool");

  return (
    <div className="grid">
      <section className="card intro-hero">
        <div className="scene-head">
          <div>
            <h2 className="hero-title">问一句，它自己去查</h2>
            <p className="hero-lede">
              它接到问题后<b>自己决定</b>要查 crm 还是 scanner、查几个，
              再基于拿到的数据作答。<b>调不到的信息它会说调不到</b>，不编。
            </p>
          </div>
        </div>

        <div className="ask-row">
          <input
            className="ask-input"
            value={q}
            placeholder="比如：哪个行业的客户推进得最靠前？"
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !busy) void ask(); }}
            disabled={busy}
          />
          <button className="primary slim" disabled={busy} onClick={() => void ask()}>
            {busy ? "思考中…" : "提问"}
          </button>
        </div>

        <div className="ask-examples">
          <span className="hint">试试：</span>
          {EXAMPLES.map((e) => (
            <button key={e} className="chip" disabled={busy} onClick={() => void ask(e)}>
              {e}
            </button>
          ))}
        </div>

        {busy && tools.length === 0 && (
          <p className="hint" style={{ marginTop: 10 }}>
            它在决定查什么。第一步通常 1–2 秒。
          </p>
        )}
        {err && <p className="note bad">{err}</p>}
      </section>

      {(steps.length > 0 || answer) && (
        <ProcessView question={question} steps={steps} answer={answer} busy={busy} />
      )}
    </div>
  );
}

/* 过程 + 结论。过程在前：让人先看到"怎么来的"，再看"是什么"。 */
function ProcessView({
  question, steps, answer, busy,
}: {
  question: string;
  steps: Step[];
  answer: string;
  busy: boolean;
}): React.ReactElement {
  const tools = steps.filter((s) => s.kind === "tool");
  const rounds = steps.filter((s) => s.kind === "round");

  return (
    <>
      <section className="card">
        <h2>
          过程
          <span className="hint">
            {tools.length} 次工具调用{rounds.length > 0 && ` · ${rounds.length + 1} 轮`}
          </span>
        </h2>

        <ol className="steps">
          {steps.map((s, i) => (
            <li key={i} className={"step kind-" + (s.kind === "tool" ? "call" : s.kind)}>
              {s.kind === "tool" && (
                <>
                  <span className="tag" data-tone="ok">调用</span>
                  <span className="step-detail">
                    <code>{s.name}</code>
                    <span className="hint">（它自己决定的）</span>
                  </span>
                </>
              )}
              {s.kind === "round" && (
                <>
                  <span className="tag">继续</span>
                  <span className="step-detail hint">
                    看到结果，判断还需要再查（第 {s.n} 轮）
                  </span>
                </>
              )}
              {s.kind === "error" && (
                <>
                  <span className="tag" data-tone="bad">中断</span>
                  <span className="step-detail">{s.text}</span>
                </>
              )}
            </li>
          ))}
          {answer && (
            <li className="step kind-answer">
              <span className="tag" data-tone="ok">作答</span>
              <span className="step-detail hint">基于以上数据组织回答</span>
            </li>
          )}
        </ol>
      </section>

      <section className="card answer-card">
        <h2>
          回答
          {question && <span className="hint">{question}</span>}
        </h2>
        <div className="answer-body">
          {answer ? (
            <div
              className="answer-md"
              dangerouslySetInnerHTML={{ __html: renderMarkdown(answer) }}
            />
          ) : (
            <p className="hint">{busy ? "正在组织回答…" : "（无内容）"}</p>
          )}
        </div>
        <p className="foot-note">
          回答由模型基于上述工具返回的数据组织，数据来自 crm / scanner / tsm-hub 三个节点（网关只读），
          不含客户明细。整个过程由 lume 框架的 ReAct 循环驱动，无额外服务进程。
        </p>
      </section>
    </>
  );
}
