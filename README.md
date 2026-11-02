# lume-a2a — Cross-project A2A peer communication demo

> **English** | [中文](README.zh.md)

> ## ⚠️ Technical demo, not an investment tool
>
> This project exists **only to validate the A2A protocol and multi-agent negotiation
> mechanics**. All data is demo data.
>
> The combination of "specific securities + specific customer segments + recommendation
> rationale" that appears in the demo is precisely the core feature of **securities
> investment advisory business**. Providing individual-stock advice to clients requires
> a license in the jurisdiction.
>
> - **Not investment advice**; must not be used to give buy/sell guidance to real clients
> - To productize, you would need: investment advisory license, investor suitability
>   matching, record-keeping & audit trail, data-source licensing
> - There is a persistent banner at the top of the page that cannot be dismissed — it
>   **must still be visible when a screenshot is shared**

Built with **lume** (server) + **lume-core** (language and `lib/peer.lume`) + **React**
console, it **directly calls two real running lume applications**:

| Node | Project | Real capabilities |
|---|---|---|
| `crm` | [lume-crm](https://github.com/erishen/lume-crm) | `crm.stats` (customers / opportunities / pipeline value), `crm.pipeline` (stage distribution) |
| `scanner` | [lume-scanner](https://github.com/erishen/lume-scanner) | `scanner.meta`, `scanner.signals` (signal resonance), `scanner.picks` (stock selection) |

## What you need to run it

A one-line Docker command (`make docker-up`) needs only this machine and `.env` — no need
to clone other repos first. The `lume` binary and `lume-core/lib` are fetched by version
from GitHub releases.

**But local development (`make dev` / `make check`) requires sibling directories**, because
the source uses relative imports (`../lume-core/lib/peer.lume`), and the `Makefile`'s
`LUME` defaults to `../lume/bin/lume`:

```
work/lume/
├── lume/          # language & runtime (provides bin/lume)
├── lume-core/     # shared modules like lib/peer.lume
├── lume-crm/      # real node being called (peer port 18102)
├── lume-scanner/  # real node being called (peer port 18103)
└── lume-a2a/      # this project
```

```bash
git clone https://github.com/erishen/lume        ../lume
git clone https://github.com/erishen/lume-core   ../lume-core
git clone https://github.com/erishen/lume-crm    ../lume-crm
git clone https://github.com/erishen/lume-scanner ../lume-scanner
```

Missing any one of them, `make check` will report `cannot resolve import` or fail to find
`bin/lume` — that is telling you a directory is missing, not that the code is broken.

## What this project does

**Which industry's customers should be contacted today, and what the reason is.**

What blocks a salesperson is usually not "I don't know what to pitch," but **"I have
dozens of customers and I don't know who to proactively reach out to today."** The scanner
knows "which industry is restless today"; the CRM knows "which customers in that industry
are being followed" — this knowledge spans two systems, and neither can produce it alone.

```
Overall industry movement (scanner, aggregated to industry, not drilling into individual stocks)
     ×
Number of in-progress customers in that industry (crm, counts only, no names/emails/phones)
     ↓
Today's contact list: which industry, how many customers, one-line reason
```

**Output stops at the industry level — no security codes, no buy/sell direction.**

This is not careful wording; it is product positioning:

| | Subject | Output | Nature |
|---|---|---|---|
| Stock-picking tool | Securities | "Which stock to pitch" | Facing clients = securities investment advisory, requires a license |
| **Customer-management tool (this project)** | **Customer** | **"Who to contact today, and why"** | Decision left to the salesperson & customer |

The original version did the former. After switching to the latter, the same data
combination serves a different purpose — from "telling the customer what to buy" to
"hinting the salesperson when to speak up."

**Key point: neither side hands over details.** The CRM only gives "Finance: 1 customer,
IT: 1 customer"; the scanner only gives industry-level aggregate movement. Deciding "which
industry to contact" doesn't require knowing any customer's name at all — this is what real
cross-system collaboration should look like.

## Project structure (after consolidation)

Early versions piled up 7 demo capabilities (echo / aggregate / relay / plan / report /
batch) and two business chains just to get the protocol working. The consolidation did
subtraction: **keep only what it actually does.**

**4 externally declared capabilities** (Agent Card and `/api/capabilities` share one source):

| Capability | Purpose | Boundary |
|---|---|---|
| `sector.movement` | Industry-level movement (advancers/decliners, average change, sample size) | No drilling into individual stocks |
| `customer.reach` | How many customers in an industry are being followed | Counts only, no names/emails/phones |
| `entity.resolve` | Resolve an entity by USCC / security code / alias | No fuzzy matching |
| `node.capabilities` | Self-check: identity, capabilities, index coverage | — |

**Pages:**

| Page | Question it answers |
|---|---|
| **Customer outreach** | Which industry's customers to contact today, and why |
| **A2A negotiation** | Two agents each holding constraints — how to negotiate a feasible solution |
| **Entity alignment** | USCC as the entity primary key — current coverage, where the gaps are |
| **What is this / real nodes / node interfaces** | Background and self-check |

**Deleted** (files kept but removed from build & routing):

- `/api/promote` stock-picking chain — conflicts with "customer management" positioning, high compliance risk
- `/api/compare`, demo scenario pages — depended on deleted fake capabilities, hollow content
- `echo.roundtrip` / `relay.forward` and 5 other demo capabilities — built only for protocol self-test, misleading about the project's focus

Deleted code is about **1100 lines**; the core of the 56 acceptance assertions was retained.

## A2A negotiation: two agents negotiate a plan

**This section answers "why two agents — isn't one enough?"**

However complex the previous pages are, they are essentially **unilateral decisions**:
customer → industry → target → sort by score. That's a fixed rule; you could do it with a
SQL join — no agent needed.

Real A2A is **both parties each holding constraints, negotiating an outcome both can
accept**:

```
R1  Stock-picker side  proposes Wuliangye (score 823, highest of the day)
    Customer side      vetoes — "only 1 customer in this industry, below floor 2",
                       demands "switch to an industry with reachable count ≥ 2";
                       meanwhile concedes: floor can drop to 1
R2  Stock-picker side  re-screens per the new requirement, proposes Dongfeng (score 471.9)
    Customer side      accepts — "1 reachable customer under Auto industry (floor 1)"
```

**Four things that must all be true; missing any one degrades it to "notification" or
"sorting":**

| | Why it's mandatory |
|---|---|
| Both sides have veto power | If only one can propose and the other can only accept, that's not negotiation |
| Veto must carry **reason + requirement** | Just saying "no" gives the other side nothing to adjust; the negotiation spins in place |
| Concessions are **mutual** | The stock-picker swaps out the top-scoring target; the customer side lowers the threshold from 2 to 1. If either digs in, the business is unsolvable right now |
| Full dialogue trace | Given only the conclusion, you can't tell whether it was negotiated or computed |

**"Optimal" here is defined** as: not the highest score, but the **best achievable
agreement under both parties' constraints**. Wuliangye has the highest score but was
vetoed — that is exactly the difference between unilateral ranking and negotiation.

### Two engines, compared on the same page

| | **Rule-driven** | **LLM reasoning** |
|---|---|---|
| Code | `src/negotiate.lume` | `scripts/llm_negotiate.py` |
| Who judges | Hardcoded if-rules | `deepseek-chat` plays both roles |
| Reproducible | Fully reproducible | **Not guaranteed** (same input may give different conclusions) |
| Time | Milliseconds | 30–60 seconds |
| Depth of argument | "reach < floor 2" | "The stock has four-signal resonance, volume-price and breakout both confirmed, nearly double the runner-up" |

The console's "A2A Negotiation" page has an engine toggle at the top to compare both
outputs directly.

**Running the LLM version:**

```bash
make llm-negotiate      # ~30-60s, writes data/self/llm-negotiation.json
```

The console reads the **snapshot** rather than calling the model live — one negotiation
round takes 5–20s, and lume has only 2 workers; one slow request can stall the whole
console. When the snapshot is missing the page explicitly says "not yet run" rather than
silently falling back to the rule-driven version.

### verify_fn: don't let the LLM grade itself

This is the core idea borrowed from `frameworks/*-pse`. The LLM's most common mistake is
**referencing numbers that don't exist** ("the stock has 5-signal resonance" when it's
actually 2). So every round ends with a programmatic check:

| Check | Rejection condition |
|---|---|
| Target code | Not in the day's candidate list (forbids fabricating targets) |
| Score / signal count | Doesn't match the real value fetched via A2A |
| Signal name | Mentioned signal isn't among that target's actual signals |
| Customer count | Claimed reachable count doesn't exist in the real industry distribution |
| Veto | No `requirement` given (the other side has nothing to adjust) |

Non-compliant output is sent back for rewrite, up to 3 times; failing all three marks it
`blocked` and terminates — **no downgrading to "close enough"**.

### An actually-run negotiation (deepseek-chat, 7 calls / 8504 tokens)

```
R1  Stock-picker side  Wuliangye (score 823, only four-signal resonance)
    Customer side      vetoes: Food & Beverage has only 1 customer < floor 2
                       concedes: if the candidate pool can't satisfy, we can drop to 1
R2  Stock-picker side  CATL (7.8% gain that day, highest in the market)
    Customer side      vetoes: Electric Equipment not in CRM industry distribution, reach 0
                       "if the industry doesn't match, it can't land on a specific customer"
R3  Stock-picker side  accepts the reason, switches back to Wuliangye
                       "drop CATL: highest gain but industry not reachable"
    Customer side      accepts: 1 ≥ current floor 1, all four hard constraints pass
```

**Both sides changed position**: the stock-picker gave up two higher-scoring targets; the
customer side lowered the threshold from 2 to 1.

### Three pitfalls when wiring up the LLM (all real)

1. **Said the concession but didn't fill in the number** — the customer side's text said
   "can drop to 1" but `next_floor` was empty, so the other side never got the concession.
   Added text fallback extraction, and the prompt now hard-codes "if you say it, you must
   fill it in."
2. **Blacklist made the concession ineffective** — after Wuliangye was vetoed it went on a
   permanent blacklist; the customer side explicitly said "you can re-propose after
   lowering the threshold," but the stock-picker couldn't see it. Changed so that once the
   threshold drops, the blacklist opens up.
3. **Only gave the old requirement, not the new floor** — the stock-picker judged "no
   candidates" against a stale floor=2. Now each round explicitly tells it the current
   floor.

None of these three is the model being dumb — they are **orchestration logic not passing
negotiation state correctly**.

## Entity alignment (first step toward an Ontology)

**Problem**: names are unreliable — duplicates, renames, inconsistent short/full forms.
Who is "Zhongke Energy Technology" exactly? Strings can never answer that, and it fails
quietly.

**Approach**: use **Unified Social Credit Code (USCC)** and **security code** as entity
primary keys, establishing a `customer company ↔ listed company` connection. Added
`src/entity.lume` (validation & normalization) and `src/graph.lume` (index & resolution).

Three hard rules:

1. **The primary key is not a name.** Names serve only as aliases, and aliases must be
   registered by hand.
2. **No USCC, no recognition.** No fuzzy name matching — the cost of a mismatch is
   asymmetric: a miss is just one fewer recommendation, but a wrong match hangs company A's
   opportunity on company B's stock, and no one will check.
3. **Matches must be explainable.** Every resolution carries a `method`
   (uscc / code / alias) and a reason.

Three result classes are returned separately because different people handle them:

| Status | Meaning | What to do |
|---|---|---|
| `matched` | Identifiers complete and index hit | Use directly |
| `unresolved` | Missing identifier, or not indexed | Add data |
| `invalid` | USCC provided but check digit fails | **Fix data** (dirty data) |

> The check digit is real validation (GB 32100 algorithm). It saved me once in practice:
> the last digit of the Wuliangye USCC I remembered was wrong; the algorithm rejected it on
> the spot, and I only confirmed the real value afterward. **Without this validation layer,
> a wrong code would be used as a true identifier.**

**Current coverage (visible on the "Entity Alignment" page)**

- Index **8 entities, all USCCs pass validation** (GB 32100 check digit + cross-checked
  against 2+ public sources)
- The day's 8 signalled targets **8/8 hit**, gaps cleared to zero
- All 5 industries with signals are `exact`; "IT" and "Finance" had no signal that day,
  still marked `keyword` — **this difference is always shown on the UI, not hidden**

Each entity's `source` field records where the USCC was cross-checked (Qichacha / Qixinbao /
Tianyancha / SSE announcements), so anyone re-verifying knows where to look.

