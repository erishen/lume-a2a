/* 共享类型 —— 与服务端 src/a2a.lume、src/catalog.lume 的返回形状一一对应。
 *
 * 为什么集中放一处: 服务端改字段时, 只有这里需要跟着改, 编译器会把
 * 用到旧字段的地方全部标红。散落在各组件里的 any 则什么也不会提示。
 */

/** A2A 任务状态。值域取自规范, 不要自造。 */
export type TaskState =
  | "submitted"
  | "working"
  | "input-required"
  | "completed"
  | "failed"
  | "canceled"
  | "rejected";

export interface TextPart {
  kind: "text";
  text: string;
}

export interface Artifact {
  artifactId: string;
  parts: TextPart[];
}

export interface TraceEntry {
  node: string;
  at: number;
  note: string;
  cap?: string;
  hops?: number;
}

export interface Task {
  id: string;
  contextId: string;
  kind: "task";
  status: { state: TaskState; timestamp: string; message?: unknown };
  artifacts: Artifact[];
  history: unknown[];
  metadata: { capability?: string; hops?: number; trace?: TraceEntry[] };
  node: string;
  created: number;
  updated: number;
}

export interface NodeState {
  ok: boolean;
  node: string;
  mode: string;
  warnings: string[];
  base_url: string;
  ts: number;
  tasks: Task[];
}

export interface CapArg {
  k: string;
  label: string;
  required: boolean;
  sample: string;
}

export interface Capability {
  name: string;
  title: string;
  desc: string;
  args: CapArg[];
  latency_ms: number;
  kind: "query" | "compute" | "relay";
}

export interface AgentCard {
  name: string;
  description: string;
  version: string;
  supportedInterfaces: { protocolVersion: string; protocolBinding: string; url: string }[];
  url: string;
  skills: { id: string; name: string; description: string; tags: string[] }[];
  warnings?: string;
}

/** 一次调用在 UI 上的记录(不是协议对象, 只是给人看的流水) */
export interface CallRecord {
  id: string;
  at: number;
  capability: string;
  target: string;
  transport: "a2a" | "peer";
  state: TaskState | "error";
  latencyMs: number;
  taskId?: string;
  detail?: string;
  trace?: TraceEntry[];
}

export const STATE_LABEL: Record<string, string> = {
  submitted: "已提交",
  working: "处理中",
  "input-required": "待补充",
  completed: "已完成",
  failed: "失败",
  canceled: "已取消",
  rejected: "已拒绝",
  error: "错误",
};

export function stateTone(s: string): "ok" | "warn" | "bad" | "idle" {
  if (s === "completed") return "ok";
  if (s === "working" || s === "submitted") return "warn";
  if (s === "failed" || s === "error" || s === "rejected") return "bad";
  return "idle";
}

