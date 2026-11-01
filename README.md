# lume-a2a — 跨项目的 A2A peer 通讯演示

> ## ⚠️ 技术演示，不是投资工具
>
> 本项目**只用于验证 A2A 协议与多智能体协商机制**，全部数据为演示数据。
>
> 演示里出现的「具体证券 + 特定客户群 + 推荐理由」这个组合，正是**证券投资咨询业务**
> 的核心特征。面向客户提供个股建议在境内须持牌经营。
>
> - **不构成任何投资建议**，不得用于向真实客户提供买卖指引
> - 若要产品化，需要：投顾牌照、投资者适当性匹配、留痕与回溯、数据源授权
> - 页面顶部有常驻提示，不可关闭——**截图传出去时提示必须还在**

用 **lume**(服务端) + **lume-core**(语言与 `lib/peer.lume`) + **React** 搭的控制台，
**直接调用两个真实运行的 lume 应用**：

| 节点 | 项目 | 真实能力 |
|---|---|---|
| `crm` | [lume-crm](https://github.com/erishen/lume-crm) | `crm.stats`（客户/商机/管道金额）、`crm.pipeline`（阶段分布） |
| `scanner` | [lume-scanner](https://github.com/erishen/lume-scanner) | `scanner.meta`、`scanner.signals`（信号共振）、`scanner.picks`（选股） |

## 跑起来需要什么

Docker 一条命令（`make docker-up`）只需要本机和 `.env`，不用先 clone 别的仓库 ——
`lume` 二进制与 `lume-core/lib` 都按版本从 GitHub release 取。

**但本地开发（`make dev` / `make check`）需要同级目录**，因为源码里写的是相对
import（`../lume-core/lib/peer.lume`），而 `Makefile` 的 `LUME` 默认取
`../lume/bin/lume`：

```
work/lume/
├── lume/          # 语言与运行时（提供 bin/lume）
├── lume-core/     # lib/peer.lume 等共享模块
├── lume-crm/      # 被调用的真实节点（peer 端口 18102）
├── lume-scanner/  # 被调用的真实节点（peer 端口 18103）
└── lume-a2a/      # 本项目
```

```bash
git clone https://github.com/erishen/lume        ../lume
git clone https://github.com/erishen/lume-core   ../lume-core
git clone https://github.com/erishen/lume-crm    ../lume-crm
git clone https://github.com/erishen/lume-scanner ../lume-scanner
```

少任何一个，`make check` 会报 `cannot resolve import` 或找不到 `bin/lume` ——
那是在告诉你缺目录，不是代码坏了。

## 这个项目干什么

**今天该联系哪个行业的客户，由头是什么。**

销售卡住的往往不是「不知道该推什么」，而是**手上几十个客户，今天该主动联系谁**。
scanner 知道「哪个行业今天不平静」，crm 知道「这个行业有哪些客户在跟进」——
这份知识跨在两个系统上，谁都单独拿不出来。

```
行业整体动向（scanner，聚合到行业，不下探个股）
     ×
该行业在跟进中的客户数（crm，只给计数，不给姓名/邮箱/电话）
     ↓
今日联系清单：哪个行业、几个客户、由头一句话
```

**输出只到行业级别，不含任何证券代码、不含买卖方向。**

这不是措辞上的克制，而是产品定位：

| | 主体 | 输出 | 性质 |
|---|---|---|---|
| 荐股工具 | 证券 | 「该推哪只票」 | 面向客户即属证券投资咨询，需持牌 |
| **客户经营工具（本项目）** | **客户** | **「今天联系谁、由头是什么」** | 决定权留给销售与客户 |

原来的版本做的是前者。改成后者之后，同一个数据组合的用途变了 ——
从「告诉客户买什么」变成「提示销售什么时候开口」。

**关键点：两边都没交出明细。** crm 只给「金融 1 个客户、信息技术 1 个客户」，
scanner 只给行业级的聚合动向。判定「该联系哪个行业」根本不需要知道客户叫什么 ——
这正是真实跨系统协作该有的样子。

## 项目结构（收敛后）

早期版本为了把协议跑通，堆了 7 个演示能力（echo / aggregate / relay / plan / report / batch）
和两条业务链路。收敛时做了减法：**只留真做的事**。

**对外声明的 4 个能力**（Agent Card 与 `/api/capabilities` 同源）：

| 能力 | 作用 | 边界 |
|---|---|---|
| `sector.movement` | 行业级动向（涨跌家数、平均涨跌、样本量） | 不下探个股 |
| `customer.reach` | 某行业有多少客户在跟进 | 只有计数，无姓名/邮箱/电话 |
| `entity.resolve` | 按 USCC / 证券代码 / 别名解析实体 | 不做模糊匹配 |
| `node.capabilities` | 自检：身份、能力、索引覆盖 | — |

**页面：**

| 页面 | 回答的问题 |
|---|---|
| **客户经营** | 今天该联系哪个行业的客户、由头是什么 |
| **A2A 协商** | 两个 agent 各持约束，怎么谈出一个可行解 |
| **实体对齐** | 用 USCC 做实体主键，当前覆盖多少、缺口在哪 |
| **这是什么 / 真实节点 / 节点接口** | 背景与自检 |

**已删除**（保留文件但已从构建与路由中移除）：

- `/api/promote` 荐股链路 —— 与「客户经营」定位冲突，且合规风险大
- `/api/compare`、演示场景页 —— 依赖已删的假能力，内容空洞
- `echo.roundtrip` / `relay.forward` 等 6 个演示能力 —— 只为协议自测而造，会误导读者判断项目重心

被删除的代码体积约 **1100 行**，保留了验收侧 56 条断言中的核心部分。

## A2A 协商：两个 agent 谈出一个方案

**这一节回答的是「为什么需要两个 agent，一个不够吗」。**

前面几页不管多复杂，本质都是**单方决策**：客户 → 行业 → 标的 → 按分数排。
那是一段固定规则，换成一个 SQL join 也能做出来 —— 不需要 agent。

真正的 A2A 是**双方各自持有约束，谈出一个都能接受的方案**：

```
R1  选股侧  提议 五粮液（score 823，当日最高分）
    客户侧  否决 —— "该行业仅 1 个客户，低于下限 2"，
             并要求"换一个可触达数 ≥2 的行业"；同时让步：下限可降到 1
R2  选股侧  按新要求重筛，提议 东风股份（score 471.9）
    客户侧  接受 —— "行业汽车下有 1 个客户可触达（下限 1）"
```

**四件必须同时做到的事，少一件就退化成"通知"或"排序"：**

| | 为什么必须 |
|---|---|
| 双方都有否决权 | 只有一方能提、另一方只能接受，那不是协商 |
| 否决要带**理由 + 要求** | 只说"不行"，对面无从调整，谈判原地打转 |
| 让步是**双向**的 | 选股侧换掉最高分标的，客户侧把门槛从 2 降到 1。任一方硬扛，这个业务当下就无解 |
| 完整对话留痕 | 只给结论，就分不清它是谈出来的还是算出来的 |

**"最优"在这里的定义**：不是分数线最高，而是**在双方约束下能达成一致的最优**。
五粮液分数最高但被否了 —— 这正是单方排序与协商的区别。

### 两种引擎，同一页对比

| | **规则驱动** | **LLM 推理** |
|---|---|---|
| 代码 | `src/negotiate.lume` | `scripts/llm_negotiate.py` |
| 谁在判断 | 写死的 if 规则 | `deepseek-chat` 扮演两个角色 |
| 可复现 | 完全可复现 | **不保证**（同一输入两次可能不同结论） |
| 耗时 | 毫秒 | 30–60 秒 |
| 论证深度 | "触达 < 下限 2" | "该股四信号共振，量价与突破同时确认，领先第二名近一倍" |

控制台「A2A 协商」页顶部可以切换引擎，直接对比两种输出。

**LLM 版跑起来：**

```bash
make llm-negotiate      # 约 30-60 秒，写 data/self/llm-negotiation.json
```

控制台读**快照**而不是现场调模型——一轮协商 5–20 秒，而 lume 只有 2 个 worker，
一个慢请求就能卡住整个控制台。快照缺失时页面明确说"尚未运行"，不回退到规则版冒充。

### verify_fn：不让 LLM 评判自己

这是从 `frameworks/*-pse` 借来的核心思想。LLM 最容易犯的错是**引用不存在的数字**
（"该股 5 个信号共振"而实际是 2 个）。所以每轮结束都做程序化核对：

| 核对项 | 打回条件 |
|---|---|
| 标的代码 | 不在当日候选清单里（禁止编造标的） |
| 分数 / 信号数 | 与 A2A 取回的真实值不符 |
| 信号名 | 提到的信号不在该标的实际信号中 |
| 客户数 | 声称的触达数在真实行业分布里不存在 |
| 否决 | 没给 `requirement`（对方无从调整） |

不合规就打回重写，最多 3 次；三次不过则记 `blocked` 并终止，**不降级成"差不多的结果"**。

### 实测的一场协商（deepseek-chat，7 次调用 / 8504 tokens）

```
R1  选股侧  五粮液（score 823，唯一四信号共振）
    客户侧  否决：食品饮料仅 1 个客户 < 下限 2
             让步：若候选池凑不出，我方可降到 1
R2  选股侧  宁德时代（当日涨幅 7.8% 全场最高）
    客户侧  否决：电力设备不在 CRM 行业分布内，触达 0
             "行业对不上就无法落到具体客户"
R3  选股侧  接受该理由，改回五粮液
             "放弃宁德时代：涨幅最高但行业不可触达"
    客户侧  接受：1 ≥ 当前下限 1，四条硬约束全过
```

**双方都改变了立场**：选股侧放弃了两只更高分的标的，客户侧把门槛从 2 降到 1。

### 接 LLM 时踩到的三个坑（都是真的）

1. **说了让步没填数值** —— 客户侧文本写"可降至 1"但 `next_floor` 为空，对方拿不到这个让步。加了文本兜底提取，并在提示词里写死"说了就必须填"。
2. **黑名单让让步失效** —— 五粮液被否后进了永久黑名单，客户侧明明说"降门槛后可以再提"，选股侧却看不到它了。改成门槛一旦下降就放开黑名单。
3. **只给旧要求，不给新门槛** —— 选股侧按过时的 floor=2 判断"没有候选"。现在每轮显式告诉它当前 floor。

这三个都不是模型笨，是**编排逻辑没把谈判状态传对**。

## 实体对齐（往 Ontology 方向走的第一步）

**问题**：名字不可靠——会重名、会改、简称全称不一致。「中科能源科技」到底是谁？
靠字符串永远说不清，而且错得很安静。

**做法**：用**统一社会信用代码（USCC）**和**证券代码**做实体主键，建立
`客户公司 ↔ 上市公司` 的连接。新增 `src/entity.lume`（校验与规范化）与
`src/graph.lume`（索引与解析）。

三条硬规则：

1. **主键不是名字。** 名称只作别名，且别名必须人工登记。
2. **没有 USCC 就不认。** 不做名称模糊匹配——错配的代价不对称：漏配只是少一条
   推荐，错配会把 A 公司的商机挂到 B 公司的股票上，而使用者不会去核对。
3. **匹配要能解释。** 每条解析都带 `method`（uscc / code / alias）与原因。

三类结果分开返回，因为它们要不同的人去处理：

| 状态 | 含义 | 该怎么办 |
|---|---|---|
| `matched` | 标识齐全且命中索引 | 直接用 |
| `unresolved` | 缺标识，或未收录 | 补数据 |
| `invalid` | 填了 USCC 但校验位不过 | **修数据**（脏数据） |

> 校验位是真校验（GB 32100 算法）。实测救过一次：我记忆里的五粮液 USCC 末位是错的，
> 算法当场判不通过，后来查证真实值才补上。**如果没这层校验，错的代码会当成真标识用下去。**

**当前覆盖情况（页面「实体对齐」页可见）**

- 索引 **8 个实体，USCC 全部校验通过**（GB 32100 校验位 + 2 个以上公开来源交叉核对）
- 当日 8 只有信号的标的 **8/8 命中**，缺口清零
- 5 个有信号的行业全部是 `exact`；「信息技术」「金融」当日无信号，仍标 `keyword`
  ——**这个差别始终显示在界面上，不藏起来**

每条实体的 `source` 字段记录了 USCC 的核对来源（企查查 / 启信宝 / 天眼查 /
上交所公告），别人复核时知道该去哪查。

## 关于「行业」这个字段，必须说清楚

**上游两个项目都没有行业字段。** scanner 的标的只有代码/名称/价格/信号/评分，
crm 的客户只有姓名/公司/管道金额。

实体索引能提供 `exact` 的依据，但目前只覆盖 3 家。其余行业仍依赖
`src/industry.lume` 的**人工映射表**（40 只标的 + 18 条公司名关键词规则）。
这件事写在页面上、也写在 `sources.industry_map` 里，因为把人工映射藏进业务代码，
读的人会以为行业是上游给的 —— 一旦某只票改行/被并购，没人知道该改哪里。

## 下一步该做什么（诚实版）

实体对齐才刚起头，按重要性排：

1. **给 crm 加 USCC 字段**——这是根上的缺失。没有它，客户永远只能靠名字猜。
2. **把当日信号标的补齐到索引**——现在 8 只里有 5 只没覆盖，补完 `basis` 才能大面积变 `exact`。
3. **关系层**：集团—子公司—标的。Ontology 的价值一大半在「沿关系跳」，现在只有一跳。
4. **对象级权限**：现在是节点级（能调就能调全部）。


当前数据的实际情况：CRM 的 4 个客户归到「金融」「信息技术」两个行业，而当日
scanner 的 8 只入选标的全在食品饮料/汽车/钢铁等行业。所以页面上这两个行业显示的是
**「9 只同行业潜在标的，今日 0 只有信号」** —— 这不是 bug，是当日真实结果。
把「潜在关注」也列出来，比显示一个空列表更有用；但每只都明确标了有没有信号，
否则它就退化成一张普通股票列表。

```
cp .env.example .env   # 填 PEER_ROOT(与 crm/scanner 一致)
make docker-up         # 起本节点, 控制台 http://127.0.0.1:10190
make fleet-verify      # 25 条断言: 在线 / 签名 / 真实字段 / 白名单 / 现场对比
```

## 为什么要接真实节点

自造的 echo / aggregate 只能证明「两台机器能互相发 HTTP」，证明不了 A2A 有用。
接上 crm 与 scanner 之后，验的是**两个独立项目能不能互相认出来并交换真实数据**，
而且这两个项目都公开可查，别人可以照着复现。

这条链路上有三道真实的门槛，任何一道过不去都表现为「调不通」：

1. **密钥模式要一致。** 两个真实节点跑的是 derived 模式
   （`key(node) = hmac_sha256(PEER_ROOT, "peer:" + node)`）。配 `PEER_SHARED`
   的话签名**算得出来但是错的**，对端一律回 `bad signature` —— 报错完全指不到
   「模式不匹配」。
2. **要登记。** 密钥正确仍会被拒：`unknown peer 'lume-a2a' (not in registry)`。
   这是身份可信层在起作用（防止拿自己的密钥冒充别人），不是 bug。
   两侧的 `.data/peers-identity.json` 需要加上本节点。
3. **容器里的 127.0.0.1 不是宿主。** crm/scanner 跑在宿主上，容器内要用
   `host.docker.internal:18102`。

## 接入真实节点（复现步骤）

```bash
# 1. 存档根密钥: 与 crm / scanner 的 PEER_ROOT 保持一致
cp .env.example .env && vi .env     # PEER_ROOT=...  PEER_NAME=lume-a2a

# 2. 在两侧注册表登记本节点(不加会 401: unknown peer)
#    编辑 lume-crm/.data/peers-identity.json 与 lume-scanner/.data/peers-identity.json
#    "peers": [..., "lume-a2a"]
#    注册表是实时读取的, 不需要重启对端

# 3. 起本节点
make docker-up
make fleet-verify
```

> ⚠️ **本仓库准备开源**，所以 `.env` 被 `.gitignore` 挡住，仓库里只有
> `.env.example`（字段名 + 说明，无真实值）。发布前跑 `make privacy`：
> 它会检查凭据是否泄漏到任何文件里。派生密钥一旦公开，任何人都能冒充任何节点签名。

## 三个协议场景（自造节点）

真实节点演示「能互访」，协议细节则由一对临时节点演示，默认在「场景」页，
点一下就能看到一次完整交互里的每一跳：

| 场景 | 演示的规范能力 | 看什么 |
|---|---|---|
| **① 多轮补全** | `input-required` + 同 taskId 续发 | 第一次只说主题 → 对端反问缺 `period`；补上后**还缺 `audience`**（不是一次问完）；补齐才产出。`history` 记满 3 轮 |
| **② 长任务** | `submitted → working → completed`、`tasks/get`、`tasks/cancel` | 提交立刻拿到 taskId 而**不等处理完**；轮询逐条看进度；中途取消后 worker 真的不再推进 |
| **③ 任务分解** | 能力发现 + 分工 | 只给目标，对端报「哪些自办、哪些要别的节点、哪些**没人会**」 |

三个都内置了一句「为什么这么做」，因为在同一处做错很难被发现：

- 缺参数时**猜一个默认值**接着跑 —— 会产出一份「看起来成功」的报告，调用方
  不知道数据是编的。这比直接报错危险得多。
- 长任务**占着连接等** —— 客户端会等到超时，而任务其实还在正常跑。
- 认不出的需求**假装覆盖** —— 得到一份缺内容的报告，而调用方以为完整。

另外补了 `message/stream`（真 SSE，`status-update` / `artifact-update` 按序到达，
末帧 `final=true`），让 Agent Card 里的 `streaming: true` 不再是空话 ——
**之前它是空话**，而夸报比不写更糟：客户端会等一条永远不来的流。

## 它演示了什么

单次「发过去→拿回来」看不出 A2A 的价值，只看得出两台机器能互相发 HTTP。
所以三个场景都刻意设计成**必须往返两次以上**：

| 场景 | 演示的规范能力 | 看什么 |
|---|---|---|
| **① 多轮补全** | `input-required` + 同 taskId 续发 | 第一次只说主题 → 对端反问缺 `period`；补上后**还缺 `audience`**（不是一次问完）；补齐才产出。`history` 记满 3 轮 |
| **② 长任务** | `submitted → working → completed`、`tasks/get`、`tasks/cancel` | 提交立刻拿到 taskId 而**不等处理完**；轮询逐条看进度；中途取消后 worker 真的不再推进 |
| **③ 任务分解** | 能力发现 + 分工 | 只给目标，对端报「哪些自办、哪些要别的节点、哪些**没人会**」 |

三个都内置了一句「为什么这么做」，因为在同一处做错很难被发现：

- 缺参数时**猜一个默认值**接着跑 —— 会产出一份「看起来成功」的报告，调用方
  不知道数据是编的。这比直接报错危险得多。
- 长任务**占着连接等** —— 客户端会等到超时，而任务其实还在正常跑。
- 认不出的需求**假装覆盖** —— 得到一份缺内容的报告，而调用方以为完整。

另外补了 `message/stream`（真 SSE，`status-update` / `artifact-update` 按序到达，
末帧 `final=true`），让 Agent Card 里的 `streaming: true` 不再是空话 ——
**之前它是空话**，而夸报比不写更糟：客户端会等一条永远不来的流。

## 它演示了什么

| 链路 | 协议 | 说明 |
|---|---|---|
| 发现 | `GET /.well-known/agent-card.json` | 标准 A2A 路径, 公开未认证。任何客户端不需要私有约定就能知道这个节点有什么能力 |
| 调用 | `POST /a2a`(JSON-RPC) | `message/send` / `tasks/get` / `tasks/cancel`。返回完整 Task(状态 + artifacts + 轨迹) |
| 直连 | `POST /peer/invoke`(HMAC 签名) | 局域网互信域的低开销通道, 签名覆盖 method + path + body |
| 多跳 | `POST /peer/relay` | A→B→C 转发, 带跳数上限 |

两条通道(peer 私有 / A2A 标准)**共用同一个 `dispatch()`**，所以不会出现
「card 里说有、点进去 404」这类两套口径的问题。

## Docker

```
make docker-up      # 构建 + 起两个容器
make docker-verify  # 对容器里的两个节点跑 20 条断言
make docker-down    # 停掉
```

| 服务 | 控制台 | 容器内地址 |
|---|---|---|
| node-a | http://127.0.0.1:10190 | `http://node-a:18190` |
| node-b | http://127.0.0.1:10191 | `http://node-b:18190` |

两个服务**共用同一个镜像** `lume-a2a`，只靠 `PEER_NAME` 区分角色 —— 否则任何
一次改动都可能只 rebuild 了一边，出现「A 能调 B、B 调不回 A」，而这种现象极难看出来。

三处必须显式处理、否则一定踩的：

1. **`PEER_PUBLIC_URL` 必须设成服务名。** 容器里 `127.0.0.1` 指向容器自己。
   不设的话 Agent Card 会宣告 `http://127.0.0.1:18190`，字段看起来全对，
   客户端照着连必然失败。
2. **宿主端口不能当作节点间地址。** 宿主的 `127.0.0.1:10191` 在 node-a 里是
   它自己。所以 `probe.py` 第 4/5 个参数单独传「节点内部视角」的地址
   （`make docker-verify` 已带好 `node-b:18190 node-a:18190`）。
3. **二进制必须来自源码构建，不能用 v0.11.0 release 包。** release 里没有
   `ed25519_pubkey`，而 `lume-core/lib/identity.lume` 模块级会调用它 ——
   容器起不来，报 `undefined variable 'ed25519_pubkey'`，重复重启。
   `vendor/` 里放的是源码构建产物（含 TLS 预热修复），见 `vendor/.lume-build`。

`lume-core/lib` 在镜像里放在**根目录** `/lume-core/lib`：源码写的是
`../lume-core/lib/peer.lume`，从 `/app` 解析出来就是这个位置。平铺到
`/app/lume-core` 会报 `cannot resolve import`。

## 「问 Agent」页：纯 lume，无额外进程

页面调框架原生的 `POST /react/api/chat`（SSE 流式），工具注册在
`src/agent.lume`。**没有独立服务进程，容器里也没有 python3。**

```
make ask Q="哪个行业的客户推进得最靠前？"   # 命令行试一次，看流式过程
```

### 它是怎么工作的

| 环节 | 谁负责 |
|---|---|
| 工具注册 `tool "name","desc",{schema},fn` | 本仓库 `src/agent.lume` |
| ReAct 多轮循环（默认 8 轮） | 框架 `agent.c` |
| 调模型（fork + exec curl，TLS 交给 curl） | 框架 |
| HMAC 签名 / 注册表校验 / trace 埋点 | `lume-core/lib/peer.lume` + `src/fleet.lume` |
| 答案流式下发 | `/react/api/chat` SSE |

每个工具只是 `fleet.invoke(...)` 的一行包装 —— 那是**跨节点调用的唯一入口**，
所以 Agent 页的「调用流水」能看到它自己决定发起的每一次调用。

SSE 事件：

```
data: {"t":"note","d":"tool crm_stages({})"}   它决定调哪个工具
data: {"t":"note","d":"round 2/8"}            进到第几轮
data: {"t":"delta","d":"信息技术"}             答案片段
data: {"t":"error","d":"..."} / {"t":"done"}
```

### 这段代码原来有 Python，为什么删了

早先有个 `scripts/agent_server.py` + `agent_chat.py`：宿主机上跑一个小 HTTP
服务，手写 ReAct 循环、工具表、JSON 协议、HMAC 签名。问题不在于"能不能跑"，
而在于**框架本来就自带这些**（`agent.c:762` 的循环、`interp.c:1452` 的
`hmac_sha256`）。那份 Python 是在已有能力之上又实现了一遍。

代价是实的：多一个进程 = 多一种"服务没起"的故障（页面报「Agent 服务不可达」，
而人分不清是没开还是代码坏了）；容器要多装 python3；那个 `threading.Lock`
在 `fork-per-connection` 下也**根本不起排队作用**（锁在进程内，两个请求是
两个 fork）。

删掉后镜像仍是 121MB，`docker exec lume-a2a python3` 是 `not found`。

### 踩过的坑

**工具名不能有小数点。** 节点侧能力是 `crm.stats`，但注册成工具必须写
`crm_stats` —— OpenAI 兼容接口要求 `function.name` 匹配 `^[a-zA-Z0-9_-]+$`，
带点号被上游回 `400 Invalid 'tools[0].function.name'`。本地看不出来（工具
注册成功、`tools()` 里也有），只有真发出去才炸，而报错文案指不到"名字里有个点"。

**`env()` 读不到 `LLM_API_KEY`。** 那是安全设计：名字含 `API_KEY`/`SECRET`
的变量一律返回 `null`，防止脚本把凭据读出来发走。所以不能用它判断"配置好了没"，
那个判断恒为 false，比不判断更误导。

## 架构

```
node.lume            路由 + JSON-RPC 解析 + 启动自检
src/a2a.lume         任务状态机 / Agent Card / dispatch(三条链路的唯一实现)
src/catalog.lume     能力目录(前端面板、Agent Card skills、派发 三处同一来源)
src/proto_encode.lume 帧编解码的纯函数(被服务端调用, 也便于单测)
src/ui/*              React 控制台(esbuild 打包到 www/)
scripts/verify.sh    端到端验收(起两个节点 → 跑断言 → 关掉)
scripts/probe.lume   断言本体(签名直接复用 peer.signed_url)
scripts/check_public.lume  开原前闸门: 仓库里不得出现真实凭据
scripts/seed_crm.lume      给 CRM 补演示客户(幂等)
```

签名/验签/单次请求全部复用 **`../lume-core/lib/peer.lume`** —— 不复制一份，
因为两份实现一定会漂移，而漂移的表现是「一边通过、一边 401」。

## 任务状态机

```
submitted ──▶ working ──▶ completed
                  └────▶ failed
                  └────▶ rejected      (未知能力 / 跳数超限)
   └──▶ input-required  (认不出意图, 要求客户端明确指定能力)
```

任务落盘在 `.data/a2a-tasks/<节点名>/<id>.json`。

**按节点名隔离**不是洁癖：两个节点若从同一目录启动，共用一份任务目录会互相
「看到对方的任务」，`tasks/get` 能把别的节点的任务查出来。实测踩过。

## 三个刻意的设计取舍

**1. 认不出意图就 `input-required`，不猜。**
猜错的代价是「看起来成功了但答非所问」，比多问一轮糟得多。

**2. 对端不可达标 `unreachable`，绝不填 0。**
这条来自 `lume-lan` 的实测：对端 `sql_query` 在并发写入时静默返回空，peer 把
`0` 当成事实转发，agent 于是回答「你的博客是空的」。拿不到就说拿不到。

**3. 环路保护用硬上限，不做环检测。**
每个节点只能看到自己收到的 `hops`，没有全局视野；检测环需要全局状态。
所以约定 `hops` 单调递增，到 3 直接拒。代价是合法长链路被截断，收益是两个
节点互转不会把 CPU 打满。

## 已知边界

- **明文传输**：lume 的 `http_*` 不支持自定义 CA，签名保证不可伪造/篡改，
  但**不加密**。别经此通道传密码、证件号。
- **防重放是时间窗级别**：同一 nonce 在 `PEER_SKEW_SECS` 窗口内重放仍会通过。
- **帧文本只保证 ASCII 保真**：lume 没有「取第 i 个字节的数值」的内建，
  非 ASCII 字符在 query 帧里会落成 `~3F`。需要无损传中文走 A2A 的 JSON body。
- **没有异步后台执行**：lume 无 `spawn`/`exec`，`http_*` 同步阻塞。
  本演示的 `message/send` 都是同步执行完再返回；长任务模型见 `lume-lan` 的
  `a2a_worker.py` 做法（登记 `submitted`，宿主进程推进）。
- **控制台的 `/api/*` 不鉴权**：只读 + 不含凭据，前提是只绑 `127.0.0.1`。

## 安全模型

```
sig = hmac_sha256(PEER_SHARED, node \n ts \n nonce \n scope)
GET  → scope = "GET "  + path
POST → scope = "POST " + path + "\n" + body
```

- 签名的**算法与拼接**完全沿用 `lib/peer.lume`，一个字都没改 —— 它已经出现在
  所有在跑的节点之间，改一次就是全网 401。
- 未配 `PEER_SHARED` / `PEER_ROOT` 时，peer 面**整体关闭**(fail-closed)，
  不是放行。`/peer/health` 的 `mode` 字段会如实报告实际生效的是哪一套。
- 浏览器**不持有密钥**：同源调用走 `/api/local-invoke` 由服务端代签；
  跨机调用走 `relay.forward`。这个代理只接受同源目标，否则它会变成一个
  打穿内网的开放代理。

## 能力一览

| 能力 | 类型 | 作用 |
|---|---|---|
| `node.overview` | query | 身份 / 签名模式 / 能力数 / uptime |
| `echo.roundtrip` | query | 回显 + 长度, 验证信封完整性与时延 |
| `facts.aggregate` | compute | 向多个对端取同一事实并标出不一致 |
| `relay.forward` | relay | 转发到下一跳, 带 hops 上限 |

新增能力只需改 `src/catalog.lume` + `src/a2a.lume` 的 `dispatch()` 一处分支，
面板与 Agent Card 会自动跟上。

## 验收

`make verify` 实际输出：

```
1) Agent Card(公开发现)        card 200 / name / skills / supportedInterfaces
2) A2A message/send            task / completed / artifacts
3) 认不出能力 → input-required  不猜能力 / 带提问消息
4) tasks/get                   查得到 / 不存在 → -32001
5) peer 签名直连               invoke ok
6) 错签必须被拒                错签 → unauthorized
7) 未知工具 → 白名单拒绝         unknown tool
8) 多跳 relay A → B            completed / 结果来自 node-b
9) 跳数超限 → rejected          hops-exceeded
10) facts.aggregate 双节点一致   reachable=2 / consistent
```

第 6 条是刻意加的：只测"对的签名能过"，等于没测签名。错签必须被拒，
才说明验签逻辑真的在跑。