## About the "industry" field, this must be said clearly

**Neither upstream project has an industry field.** The scanner's targets only have
code/name/price/signal/score; the CRM's customers only have name/company/pipeline value.

The entity index can provide an `exact` basis, but currently covers only 3 companies. The
rest still rely on `src/industry.lume`'s **manual mapping table** (40 targets + 18
company-name keyword rules). This is written on the page and in `sources.industry_map`,
because hiding a manual mapping inside business code makes readers think the industry came
from upstream — once a stock changes industry / gets acquired, no one knows where to update.

## What to do next (honest version)

Entity alignment is just starting. In priority order:

1. **Add a USCC field to the CRM** — this is the root gap. Without it, customers can only
   ever be guessed by name.
2. **Fill the day's signalled targets into the index** — 5 of the 8 aren't covered; once
   filled, `basis` can largely become `exact`.
3. **Relationship layer**: group — subsidiary — target. Much of an Ontology's value is in
   "hopping along relationships"; now there's only one hop.
4. **Object-level permissions**: now it's node-level (if you can call it, you can call
   everything).

The current data reality: the CRM's 4 customers fall under "Finance" and "IT", while the
scanner's 8 selected targets that day are all in Food & Beverage / Auto / Steel, etc. So
these two industries show **"9 same-industry potential targets, 0 with signals today"** on
the page — not a bug, it's the real result of that day. Listing "potential watchlist" too
is more useful than showing an empty list; but each is clearly marked whether it has a
signal, otherwise it degenerates into a plain stock list.

