# lume-a2a — 两个 lume 节点之间的 A2A 通讯演示
#
# 常用:
#   make install    一次性: 前端依赖软链到 ../lume/frontend/node_modules
#   make build      构建前端(tsc 类型检查 + esbuild → www/)
#   make dev        两个节点一起起(热更: 改 .lume 自动重启, 改 .tsx 自动重打包)
#   make verify     端到端验收(起两个临时节点跑 20 条断言, 跑完关掉)
#   make check      只做类型检查(.lume + .tsx)
#   make stop       停掉 dev 起的两个节点
#
# 本机自定义值放 .env(已 gitignore); 公开默认全部用通用示例。
-include .env

LUME   ?= ../lume/bin/lume
PORT_A ?= 18190
PORT_B ?= 18191
SHARED ?= dev-secret
BOX_PY ?= python3
A2A_PORT ?= 10190
# CRM 主服务地址(seed 用)。注意不是 peer 端口: seed 走的是 CRM 的 /api/*
CRM_HOST ?= 127.0.0.1:11080
ESBUILD := ./node_modules/.bin/esbuild
TSC     := ./node_modules/.bin/tsc

default: dev

install:
	@if [ ! -e node_modules ]; then ln -s ../lume/frontend/node_modules node_modules; fi
	@echo "✔ node_modules 就绪"

build: install
	@$(TSC) --noEmit -p tsconfig.json
	@$(ESBUILD) src/ui/main.tsx --bundle --minify --format=esm --jsx=automatic --outfile=www/app.js
	@$(ESBUILD) src/ui/app.css --minify --outfile=www/app.css
	@echo "✔ www/app.js www/app.css"

check:
	@$(LUME) --check node.lume
	@$(LUME) --check src/a2a.lume
	@$(LUME) --check src/agent.lume
	@$(LUME) --check src/catalog.lume
	@$(LUME) --check src/proto_encode.lume
	@# 验收/闸门脚本也纳入检查: 它们最容易在重构后悄悄失效,
	@# 而失效的表现是"验收全绿"——比红灯更危险。
	@$(LUME) --check scripts/probe.lume
	@$(LUME) --check scripts/check_public.lume
	@$(LUME) --check scripts/seed_crm.lume
	@$(TSC) --noEmit -p tsconfig.json
	@echo "✔ 类型检查通过"

# 两个节点同源伺服: 打开 http://127.0.0.1:$(PORT_A) 就是完整控制台,
# 「对端」填 http://127.0.0.1:$(PORT_B) 即可跨节点调用。
dev: install
	@echo "▶ node-a :$(PORT_A)  node-b :$(PORT_B)"
	@echo "  控制台 http://127.0.0.1:$(PORT_A)"
	@PEER_SHARED=$(SHARED) PEER_NAME=node-a PEER_PORT=$(PORT_A) $(LUME) --watch node.lume & \
	 $(ESBUILD) src/ui/main.tsx --bundle --format=esm --jsx=automatic --outfile=www/app.js --watch & \
	 $(ESBUILD) src/ui/app.css --outfile=www/app.css --watch & \
	 PEER_SHARED=$(SHARED) PEER_NAME=node-b PEER_PORT=$(PORT_B) $(LUME) --watch node.lume & \
	 wait

# 单项启动(调试某一侧时用)
serve-a:
	@PEER_SHARED=$(SHARED) PEER_NAME=node-a PEER_PORT=$(PORT_A) $(LUME) --watch node.lume

serve-b:
	@PEER_SHARED=$(SHARED) PEER_NAME=node-b PEER_PORT=$(PORT_B) $(LUME) --watch node.lume

verify: build
	@bash scripts/verify.sh $(PORT_A) $(PORT_B)

stop:
	@pkill -f "node.lume" 2>/dev/null || true
	@pkill -f "esbuild src/ui/main.tsx" 2>/dev/null || true
	@echo "已停(若端口仍被占用: lsof -ti tcp:$(PORT_A) | xargs kill)"

.PHONY: default install build check dev serve-a serve-b verify stop docker-up docker-down docker-logs docker-verify worker worker-once fleet-verify open privacy seed ask

# ── Docker ────────────────────────────────────────────────────────────
# 两个服务共用同一个镜像(lume-a2a), 只靠 PEER_NAME 区分角色 —— 否则
# 任何一次改动都可能只 rebuild 了一边, 出现"A 能调 B, B 调不回 A"。
DOCKER_A ?= 10190
DOCKER_B ?= 10191

