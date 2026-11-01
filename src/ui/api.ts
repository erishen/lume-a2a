/* api.ts —— 与「别的节点」通讯的客户端
 *
 * 这里有三条完全不同的通道, 必须分清, 因为它们失败时的症状完全不同:
 *
 *  1) 同源 API(/api/state, /api/capabilities) —— 读本节点, 不带签名。
 *  2) A2A JSON-RPC(POST {target}/a2a) —— 标准协议, 明文无签名。
 *     失败典型: CORS / 404 / 服务没起。
 *  3) peer 签名直连(POST {target}/peer/invoke?sig=...) —— 需要共享密钥。
 *     失败典型: 401(密钥不一致或时钟漂移)。
 *
 * 浏览器直连另一个节点会撞 CORS: 本演示默认同源(两个节点都靠 lume 的
 * docroot 由任意一个节点伺服), 所以 UI 只对**同源**目标走 fetch。
 * 跨机调用放到服务端做(见 node.lume 的 relay), 那里没有 CORS 这回事 ——
 * 这也正是 peer 协议存在的理由: 机器之间不需要浏览器那套同源策略。
 */
import type { AgentCard, AgentTrace, Capability, EntityCoverage, EntityRecord, FleetNode, LLMNegotiation, Negotiation, NodeState, OutreachResult, Task } from "./types";

async function getJson<T>(url: string, init?: RequestInit): Promise<T> {
  const r = await fetch(url, { headers: { Accept: "application/json" }, ...init });
  if (!r.ok) {
    throw new Error(`${r.status} ${r.statusText}`);
  }
  return (await r.json()) as T;
}

export const api = {
  state: () => getJson<NodeState>("/api/state"),
  capabilities: () =>
    getJson<{ ok: boolean; node: string; capabilities: Capability[] }>("/api/capabilities"),

  /** Agent Card —— 走标准的发现路径, 不是私有 API */
  card: async (base = ""): Promise<AgentCard> =>
    getJson<AgentCard>(`${base}/.well-known/agent-card.json`),

  /** A2A message/send。返回完整的 Task(状态 + artifacts + trace) */
  a2aSend: async (
    base: string,
    params: {
      text: string;
      capability?: string;
      args?: Record<string, unknown>;
      contextId?: string;
      /** 非空 = 在同一 taskId 上续发(input-required 补齐参数用) */
      resumeId?: string;
    },
  ): Promise<Task> => {
    const body = {
      jsonrpc: "2.0",
      id: Date.now() % 100000,
      method: "message/send",
      params: {
        message: { role: "user", messageId: `ui-${Date.now()}`, parts: [{ kind: "text", text: params.text }] },
        contextId: params.contextId,
        // 带 resumeId 时服务端按「续发」处理: 合并参数、状态回到 working。
        // 不带就是新任务 —— 这个区分是规范要求的, 不能靠猜。
        ...(params.resumeId ? { id: params.resumeId } : {}),
        metadata: { capability: params.capability, args: params.args ?? {} },
      },
    };
    const r = await fetch(`${base}/a2a`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const j = (await r.json()) as { result?: Task; error?: { code: number; message: string } };
    if (j.error) throw new Error(`${j.error.code}: ${j.error.message}`);
    if (!j.result) throw new Error("响应里没有 result");
    return j.result;
  },

  tasksGet: async (base: string, id: string): Promise<Task> => {
    const r = await fetch(`${base}/a2a`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tasks/get", params: { id } }),
    });
    const j = (await r.json()) as { result?: Task; error?: { message: string } };
    if (j.error) throw new Error(j.error.message);
    return j.result as Task;
  },

  /** 取消任务。已终结的任务会被拒(-32002)—— 取消不是"改个状态就算数"。 */
  tasksCancel: async (base: string, id: string): Promise<Task> => {
    const r = await fetch(`${base}/a2a`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tasks/cancel", params: { id } }),
    });
    const j = (await r.json()) as { result?: Task; error?: { message: string } };
    if (j.error) throw new Error(j.error.message);
    return j.result as Task;
  },

  /**
   * peer 签名直连 —— 只对**同源**可用。
   *
   * 为什么浏览器不自己签: 签名需要 PEER_SHARED, 把它放到前端等于把密钥
   * 发给每个访问者。所以同源调用走服务端的 /peer/* 路由, 由服务端代签
   * (浏览器只发业务参数)。跨机调用同理, 走 relay 能力。
   */


  /** LLM 版协商（读快照；未运行时 ready=false） */
  negotiateLLM: () =>
    getJson<{ ok: boolean; ready: boolean; result?: LLMNegotiation; error?: string }>(
      "/api/negotiate/llm",
    ),

  /** A2A 协商：两个 agent 多轮提案/否决/让步，返回完整对话记录 */
  negotiate: (goal: string) =>
    getJson<{ ok: boolean; result: Negotiation }>(
      `/api/negotiate?goal=${encodeURIComponent(goal)}`,
    ),

  // 问答不走这里: 它直连框架原生的 POST /react/api/chat(SSE 流式),
  // 见 Ask.tsx。这里没有封装, 是因为 getJson 会把整个响应体读完再返回,
  // 而流式的价值恰恰在于"边收边显示" —— 包一层反而把它退化成一次性。

  /** Agent 之间的调用流水(来自真实埋点) */
  agentTrace: (n = 80) =>
    getJson<AgentTrace>(`/api/agent/trace?n=${n}`),

  /** 客户经营: 行业级联系由头(不含任何证券代码) */
  outreach: () => getJson<OutreachResult>("/api/outreach"),

  /** 实体对齐度：索引覆盖了多少、缺口在哪 */
  entityCoverage: () => getJson<EntityCoverage>("/api/entity/coverage"),

  /** 索引里的全部实体 */
  entityStats: () =>
    getJson<{ ok: boolean; stats: unknown; entities: EntityRecord[] }>("/api/entity/stats"),

  /** 真实节点探测(crm / scanner) */
  fleet: () =>
    getJson<{ ok: boolean; self: string; mode: string; nodes: FleetNode[] }>("/api/fleet"),

  /** 在真实节点上执行它自己声明的能力 */
  fleetInvoke: (node: string, capability: string) =>
    getJson<{ ok: boolean; node: string; capability: string; result: unknown; error: string }>(
      "/api/fleet/invoke",
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ node, capability }) },
    ),
  peerInvoke: async (tool: string, args: Record<string, unknown>) =>
    getJson<{ ok: boolean; state: string; result: string; error?: string }>(
      "/api/local-invoke",
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ tool, arguments: args }) },
    ),
};