```
cp .env.example .env   # fill PEER_ROOT (match crm/scanner)
make docker-up         # start this node, console http://127.0.0.1:10190
make fleet-verify      # 25 assertions: online / signature / real fields / whitelist / on-site comparison
```

## Why connect to real nodes

Self-made echo / aggregate can only prove "two machines can send HTTP to each other," not
that A2A is useful. Hooked up to the CRM and scanner, what's being verified is **whether two
independent projects can recognize each other and exchange real data** — and both projects
are publicly inspectable, so others can reproduce it.

There are three real hurdles on this chain; failing any one shows up as "can't call
through":

1. **Key mode must match.** Both real nodes run derived mode
   (`key(node) = hmac_sha256(PEER_ROOT, "peer:" + node)`). With `PEER_SHARED` configured,
   the signature is **computable but wrong**; the peer always replies `bad signature` — the
   error gives no hint it's a "mode mismatch."
2. **You must be registered.** Correct key still rejected: `unknown peer 'lume-a2a' (not in
   registry)`. This is the identity-trust layer working (preventing you from impersonating
   others with your own key), not a bug. Both sides' `.data/peers-identity.json` need this
   node added.
3. **127.0.0.1 in a container is not the host.** The CRM/scanner run on the host; from
   inside the container use `host.docker.internal:18102`.