export function fmtTime(ts: number): string {
  const d = new Date(ts * 1000);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

/** artifact 正文(演示链路都是单 text part) */
export function artifactText(t: Task): string {
  const a = t.artifacts?.[0];
  return a?.parts?.[0]?.text ?? "";
}

/** 真实 peer 节点(crm / scanner)。字段与服务端 src/fleet.lume 的 probe() 一一对应。 */
export interface FleetTool {
  name: string;
  desc: string;
  when_to_use?: string;
}

export interface FleetNode {
  name: string;
  host: string;
  online: boolean;
  latency_ms: number;
  /** 为空表示在线; 非空时是**具体原因**(认证被拒 / 连不上), 不是笼统的 "offline" */
  error: string;
  mode: string;
  site: string;
  tools: FleetTool[];
  summary: string;
}

/** 业务场景: 客户行业 × 当日信号。与 src/promote.lume 的返回一一对应。 */
export interface PromoteTarget {
  code: string;
  name: string;
  industry: string;
  /** true = scanner 今日入选；false = 同行业潜在关注 */
  signaled: boolean;
  score: number;
  change: number;
  signals: string[];
}

export interface PromoteRec {
  industry: string;
  customers: number;
  /** exact=经实体索引(USCC/代码)确认; mixed=部分; keyword=仅靠公司名关键词 */
  basis: "exact" | "mixed" | "keyword";
  signal_count: number;
  target_count: number;
  targets: PromoteTarget[];
  reason: string;
}

export interface PromoteResult {
  as_of: string;
  coverage: {
    customers: number;
    customer_industries: number;
    industries_covered: number;
    industries_not_in_map: number;
    unclassified_customers: number;
  };
  recommendations: PromoteRec[];
  not_in_map: { industry: string; customers: number; reason: string }[];
  trace: { node: string; at: number; note: string }[];
  sources: { customers: string; picks: string; industry_map: string };
}

/** 实体索引中的一条（src/graph.lume 的 by_code 记录） */
export interface EntityRecord {
  code: string;
  name: string;
  uscc: string;
  industry: string;
  aliases: string[];
}

/** 对齐度报告（GET /api/entity/coverage） */
export interface EntityCoverage {
  indexed: number;
  verified_uscc: number;
  matched_in_scan: number;
  scanned_total: number;
  missing_in_scan: { code: string; name: string; reason: string }[];
}

/** A2A 协商的一轮发言。role 决定谁说的，action 决定说了什么。 */
export interface NegotiationRound {
  round: number;
  role: "scanner" | "crm";
  action: "propose" | "reject" | "accept" | "exhausted" | "blocked";
  name?: string;
  industry?: string;
  /** 否决原因码，让理由可归类、可统计 */
  code_reason?: string;
  text: string;
}

export interface NegotiationPlan {
  /** 只展示标的名称与指标 —— **不含证券代码**(合规: 见 strip_code)。 */
  name: string;
  score: number;
  change: number;
  signals?: string[];
  /** 达成一致时客户侧让步到的阶段要求(如「初步接洽」) */
  agreed_stage?: string;
}

export interface Negotiation {
  goal: string;
  rounds: NegotiationRound[];
  round_count: number;
  converged: boolean;
  plan: NegotiationPlan | null;
  verdict: string;
}

/** LLM 协商的一轮。比规则版多 requirement/concession 两个"谈判动作"。 */
export interface LLMRound extends NegotiationRound {
  /** 客户侧否决时给出的可执行要求 */
  requirement?: string;
  /** 任一方让出的条件（选股侧放弃的标的 / 客户侧降的门槛） */
  concession?: string;
}

export interface LLMNegotiation {
  ok: boolean;
  converged: boolean;
  round_count: number;
  rounds: LLMRound[];
  plan: NegotiationPlan | null;
  as_of: string;
  verdict: string;
  generated_at: number;
  llm: { model: string; calls: number; tokens: number };
  facts: { candidates: number; customer_count: number; industries: { industry: string; customers: number }[] };
}


/** 客户经营: 行业级联系由头。注意**没有**任何证券代码字段 —— 这是设计约束。 */
export interface OutreachItem {
  industry: string;
  customers: number;
  sample_size: number;
  headline: string;
  avg_change: number;
  has_momentum: boolean;
  avg_momentum: number;
  hook: string;
}

export interface OutreachResult {
  ok: boolean;
  items: OutreachItem[];
  skipped: { industry: string; reason: string }[];
  coverage: {
    industries_total: number;
    with_contact: number;
    skipped: number;
    min_sample: number;
  };
  boundary: string;
  error?: string;
}

/** 一次跨节点调用(来自 fleet.invoke 的埋点) */
export interface AgentEvent {
  ts: number;
  from: string;
  to: string;
  cap: string;
  ok: boolean;
  err: string;
  bytes: number;
  note: string;
}

export interface AgentTrace {
  ok: boolean;
  self: string;
  nodes: { name: string; host: string }[];
  stats: {
    window: number;
    ok: number;
    fail: number;
    total_bytes: number;
    by_cap: { cap: string; count: number }[];
    by_node: { node: string; count: number }[];
  };
  events: AgentEvent[];
}