docker-up: build
	@# 提示词从文件读进环境变量: compose 只认字符串, 不认文件路径。
	@# 用 python 读并转义(不是 sed 拼接): 多行值要变成字面 \n 才是合法的
	@# 单行环境变量, 而 sed 的多层转义在不同 shell 上行为不一致。
	@LLM_SYSTEM_EXTRA="$$("$(BOX_PY)" -c 'import json,sys;print(json.dumps(open("prompts/agent_ask.md",encoding="utf-8").read())[1:-1])')" \
	 docker compose up -d --build
	@echo "  控制台 http://127.0.0.1:$(DOCKER_A)"

docker-down:
	@docker compose down --remove-orphans

docker-logs:
	@docker compose logs -f --tail 40

# 验收容器里的两个节点。后两个参数是「节点内部看对端」的地址 ——
# 容器网络里是服务名, 不是宿主的 127.0.0.1:端口。
docker-verify:
	@# 签名由 lume-core 的 peer.signed_url 负责, 所以要先声明本探测节点的身份。
	@PEER_NAME=node-a PEER_SHARED=dev-secret \
	 $(LUME) scripts/probe.lume $(DOCKER_A) $(DOCKER_B) dev-secret node-b:18190 node-a:18190

# 长任务推进器。跑在**宿主**上(容器里没有 python3, 也不该有):
# lume 无 spawn/exec, 后台执行必须由外部进程承担。
#   make worker        常驻(每 2s 扫一轮), 演示长任务时需要它
#   make worker-once   只跑一轮(调试/CI)
worker:
	@"$(BOX_PY)" scripts/a2a_worker.py --dir data --loop

worker-once:
	@"$(BOX_PY)" scripts/a2a_worker.py --dir data --once

# ── 真实节点(crm / scanner) ──────────────────────────────────────────
# 这两个是已经跑着的真实项目, 各自的 peer 服务在 18102 / 18103。
# 先确认它们在线, 再跑本节点。
fleet-verify:
	@"$(BOX_PY)" scripts/verify_fleet.py http://127.0.0.1:$(A2A_PORT)

# 打开控制台(默认落到「真实节点」页)
open:
	@open http://127.0.0.1:$(A2A_PORT) 2>/dev/null || echo "http://127.0.0.1:$(A2A_PORT)"

# 开原前的闸门: 仓库里不得出现真实凭据。发布前跑一次。
privacy:
	@"$(LUME)" scripts/check_public.lume

# 给 CRM 补 6 个客户, 让「客户行业 × 当日信号」有交集可看。
# 幂等: 已存在同名公司会跳过。写操作需要 CRM 以可写模式启动
# (LUME_CRM_READONLY= docker compose up -d crm), 否则返回 403。
seed:
	@"$(LUME)" scripts/seed_crm.lume $(CRM_HOST)

# ── LLM 版协商 ────────────────────────────────────────────────────────
# 两个 agent 由 deepseek 扮演, 事实分别来自 crm / scanner 两个 peer 节点。
# 一轮 5-20 秒, 整场约 30-60 秒; 结果写 data/self/llm-negotiation.json,
# 控制台读快照(不现场跑模型, 否则会占满 lume 的 2 个 worker)。
llm-negotiate:
	@"$(BOX_PY)" scripts/llm_negotiate.py

# 跨项目数据一致性: crm 的 API / peer / 宿主文件必须是同一份库。
# 这个问题出现过两次(主服务挂卷、peer 挂宿主), 每次表现都是
# "数字对不上一点点", 没人会往挂载上想。放在这里是因为本项目正是
# 那个受影响者 —— peer 读到什么, 我们的推荐就拿什么。
consistency:
	@"$(BOX_PY)" ../lume-crm/scripts/check_data_consistency.py

# ── 可用的 Agent ──────────────────────────────────────────────────────
# 问答走**框架原生**的 POST /react/api/chat(SSE), 工具注册在 src/agent.lume。
# 没有独立服务进程, 因此没有"服务没起导致提问失败"这种故障 —— 它就在
# 站点里。早先这里有个 scripts/agent_server.py + agent_chat.py, 用 Python
# 手写了一遍 ReAct 循环; 那是框架本来就有的能力, 已删除(见 src/agent.lume 头注释)。
#
# 命令行试一次: 直连聊天端点, 把 SSE 打成人看得懂的样子。
#   make ask Q="我们的客户有多少"
ask:
	@curl -sN -X POST http://127.0.0.1:$(A2A_PORT)/react/api/chat \
	  -H 'Content-Type: application/json' \
	  -d "{\"message\":\"$(Q)\"}" \
	  | "$(BOX_PY)" scripts/sse_pretty.py