## Connecting to real nodes (reproduction steps)

```bash
# 1. Store the root key: match crm/scanner's PEER_ROOT
cp .env.example .env && vi .env     # PEER_ROOT=...  PEER_NAME=lume-a2a

# 2. Register this node in both registries (else 401: unknown peer)
#    Edit lume-crm/.data/peers-identity.json and lume-scanner/.data/peers-identity.json
#    "peers": [..., "lume-a2a"]
#    The registry is read live; no need to restart the peer

# 3. Start this node
make docker-up
make fleet-verify
```

> ⚠️ **This repo is preparing for open-sourcing**, so `.env` is blocked by `.gitignore`; the
> repo only has `.env.example` (field names + explanation, no real values). Before
> publishing, run `make privacy`: it checks whether credentials have leaked into any file.
> Once a derived key is public, anyone can impersonate any node's signature.

## Three protocol scenarios (self-made nodes)

Real nodes demonstrate "can visit each other"; protocol details are demonstrated by a pair
of temporary nodes, default on the "Scenarios" page — click once to see every hop of a
complete interaction:

| Scenario | Spec capability demonstrated | What to look at |
|---|---|---|
| **① Multi-round completion** | `input-required` + re-send with same taskId | First message only gives the topic → peer asks back for missing `period`; after filling, it **still needs `audience`** (not all asked at once); only then does it produce output. `history` records all 3 rounds |
| **② Long-running task** | `submitted → working → completed`, `tasks/get`, `tasks/cancel` | Submit and immediately get a taskId **without waiting for completion**; poll to see progress step by step; after canceling mid-way, the worker really stops advancing |
| **③ Task decomposition** | Capability discovery + division of labor | Only give a goal; the peer reports "which it does itself, which need other nodes, and which **nobody can do**" |

Each has a built-in "why do it this way" because a mistake in the same place is hard to
notice:

- **Guess a default value** when a parameter is missing and keep going — produces a "looks
  successful" report while the caller doesn't know the data is fabricated. Far more
  dangerous than an outright error.
- Long task **holds the connection while waiting** — the client times out while the task is
  actually still running fine.
- An unrecognized requirement **pretends to cover it** — yields a report missing content,
  while the caller assumes it's complete.

Also added `message/stream` (real SSE, `status-update` / `artifact-update` arriving in
order, last frame `final=true`), so the Agent Card's `streaming: true` is no longer empty
talk — **it was empty talk before**, and overstating is worse than not writing it: the
client would wait for a stream that never comes.

## What it demonstrates

A single "send over → get back" doesn't show the value of A2A, only that two machines can
send HTTP to each other. So the three scenarios are deliberately designed to **require two
or more round-trips**:

| Link | Protocol | Description |
|---|---|---|
| Discovery | `GET /.well-known/agent-card.json` | Standard A2A path, public & unauthenticated. Any client can learn this node's capabilities without private conventions |
| Invoke | `POST /a2a` (JSON-RPC) | `message/send` / `tasks/get` / `tasks/cancel`. Returns the full Task (status + artifacts + trace) |
| Direct | `POST /peer/invoke` (HMAC-signed) | Low-overhead channel for a LAN trust domain; signature covers method + path + body |
| Multi-hop | `POST /peer/relay` | A→B→C forwarding, with hop limit |

Both channels (peer-private / A2A-standard) **share the same `dispatch()`**, so there's no
"it's in the card but 404 on click" two-sources-of-truth problem.

## Docker

```
make docker-up      # build + start two containers
make docker-verify  # run 20 assertions against the two nodes in containers
make docker-down    # stop
```

| Service | Console | In-container address |
|---|---|---|
| node-a | http://127.0.0.1:10190 | `http://node-a:18190` |
| node-b | http://127.0.0.1:10191 | `http://node-b:18190` |

Both services **share the same image** `lume-a2a`, distinguished only by `PEER_NAME` —
otherwise any change might rebuild only one side, giving "A can call B but B can't call A
back," which is extremely hard to spot.

Three things that must be handled explicitly, or you will trip:

1. **`PEER_PUBLIC_URL` must be set to the service name.** In a container `127.0.0.1`
   points at itself. Unset, the Agent Card advertises `http://127.0.0.1:18190` — the fields
   all look right, and clients following them will surely fail.
2. **Host ports can't be used as inter-node addresses.** The host's `127.0.0.1:10191` from
   node-a's perspective is itself. So `probe.py` takes the "node-internal view" addresses as
   arguments 4/5 (`make docker-verify` already passes `node-b:18190 node-a:18190`).
3. **The binary must come from source build, not the v0.11.0 release package.** The release
   lacks `ed25519_pubkey`, which `lume-core/lib/identity.lume` calls at module level — the
   container won't start, reporting `undefined variable 'ed25519_pubkey'`, repeatedly.
   `vendor/` holds the source-built artifact (including the TLS warm-up fix); see
   `vendor/.lume-build`.

`lume-core/lib` is placed at the **root** `/lume-core/lib` in the image: the source writes
`../lume-core/lib/peer.lume`, which resolves there from `/app`. Flattening it to
`/app/lume-core` gives `cannot resolve import`.

## "Ask Agent" page: pure lume, no extra process

The page calls the framework-native `POST /react/api/chat` (SSE streaming); tools are
registered in `src/agent.lume`. **No separate service process; no python3 in the
container.**

```
make ask Q="which industry's customers are furthest along?"   # try once from the CLI, watch streaming
```

### How it works

| Step | Who's responsible |
|---|---|
| Tool registration `tool "name","desc",{schema},fn` | this repo's `src/agent.lume` |
| ReAct multi-round loop (default 8 rounds) | framework `agent.c` |
| Call the model (fork + exec curl, TLS left to curl) | framework |
| HMAC signing / registry check / trace points | `lume-core/lib/peer.lume` + `src/fleet.lume` |
| Streamed answer delivery | `/react/api/chat` SSE |

Each tool is just a one-line wrapper around `fleet.invoke(...)` — that is **the only entry
point for cross-node calls**, so the Agent page's "call log" shows every call it decided to
make itself.

SSE events:

```
data: {"t":"note","d":"tool crm_stages({})"}   which tool it decided to call
data: {"t":"note","d":"round 2/8"}             which round
data: {"t":"delta","d":"IT"}                   answer fragment
data: {"t":"error","d":"..."} / {"t":"done"}
```

### Why the Python in this code was removed

There used to be a `scripts/agent_server.py` + `agent_chat.py`: a small HTTP service on the
host, hand-writing the ReAct loop, tool table, JSON protocol, and HMAC signing. The problem
wasn't "can it run" but that **the framework already has all of it** (`agent.c:762` loop,
`interp.c:1452` `hmac_sha256`). That Python re-implemented existing capability on top of
itself.

The cost was real: one more process = one more "service didn't start" failure (page reports
"Agent service unreachable," and you can't tell whether it's off or the code is broken); the
container needed python3 installed; and that `threading.Lock` under `fork-per-connection`
**doesn't queue at all** (the lock lives within a process; two requests are two forks).

After removal the image is still 121MB, and `docker exec lume-a2a python3` is `not found`.

### Pitfalls hit

**Tool names can't have dots.** The node-side capability is `crm.stats`, but registering it
as a tool must write `crm_stats` — the OpenAI-compatible interface requires `function.name`
to match `^[a-zA-Z0-9_-]+$`; with a dot, upstream returns
`400 Invalid 'tools[0].function.name'`. You can't see it locally (the tool registers fine
and shows up in `tools()`); it only blows up when actually sent, and the error message
doesn't point to "a dot in the name."

**`env()` can't read `LLM_API_KEY`.** That's by design: variables whose name contains
`API_KEY`/`SECRET` always return `null`, preventing scripts from reading credentials out and
sending them. So you can't use it to check "is it configured" — that check is always false,
which is more misleading than not checking.

## Architecture

```
node.lume            routing + JSON-RPC parsing + startup self-check
src/a2a.lume         task state machine / Agent Card / dispatch (sole implementation for all three links)
src/catalog.lume     capability catalog (frontend panel, Agent Card skills, dispatch — three sources, one origin)
src/proto_encode.lume  frame encode/decode pure functions (called by server, also unit-testable)
src/ui/*             React console (esbuild-bundled to www/)
scripts/verify.sh    end-to-end acceptance (start two nodes → run assertions → stop)
scripts/probe.lume   assertion body (signing reuses peer.signed_url directly)
scripts/check_public.lume  pre-open-source gate: no real credentials in the repo
scripts/seed_crm.lume      add demo customers to CRM (idempotent)
```

Signing/verifying/one-shot requests all reuse **`../lume-core/lib/peer.lume`** — no copy,
because two implementations will always drift, and drift shows up as "one side passes, one
side 401."

## Task state machine

```
submitted ──▶ working ──▶ completed
                  └────▶ failed
                  └────▶ rejected      (unknown capability / hop limit)
   └──▶ input-required  (intent unrecognized, asks client to name the capability)
```

Tasks are persisted at `.data/a2a-tasks/<node-name>/<id>.json`.

**Isolation by node name** isn't pedantry: if two nodes start from the same directory, they
share one task directory and "see each other's tasks"; `tasks/get` can query another node's
task. Hit this in practice.

## Three deliberate design tradeoffs

**1. Unrecognized intent → `input-required`, don't guess.**
Guessing wrong costs "looks successful but answers the wrong thing," far worse than asking
one more round.

**2. Peer unreachable → `unreachable`, never fill in 0.**
This comes from a `lume-lan` real-world test: the peer's `sql_query` silently returned
empty during concurrent writes, the peer forwarded `0` as fact, and the agent answered
"your blog is empty." If you can't get it, say you can't get it.

**3. Loop protection uses a hard limit, not loop detection.**
Each node only sees the `hops` it received; there's no global view; detecting loops needs
global state. So `hops` is agreed to be monotonically increasing, and at 3 it's rejected
outright. Cost: legitimate long chains get cut; benefit: two nodes bouncing won't peg the
CPU.

## Known boundaries

- **Plaintext transport**: lume's `http_*` doesn't support a custom CA; signatures
  guarantee non-forgery / non-tampering, but **no encryption**. Don't send passwords or ID
  numbers through this channel.
- **Replay protection is time-window-level**: the same nonce replayed within the
  `PEER_SKEW_SECS` window still passes.
- **Frame text only guarantees ASCII fidelity**: lume has no builtin for "take the numeric
  value of the i-th byte"; non-ASCII characters fall to `~3F` in query frames. For lossless
  Chinese, use the A2A JSON body.
- **No async background execution**: lume has no `spawn`/`exec`; `http_*` blocks
  synchronously. This demo's `message/send` all execute synchronously and return; for the
  long-task model see `lume-lan`'s `a2a_worker.py` approach (register `submitted`, host
  process advances).
- **The console's `/api/*` has no auth**: read-only + no credentials, provided it's bound
  to `127.0.0.1` only.

## Security model

```
sig = hmac_sha256(PEER_SHARED, node \n ts \n nonce \n scope)
GET  → scope = "GET "  + path
POST → scope = "POST " + path + "\n" + body
```

- The signature's **algorithm and concatenation** fully follow `lib/peer.lume`, not a single
  character changed — it already appears between all running nodes; changing it once is a
  fleet-wide 401.
- Without `PEER_SHARED` / `PEER_ROOT`, the peer face **shuts down entirely (fail-closed)**,
  not pass-through. `/peer/health`'s `mode` field honestly reports which scheme is actually
  in effect.
- The browser **doesn't hold the key**: same-origin calls go through `/api/local-invoke` and
  the server signs on its behalf; cross-machine calls go through `relay.forward`. This proxy
  only accepts same-origin targets, otherwise it becomes an open proxy punching through the
  internal network.

## Capability list

| Capability | Type | Purpose |
|---|---|---|
| `node.overview` | query | identity / signature mode / capability count / uptime |
| `echo.roundtrip` | query | echo + length, verifies envelope integrity & latency |
| `facts.aggregate` | compute | fetch the same fact from multiple peers and flag inconsistencies |
| `relay.forward` | relay | forward to next hop, with hop limit |

Adding a capability only needs changes to `src/catalog.lume` + one branch in `src/a2a.lume`'s
`dispatch()`; the panel and Agent Card follow automatically.

## Acceptance

`make verify` actual output:

```
1) Agent Card (public discovery)   card 200 / name / skills / supportedInterfaces
2) A2A message/send                task / completed / artifacts
3) Unrecognized capability → input-required   doesn't guess / carries question message
4) tasks/get                       retrievable / not found → -32001
5) peer signed direct              invoke ok
6) Wrong signature must be rejected   wrong sig → unauthorized
7) Unknown tool → whitelist rejected   unknown tool
8) Multi-hop relay A → B           completed / result from node-b
9) Hop limit → rejected            hops-exceeded
10) facts.aggregate both nodes consistent   reachable=2 / consistent
```

Item 6 is deliberately added: only testing "correct signature passes" is testing nothing. A
wrong signature must be rejected, or the verification logic isn't actually running.
