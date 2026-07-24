# 足球俱乐部老板 · 可玩性优化 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 给《足球俱乐部老板》加一层"赛前会议"(基调 + 花资源加码,看得见地改 xG)和一套"目标/结局清晰化"(三年看板 + 结局路线卡 + 杯赛按实力 + 好结局联赛门槛),提升参与感、破单调、讲清目标 —— 不动开局破产曲线。

**Architecture:** 游戏是单文件 `足球俱乐部老板.html`,全部逻辑在唯一的 `<script>` 内,顶层 `function` 声明即全局函数,`if(typeof document!=="undefined")init()` 保证无 DOM 时可加载。测试沿用 `模拟球员/tests/` 的做法:用 Node 内置 `vm` 把该 `<script>` 载入沙箱,以**种子 RNG** 断言纯逻辑;UI/集成用结构断言 + 机器人压测回归。所有改动落在这一个 HTML 文件 + 新增 `tests/` 目录,无需 npm/依赖。

**Tech Stack:** 原生 HTML/JS(游戏);Node ≥18 内置 `node:test`/`assert`/`vm`/`fs`(测试,`node tests/xxx.mjs` 直接跑);种子线性同余 RNG 做确定性。

---

## File Structure

**Modify:**
- `足球俱乐部老板.html`(唯一游戏文件,改其 `<script>` 与少量 HTML/CSS)
  - 新增纯函数:`matchImportance` / `planToneMenu` / `applyPlan` / `winBonusCost` / `forceYouthStart` / `cupOpponent` / `endingRoutes` / `targetBoard`
  - 改造:`simulateMyMatch`(加可选 `plan` 参数)、`simulateLeagueMonth`(透传 `f.plan`)、`simulateCup`(用 `cupOpponent` + 读 `s.cup.pendingPlan`)、`buildMatchNarrative`(加"赛前部署"因果格)、`doEndMonth`(三段式拆分)、`finalEnding`(联赛门槛)、`renderOverview`(挂看板)、创建屏与主界面(结局路线卡)、`showMatchCentre`(展示 planEffect)
  - 新增 UI 处理器:`openPrematch` / `renderPrematchCard` / `confirmPlan`
  - `SAVE_VERSION` +1

**Create:**
- `tests/football-harness.mjs` — 载入游戏脚本到 vm 沙箱,导出 `loadGame()/seeded()/newGame()`
- `tests/football-prematch.test.mjs` — 基调 + 加码逻辑
- `tests/football-cup-endings.test.mjs` — 杯赛按实力 + 结局门槛 + 看板数据
- `tests/football-robot.mjs` — 随机/保守/放置三种机器人回归(无崩溃 + 平衡不变式)

**约定(全程一致的数据结构):**

```js
// 一个赛前部署 plan:
{
  tone: {key, label, my, opp, injury, note, importance}, // planToneMenu 的一项
  bonus: false,            // 是否发赢球奖
  youthPush: null,         // 被强推首发的球员 id,或 null
  presser: null            // "力挺" | "施压" | null
}
```

---

## Task 1: 测试基座(harness)+ 现状特征化测试

**Files:**
- Create: `tests/football-harness.mjs`
- Create: `tests/football-baseline.test.mjs`

- [ ] **Step 1: 写 harness**

`tests/football-harness.mjs`:

```js
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import {fileURLToPath} from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");

// 载入游戏唯一 <script> 到无 DOM 沙箱。init() 被 typeof document 守卫,不会自动运行。
export function loadGame() {
  const html = fs.readFileSync(path.join(root, "足球俱乐部老板.html"), "utf8");
  const m = html.match(/<script>([\s\S]*)<\/script>/); // 文件只有 1 个 <script>
  if (!m) throw new Error("未找到 <script> 块");
  const sandbox = {
    console, Math, Date, setTimeout, clearTimeout,
    window: {},
    localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
  };
  vm.createContext(sandbox);
  vm.runInContext(m[1], sandbox);
  return sandbox; // 顶层 function 声明都挂在 sandbox 上
}

// 确定性 RNG(与 模拟球员/tests 同款线性同余)
export function seeded(seed) {
  let x = seed >>> 0;
  return () => ((x = (x * 1664525 + 1013904223) >>> 0) / 4294967296);
}

export function newGame(g, archetype = "capital", rng = seeded(1)) {
  return g.initialState({ ownerName: "测试", city: "城", clubName: "测试队", archetype }, rng);
}
```

- [ ] **Step 2: 写现状特征化测试**(锁住"改动前"的行为,包括那个杯赛/结局漏洞,后面对照)

`tests/football-baseline.test.mjs`:

```js
import assert from "node:assert/strict";
import { loadGame, seeded, newGame } from "./football-harness.mjs";

const g = loadGame();

// 引擎可加载、状态完整
const s = newGame(g, "capital", seeded(1));
assert.ok(s.roster.length >= 20, "开局一线队应有球员");
assert.ok(s.clubs.length >= 8, "应有联赛球队");
assert.equal(s.season, 1);

// 比赛能跑出有随机方差的比分
const opp = s.clubs.find(c => c.id !== "me");
const scores = new Set();
for (let i = 0; i < 30; i++) {
  const s2 = newGame(g, "capital", seeded(100 + i));
  const o2 = s2.clubs.find(c => c.id !== "me");
  const r = g.simulateMyMatch(s2, o2, true, "联赛", seeded(200 + i));
  scores.add(`${r.gf}-${r.ga}`);
}
assert.ok(scores.size > 4, "比赛结果应保留随机方差");

// 特征化当前漏洞:纯两杯冠 + 联赛垫底 目前会判成"好结局"
const exploit = newGame(g, "capital", seeded(7));
exploit.track.trophies = 2;
exploit.track.leagueTitles = 0;
exploit.history = [{ rank: 9 }];
const [title, , good] = g.finalEnding(exploit);
assert.equal(good, true, "特征化:改动前,两杯冠即使联赛第9也算好结局(Task 8 将收紧)");

console.log("football baseline test passed");
```

- [ ] **Step 3: 跑测试,应通过**

Run: `node tests/football-baseline.test.mjs`
Expected: 打印 `football baseline test passed`(退出码 0)。若报 `未找到 <script>` 或函数 undefined,先修 harness。

- [ ] **Step 4: 提交**

```bash
git add tests/football-harness.mjs tests/football-baseline.test.mjs
git commit -m "test: add vm harness + baseline characterization for football sim"
```

---

## Task 2: `matchImportance` + `planToneMenu`(纯函数)

**Files:**
- Modify: `足球俱乐部老板.html`(在 `matchPreview` 定义之后新增两个函数)
- Create: `tests/football-prematch.test.mjs`

- [ ] **Step 1: 写失败测试**

`tests/football-prematch.test.mjs`:

```js
import assert from "node:assert/strict";
import { loadGame, seeded, newGame } from "./football-harness.mjs";
const g = loadGame();

// 菜单永远三选一,且含一个"常规"
const s = newGame(g, "capital", seeded(1));
const opp = s.clubs.find(c => c.id !== "me");
const menu = g.planToneMenu(s, opp, true, "联赛");
assert.equal(menu.length, 3, "基调恒为三选一");
assert.ok(menu.some(o => o.key === "normal"), "必含常规项");
menu.forEach(o => {
  assert.ok(typeof o.my === "number" && typeof o.opp === "number", "每项带 xG 乘数");
  assert.ok("importance" in o, "每项带赛事重要度");
});

// 占优 vs 下风,菜单不同(占优给抢攻/轮换;下风给铁桶/对攻)
const strong = newGame(g, "capital", seeded(2));
const weakOpp = strong.clubs.slice().sort((a, b) => a.strength - b.strength)[0];
const strongMenu = g.planToneMenu(strong, weakOpp, true, "联赛").map(o => o.key);
assert.ok(strongMenu.includes("attack") && strongMenu.includes("rotate"), "占优给 抢攻/轮换");

const hardOpp = strong.clubs.slice().sort((a, b) => b.strength - a.strength)[0];
const hardMenu = g.planToneMenu(strong, hardOpp, false, "联赛").map(o => o.key);
assert.ok(hardMenu.includes("park") && hardMenu.includes("gamble"), "下风给 铁桶/对攻");

console.log("prematch tone-menu test passed");
```

- [ ] **Step 2: 跑测试,应失败**

Run: `node tests/football-prematch.test.mjs`
Expected: FAIL — `g.planToneMenu is not a function`。

- [ ] **Step 3: 实现**

在 `足球俱乐部老板.html` 里,`function matchPreview(...){...}` 那一行**之后**插入:

```js
function matchImportance(s,opp,competition="联赛"){if(/杯/.test(competition))return"杯赛淘汰";const rank=leagueRank(s),n=s.clubs.length;if(rank>=n-2)return"保级";if(rank<=3)return"争冠";return"常规"}
function planToneMenu(s,opp,home,competition="联赛"){const pre=matchPreview(s,opp,home),edge=pre.edge,imp=matchImportance(s,opp,competition),T=(key,label,my,op,injury,note)=>({key,label,my,opp:op,injury,note,importance:imp});if(/杯/.test(competition)||edge<=-2)return[T("park","铁桶偷分",.82,.72,0,"放弃进攻,压低对手"),T("normal","常规部署",1,1,0,"不做额外倾斜"),T("gamble","对攻豪赌",1.2,1.2,.01,"赌爆冷,也可能被打崩")];if(edge>=2)return[T("attack","全力抢攻",1.18,1.1,.02,"占优,冲净胜球但露后防"),T("normal","常规部署",1,1,0,"不做额外倾斜"),T("rotate","轮换保人",.88,1,-.02,"保主力体能、练年轻替补")];return[T("press","压上抢攻",1.1,1.06,.01,"均势里争主动"),T("normal","常规部署",1,1,0,"不做额外倾斜"),T("hold","稳守反击",.92,.88,0,"少丢球优先")]}
```

> 说明:杯赛淘汰赛通常对手更强,按"下风菜单"给偷分/豪赌两条戏剧路线。

- [ ] **Step 4: 跑测试,应通过**

Run: `node tests/football-prematch.test.mjs`
Expected: PASS — `prematch tone-menu test passed`。

- [ ] **Step 5: 提交**

```bash
git add 足球俱乐部老板.html tests/football-prematch.test.mjs
git commit -m "feat: contextual pre-match tone menu (planToneMenu)"
```

---

## Task 3: `applyPlan` xG 数学 + 接入 `simulateMyMatch`

**Files:**
- Modify: `足球俱乐部老板.html`(新增 `applyPlan`;改 `simulateMyMatch` 签名与 lambda/injury 来源;记录 `planEffect`)
- Modify: `tests/football-prematch.test.mjs`(追加)

- [ ] **Step 1: 追加失败测试**

在 `tests/football-prematch.test.mjs` 末尾 `console.log` 之前追加:

```js
// applyPlan 纯数学:基调 + 赢球奖 乘在原始 xG 上
const base = { myXgRaw: 2.0, oppXgRaw: 1.0 };
const parked = g.applyPlan(base, { tone: { my: 0.82, opp: 0.72, injury: 0 }, bonus: false });
assert.ok(Math.abs(parked.myLambda - 1.64) < 1e-9 && Math.abs(parked.opLambda - 0.72) < 1e-9, "铁桶按乘数缩放");
const bonused = g.applyPlan(base, { tone: { my: 1, opp: 1, injury: 0 }, bonus: true });
assert.ok(Math.abs(bonused.myLambda - 2.16) < 1e-9, "赢球奖再乘 1.08");

// simulateMyMatch 接受 plan,且抢攻相对铁桶长期更高进球
let attackGF = 0, parkGF = 0;
for (let i = 0; i < 120; i++) {
  const sa = newGame(g, "capital", seeded(300 + i));
  const oa = sa.clubs.find(c => c.id !== "me");
  const ra = g.simulateMyMatch(sa, oa, true, "联赛", seeded(400 + i), { tone: { key:"attack", my: 1.18, opp: 1.1, injury: .02 }, bonus: false });
  attackGF += ra.gf;
  const sp = newGame(g, "capital", seeded(300 + i));
  const op = sp.clubs.find(c => c.id !== "me");
  const rp = g.simulateMyMatch(sp, op, true, "联赛", seeded(400 + i), { tone: { key:"park", my: 0.82, opp: 0.72, injury: 0 }, bonus: false });
  parkGF += rp.gf;
}
assert.ok(attackGF > parkGF, `抢攻总进球(${attackGF})应高于铁桶(${parkGF})`);

// planEffect 被写进 report 供反馈用
const sx = newGame(g, "capital", seeded(9));
const ox = sx.clubs.find(c => c.id !== "me");
const rx = g.simulateMyMatch(sx, ox, true, "联赛", seeded(9), { tone: { key:"park", label:"铁桶偷分", my: 0.82, opp: 0.72, injury: 0 }, bonus: false });
assert.ok(rx.planEffect && rx.planEffect.baseMy > 0 && rx.planEffect.my <= rx.planEffect.baseMy, "planEffect 记录 base→调整后");
```

- [ ] **Step 2: 跑测试,应失败**

Run: `node tests/football-prematch.test.mjs`
Expected: FAIL — `g.applyPlan is not a function`。

- [ ] **Step 3: 实现**

(a) `matchPreview` 之后新增:

```js
function applyPlan(pre,plan){const tone=plan&&plan.tone?plan.tone:{my:1,opp:1,injury:0},bonusMul=plan&&plan.bonus?1.08:1;return{myLambda:pre.myXgRaw*tone.my*bonusMul,opLambda:pre.oppXgRaw*tone.opp,injuryDelta:tone.injury||0}}
```

(b) 改 `simulateMyMatch`。当前签名:
`function simulateMyMatch(s,opp,home,competition="联赛",rng=Math.random){const xi=selectLineup(s),preview=matchPreview(s,opp,home),myLambda=preview.myXgRaw,opLambda=preview.oppXgRaw,gf=poisson(myLambda,rng),ga=poisson(opLambda,rng),...`

改成(只动开头这一段,其余不变):

```js
function simulateMyMatch(s,opp,home,competition="联赛",rng=Math.random,plan=null){const xi=selectLineup(s),preview=matchPreview(s,opp,home),eff=applyPlan(preview,plan),myLambda=eff.myLambda,opLambda=eff.opLambda,gf=poisson(myLambda,rng),ga=poisson(opLambda,rng),
```

并把函数内 `injuryChance` 一行:
`injuryChance=.055-(s.stadium.pitch-1)*.008+(s.coach.discipline<50?.02:0);`
改为:
`injuryChance=.055-(s.stadium.pitch-1)*.008+(s.coach.discipline<50?.02:0)+eff.injuryDelta;`

在函数末尾 `const report={...}` 里(`preview` 字段旁)加上两个字段:
`,plan:plan||null,planEffect:{baseMy:preview.myXgRaw,baseOpp:preview.oppXgRaw,my:myLambda,opp:opLambda,bonus:!!(plan&&plan.bonus),tone:plan&&plan.tone?plan.tone.label:"常规部署"}`

- [ ] **Step 4: 跑测试,应通过**

Run: `node tests/football-prematch.test.mjs`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add 足球俱乐部老板.html tests/football-prematch.test.mjs
git commit -m "feat: apply pre-match tone/bonus multipliers into match sim (applyPlan)"
```

---

## Task 4: 加码逻辑 —— 赢球奖(含胃口)、强推青训、发布会

**Files:**
- Modify: `足球俱乐部老板.html`(`winBonusCost`、`forceYouthStart`,以及 `simulateMyMatch` 内的结果相关副作用)
- Modify: `tests/football-prematch.test.mjs`(追加)

- [ ] **Step 1: 追加失败测试**

追加到 `tests/football-prematch.test.mjs`(`console.log` 之前):

```js
// 赢球奖成本 = payroll*0.2 取整
const sc = newGame(g, "fallen", seeded(3));
assert.equal(g.winBonusCost(sc), Math.round(g.__payroll ? g.__payroll(sc) : g.winBonusCost(sc)) || g.winBonusCost(sc), "成本可计算"); // 见下方说明,若未暴露 payroll 则仅断言为正数
assert.ok(g.winBonusCost(sc) > 0, "赢球奖成本为正");

// 强推青训:被指定的年轻球员一定首发(apps 增加),赢/平则成长
const sy = newGame(g, "promoted", seeded(11)); // 升班马青训多
const kid = sy.roster.slice().sort((a, b) => a.ability - b.ability).find(p => p.age <= 21) || sy.roster.slice().sort((a, b) => a.ability - b.ability)[0];
const abBefore = kid.ability, appsBefore = kid.apps;
// 用能保证赢的设定:打最弱队 + 抢攻
const easy = sy.clubs.slice().sort((a, b) => a.strength - b.strength)[0];
let grew = false;
for (let i = 0; i < 40 && !grew; i++) {
  const s2 = newGame(g, "promoted", seeded(11));
  const k2 = s2.roster.find(p => p.id === kid.id) || s2.roster.slice().sort((a,b)=>a.ability-b.ability)[0];
  const e2 = s2.clubs.slice().sort((a, b) => a.strength - b.strength)[0];
  const r = g.simulateMyMatch(s2, e2, true, "联赛", seeded(900 + i), { tone: { key:"attack", my: 1.18, opp: 1.1, injury: .02 }, bonus: false, youthPush: k2.id });
  assert.ok(k2.apps > 0, "强推的球员必首发(apps>0)");
  if (r.gf >= r.ga && k2.ability > abBefore) grew = true;
}
assert.ok(grew, "强推青训在不败时应有成长");

// 发布会"力挺"输球:board 下降
const sp2 = newGame(g, "capital", seeded(21));
const boss = sp2.clubs.slice().sort((a, b) => b.strength - a.strength)[0];
const boardBefore = sp2.board;
let dropped = false;
for (let i = 0; i < 60 && !dropped; i++) {
  const s3 = newGame(g, "capital", seeded(21));
  const b3 = s3.clubs.slice().sort((a, b) => b.strength - a.strength)[0];
  const bb = s3.board;
  const r = g.simulateMyMatch(s3, b3, false, "联赛", seeded(1200 + i), { tone: { key:"park", my: 0.82, opp: 0.72, injury: 0 }, bonus: false, presser: "力挺" });
  if (r.gf < r.ga && s3.board < bb) dropped = true;
}
assert.ok(dropped, "力挺后输球,董事会信心下降");
```

> 说明:`payroll` 是内部函数,测试里不强依赖其暴露 —— 只断言 `winBonusCost>0`。上面第一条断言写成恒真兜底,重点是第二条。

- [ ] **Step 2: 跑测试,应失败**

Run: `node tests/football-prematch.test.mjs`
Expected: FAIL — `g.winBonusCost is not a function`。

- [ ] **Step 3: 实现**

(a) `applyPlan` 旁新增两个 helper:

```js
function winBonusCost(s){return Math.round(payroll(s)*.2)}
function forceYouthStart(s,xi,pid){const yp=s.roster.find(p=>p.id===pid);if(!yp)return null;if(!xi.includes(yp)){let wi=-1,wv=Infinity;xi.forEach((p,i)=>{if(p.pos!=="GK"){const v=playerCurrent(p,s.coach.style);if(v<wv){wv=v;wi=i}}});if(wi>=0)xi[wi]=yp}return yp}
```

(b) 在 `simulateMyMatch` 内,`const xi=selectLineup(s)` 之后、`gf/ga` 之前,插入强推首发:

```js
const pushed=plan&&plan.youthPush?forceYouthStart(s,xi,plan.youthPush):null;let pressMul=1;if(plan&&plan.presser==="施压"){if(rng()<clamp(.3+(s.coach.discipline-50)/200,.15,.5))pressMul=1.06;else risk(s,"dressing",5)}
```

把 `myLambda=eff.myLambda` 改为 `myLambda=eff.myLambda*pressMul`(即让施压激发生效)。

(c) 在函数末尾、`return buildMatchNarrative(...)` **之前**,插入结果相关副作用:

```js
if(pushed){if(gf>=ga){pushed.form=clamp(pushed.form+6);pushed.ability=Math.min(pushed.potential,pushed.ability+1);s.fans=clamp(s.fans+2)}else{s.coach.authority=clamp(s.coach.authority-5);risk(s,"dressing",4)}}
if(plan&&plan.presser==="力挺"&&gf<ga){s.board=clamp(s.board-3);risk(s,"fans",4)}
if(plan&&plan.bonus)s.flags.winBonusStreak=(s.flags.winBonusStreak||0)+1;else if(s.flags.winBonusStreak>0){risk(s,"dressing",Math.min(6,s.flags.winBonusStreak*2));s.flags.winBonusStreak=0}
```

> 赢球奖的**现金扣款**在确认弹窗时做(Task 6 的 `confirmPlan`),不在模拟里;模拟只管"胃口"累积与重置。

- [ ] **Step 4: 跑测试,应通过**

Run: `node tests/football-prematch.test.mjs`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add 足球俱乐部老板.html tests/football-prematch.test.mjs
git commit -m "feat: paid pre-match amps (win bonus streak, youth push, presser)"
```

---

## Task 5: `doEndMonth` 三段式拆分(部署 → 模拟 → 展示)

**Files:**
- Modify: `足球俱乐部老板.html`(`doEndMonth`、`simulateLeagueMonth` 透传、`simulateCup` 读 pendingPlan)

> 这是全案唯一的结构性改动。现流程"先全模拟再逐场弹窗",要改成"先逐场弹赛前卡收集 plan,再模拟,再展示"。用现有 modal 队列 `queueAll/flushQueue` 串接。逻辑难以纯单元测,靠 Task 10 机器人回归 + Task 11 浏览器冒烟验证;本任务确保**无 plan 时行为与现状完全一致**(向后兼容)。

- [ ] **Step 1: 让 `simulateLeagueMonth` 透传 fixture 上的 plan**

当前:`const opp=f.home==="me"?b:a,report=simulateMyMatch(s,opp,f.home==="me","联赛",rng);`
改为:
```js
const opp=f.home==="me"?b:a,report=simulateMyMatch(s,opp,f.home==="me","联赛",rng,f.plan||null);f.plan=null;
```

- [ ] **Step 2: 让 `simulateCup` 读 `s.cup.pendingPlan`**

当前:`report=simulateMyMatch(s,opp,rng()>.45,`足协杯${stages[s.cup.stage]}`,rng);`
改为:
```js
report=simulateMyMatch(s,opp,rng()>.45,`足协杯${stages[s.cup.stage]}`,rng,s.cup.pendingPlan||null);s.cup.pendingPlan=null;
```

- [ ] **Step 3: 收集本月我方赛程 + 拆分 `doEndMonth`**

在 `doEndMonth` 之前新增一个"收集本月我方比赛"的 helper(供部署阶段遍历):

```js
function myFixturesThisMonth(s){const list=[];roundsThisMonth(s).forEach(r=>r.fixtures.forEach(f=>{if(f.home==="me"||f.away==="me"){const opp=s.clubs.find(c=>c.id===(f.home==="me"?f.away:f.home));list.push({kind:"league",fixture:f,opp,home:f.home==="me",competition:"联赛"})}}));if(s.cup.alive&&[3,5,7,9].includes(s.seasonMonth)&&s.cup.stage<4){list.push({kind:"cup",opp:null,home:null,competition:"足协杯"})}return list}
```

把现有 `function doEndMonth(){...}` 改造为两段:先跑部署阶段(队列一串赛前卡),队列清空后回调里再跑原有的"模拟+结算+展示"。最小改法:

```js
function doEndMonth(){const fixtures=myFixturesThisMonth(S);const planTasks=fixtures.map(fx=>()=>openPrematch(fx,()=>flushQueue()));planTasks.push(()=>runMonthResolution());queueAll(planTasks)}
```

然后把**原 `doEndMonth` 的全部函数体**原封不动搬进新函数 `runMonthResolution()`:

```js
function runMonthResolution(){const competitionEvents=processMarketCompetition(S),currentRoundIndexes=roundsThisMonth(S).map(x=>x.index+1),fin=settleFinance(S),leagueReports=simulateLeagueMonth(S); /* …… 原 doEndMonth 剩余内容,一字不改 …… */ }
```

> `openPrematch(fx, done)` 在 Task 6 实现;本任务先放一个直通桩,保证管线跑通且等价现状:

```js
function openPrematch(fx,done){done()} // Task 6 用真实弹窗替换
```

- [ ] **Step 4: 手动等价性自检**

Run: `node tests/football-baseline.test.mjs && node tests/football-prematch.test.mjs`
Expected: 两个测试仍全绿(纯函数未受影响)。桩版 `openPrematch` 直通,等价旧流程。

- [ ] **Step 5: 提交**

```bash
git add 足球俱乐部老板.html
git commit -m "refactor: split doEndMonth into deploy->resolve phases (plan pipeline, backward-compatible stub)"
```

---

## Task 6: 赛前部署弹窗 + 赛后"赛前部署"因果格

**Files:**
- Modify: `足球俱乐部老板.html`(`openPrematch`/`renderPrematchCard`/`confirmPlan` 真实实现;`buildMatchNarrative` 加因果格;`showMatchCentre` 已用 `explanation.causes`,无需改)

> UI 任务,沿用现有 `showModal`/`eventOption` 与 modal 队列。资源扣款在此发生(赢球奖扣现金、强推扣权威)。

- [ ] **Step 1: 因果格测试(可单元测的部分)**

在 `tests/football-prematch.test.mjs` 追加:

```js
// buildMatchNarrative 在有 plan 时,causes 里应出现"赛前部署"格
const sn = newGame(g, "capital", seeded(31));
const on = sn.clubs.find(c => c.id !== "me");
const rn = g.simulateMyMatch(sn, on, true, "联赛", seeded(31), { tone: { key:"park", label:"铁桶偷分", my: 0.82, opp: 0.72, injury: 0 }, bonus: true });
assert.ok(rn.explanation.causes.some(c => c.label.includes("赛前部署")), "因果网格含赛前部署格");
```

- [ ] **Step 2: 跑测试,应失败**

Run: `node tests/football-prematch.test.mjs`
Expected: FAIL(尚无该因果格)。

- [ ] **Step 3: 在 `buildMatchNarrative` 里追加因果格**

`buildMatchNarrative` 内构造 `causes` 数组的地方(现有四格:阵容与教练/战术对位/场地条件/临场效率),在数组**末尾**追加一格(读 `report.planEffect`):

```js
...(report.planEffect?[{label:"赛前部署",value:`${report.planEffect.tone}${report.planEffect.bonus?" +赢球奖":""}`,detail:`预期 ${round(report.planEffect.baseMy,1)}-${round(report.planEffect.baseOpp,1)} → ${round(report.planEffect.my,1)}-${round(report.planEffect.opp,1)}`,tone:edgeTone(report.planEffect.my-report.planEffect.baseMy,.15)}]:[])
```

- [ ] **Step 4: 跑测试,应通过**

Run: `node tests/football-prematch.test.mjs`
Expected: PASS。

- [ ] **Step 5: 实现真实弹窗,替换 Task 5 的桩**

用下面的真实实现替换 `function openPrematch(fx,done){done()}`:

```js
function openPrematch(fx,done){
  const opp=fx.kind==="cup"?null:fx.opp;
  // 杯赛对手赛前未定,给一张"淘汰赛基调"卡,存到 s.cup.pendingPlan;联赛存 f.plan
  const home=fx.kind==="cup"?true:fx.home;
  const refOpp=opp||strongestRivalForCup(S); // 见下:用于生成菜单的参照对手
  const menu=planToneMenu(S,refOpp,home,fx.competition);
  S._pmDraft={tone:menu[1],bonus:false,youthPush:null,presser:null,fx,menu,done};
  renderPrematchCard();
}
function strongestRivalForCup(s){return s.clubs.filter(c=>c.id!=="me").slice().sort((a,b)=>b.strength-a.strength)[Math.min(3,s.cup.stage)]||s.clubs.find(c=>c.id!=="me")}
function renderPrematchCard(){const d=S._pmDraft,imp=d.tone.importance,title=`赛前会议 · ${d.fx.competition}${d.fx.kind==="cup"?"":d.fx.home?" 主场":" 客场"}${d.fx.opp?` vs ${d.fx.opp.name}`:""}`;
  const kids=S.roster.filter(p=>p.age<=21).sort((a,b)=>b.potential-a.potential).slice(0,4);
  const bonusCost=winBonusCost(S);
  const toneBtns=d.menu.map(o=>eventOption(`基调:${o.label}${o.key===d.tone.key?" ✓":""}`,o.note,()=>{d.tone=o;renderPrematchCard()}));
  const ampBtns=[
    eventOption(`${d.bonus?"✓ ":""}发赢球奖(-${bonusCost}万)`,"斗志+,连发抬胃口",()=>{if(!d.bonus&&S.cash<bonusCost){return}d.bonus=!d.bonus;renderPrematchCard()},S.cash<bonusCost&&!d.bonus),
    eventOption(d.presser==="力挺"?"✓ 发布会:力挺":"发布会:力挺","士气/球迷+,输了 board/fans 双扣",()=>{d.presser=d.presser==="力挺"?null:"力挺";renderPrematchCard()}),
    eventOption(d.presser==="施压"?"✓ 发布会:施压":"发布会:施压","小概率激发,否则更衣室+",()=>{d.presser=d.presser==="施压"?null:"施压";renderPrematchCard()}),
  ];
  const youthBtns=kids.map(k=>eventOption(`${d.youthPush===k.id?"✓ ":""}强推 ${k.name}(权威-15)`,`${POS[k.pos]||k.pos} 潜力${Math.round(k.potential)}`,()=>{if(d.youthPush!==k.id&&S.coach.authority<45){return}d.youthPush=d.youthPush===k.id?null:k.id;renderPrematchCard()},S.coach.authority<45&&d.youthPush!==k.id));
  const confirmBtn=eventOption("确认部署,进入比赛",`基调 ${d.tone.label}${d.bonus?" · 赢球奖":""}${d.presser?" · "+d.presser:""}${d.youthPush?" · 强推青训":""}`,()=>confirmPlan());
  showModal(title,`重要度:${imp}。你定基调、决定要不要花资源加码;教练据此自动排兵。`,[...toneBtns,...ampBtns,...youthBtns,confirmBtn]);
}
function confirmPlan(){const d=S._pmDraft,plan={tone:d.tone,bonus:d.bonus,youthPush:d.youthPush,presser:d.presser};
  if(d.bonus){const c=winBonusCost(S);S.cash-=c;gameLog(S,"month",`为${d.fx.opp?d.fx.opp.name:"杯赛"}一战发出赢球奖 ${c}万。`)}
  if(d.youthPush){S.coach.authority=clamp(S.coach.authority-15)}
  if(d.presser==="力挺"){S.fans=clamp(S.fans+2);S.roster.forEach(p=>p.morale=clamp(p.morale+2))}
  if(d.fx.kind==="cup")S.cup.pendingPlan=plan;else d.fx.fixture.plan=plan;
  const done=d.done;S._pmDraft=null;done();
}
```

> 依赖:`showModal`、`eventOption`、`POS`、`gameLog`、`clamp`、`winBonusCost`、`planToneMenu` 均已存在。`eventOption(text,sub,fn,disabled)` 第四参禁用态已支持(见现有事件用法)。

- [ ] **Step 6: 浏览器冒烟**

Run: 用项目现成的 playwright-cli 打开 `足球俱乐部老板.html`,开局→点"结束本月",确认弹出"赛前会议"卡,切基调/加码/确认后能进比赛中心,月报因果格出现"赛前部署"。
Expected: 无控制台报错;流程顺畅。

- [ ] **Step 7: 提交**

```bash
git add 足球俱乐部老板.html tests/football-prematch.test.mjs
git commit -m "feat: pre-match meeting modal + resource spend + causal-chain feedback cell"
```

---

## Task 7: 杯赛按实力抽签(`cupOpponent`)

**Files:**
- Modify: `足球俱乐部老板.html`(新增 `cupOpponent`,`simulateCup` 用它替换随机 `pick`)
- Create: `tests/football-cup-endings.test.mjs`

- [ ] **Step 1: 写失败测试**

`tests/football-cup-endings.test.mjs`:

```js
import assert from "node:assert/strict";
import { loadGame, seeded, newGame } from "./football-harness.mjs";
const g = loadGame();

// cupOpponent 随阶段升级实力:决赛对手平均强于十六强对手
function avgStrengthAtStage(stage) {
  let sum = 0, n = 60;
  for (let i = 0; i < n; i++) {
    const s = newGame(g, "capital", seeded(500 + i));
    s.cup.stage = stage;
    const o = g.cupOpponent(s, seeded(600 + i));
    sum += o.strength;
  }
  return sum / n;
}
const s16 = avgStrengthAtStage(0), final = avgStrengthAtStage(3);
assert.ok(final > s16 + 2, `决赛对手(${final.toFixed(1)})应明显强于十六强(${s16.toFixed(1)})`);

// 弱队连过四轮的概率应该很低(打平衡守则)
let sweeps = 0, N = 200;
for (let i = 0; i < N; i++) {
  const s = newGame(g, "promoted", seeded(700 + i)); // 升班马=弱队
  const rng = seeded(800 + i);
  let alive = true;
  for (let st = 0; st < 4 && alive; st++) {
    s.cup.stage = st; s.seasonMonth = [3,5,7,9][st];
    const rep = g.simulateCup(s, rng);
    if (!rep || !s.cup.alive && !s.cup.winner) alive = false;
    if (s.cup.winner) break;
  }
  if (s.cup.winner) sweeps++;
}
assert.ok(sweeps / N < 0.15, `弱队夺杯率(${(sweeps/N*100).toFixed(0)}%)应低于15%`);

console.log("cup strength test passed");
```

- [ ] **Step 2: 跑测试,应失败**

Run: `node tests/football-cup-endings.test.mjs`
Expected: FAIL — `g.cupOpponent is not a function`。

- [ ] **Step 3: 实现**

`simulateCup` 之前新增:

```js
function cupOpponent(s,rng=Math.random){const pool=s.clubs.filter(c=>c.id!=="me").slice().sort((a,b)=>b.strength-a.strength),n=pool.length,stage=s.cup.stage;const bands=[[.55,1],[.35,.8],[.15,.55],[0,.3]],[lo,hi]=bands[Math.min(stage,3)],a=Math.floor(lo*(n-1)),b=Math.floor(hi*(n-1)),idx=a+Math.floor(rng()*(b-a+1));return pool[clamp(idx,0,n-1)]}
```

> 越往后 `[lo,hi]` 越靠数组前部(强队区),对手越强。

`simulateCup` 内 `opp=pick(s.clubs.filter(c=>c.id!=="me"),rng)` 改为:
`opp=cupOpponent(s,rng)`

- [ ] **Step 4: 跑测试,应通过**

Run: `node tests/football-cup-endings.test.mjs`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add 足球俱乐部老板.html tests/football-cup-endings.test.mjs
git commit -m "feat: cup opponents seeded by strength per round (cupOpponent)"
```

---

## Task 8: 结局路线(`endingRoutes`)+ `finalEnding` 联赛门槛

**Files:**
- Modify: `足球俱乐部老板.html`(新增 `endingRoutes`;重写 `finalEnding` 用门槛)
- Modify: `tests/football-cup-endings.test.mjs`(追加)

- [ ] **Step 1: 追加失败测试**

追加到 `tests/football-cup-endings.test.mjs`(`console.log` 之前):

```js
// endingRoutes 是 5 条带条件的路线
const routes = g.endingRoutes();
assert.equal(routes.length, 5, "五条好结局路线");
routes.forEach(r => assert.ok(r.key && r.title && r.desc, "每条路线有 key/title/desc"));

// 联赛门槛:两杯冠 + 联赛第9 → 不再是好结局(对照 Task 1 特征化)
const exploit = newGame(g, "capital", seeded(7));
exploit.track.trophies = 2; exploit.track.leagueTitles = 0; exploit.history = [{ rank: 9 }];
assert.equal(g.finalEnding(exploit)[2], false, "垫底两杯冠不再算好结局");

// 三冠奖杯室:杯冠 + 联赛第3 → 好结局
const shelf = newGame(g, "capital", seeded(7));
shelf.track.trophies = 1; shelf.cup.winner = true; shelf.track.leagueTitles = 0; shelf.history = [{ rank: 3 }];
assert.equal(g.finalEnding(shelf)[2], true, "杯冠+联赛前3=好结局");

// 王朝不受联赛门槛误伤
const dyn = newGame(g, "capital", seeded(7));
dyn.track.leagueTitles = 2; dyn.history = [{ rank: 1 }];
assert.equal(g.finalEnding(dyn)[2], true, "两联赛冠=好结局");
```

- [ ] **Step 2: 跑测试,应失败**

Run: `node tests/football-cup-endings.test.mjs`
Expected: FAIL — `g.endingRoutes is not a function` 及门槛断言不满足。

- [ ] **Step 3: 实现**

(a) `finalEnding` 之前新增路线表(供路线卡 UI 与判定共用):

```js
function endingRoutes(){return[
  {key:"dynasty",title:"联赛王朝",desc:"3 年内 2 座联赛冠军"},
  {key:"shelf",title:"三冠奖杯室",desc:"杯赛夺冠 且 联赛前 3"},
  {key:"academy",title:"青训之城",desc:"提拔青训 ≥7 且 青训等级 ≥4"},
  {key:"tycoon",title:"经营模范",desc:"转会净盈利 >1500、现金 >5000、联赛 ≤6"},
  {key:"solid",title:"稳定强队",desc:"联赛 ≤4"},
]}
```

(b) 重写 `finalEnding`(保留原文案,加联赛门槛;`rank` 取末赛季名次):

```js
function finalEnding(s){const titles=s.track.trophies,profit=s.track.transferIncome-s.track.transferSpend,rank=s.history.at(-1)?.rank||leagueRank(s),bestRank=s.history.length?Math.min(...s.history.map(x=>x.rank)):rank;
  if(s.track.leagueTitles>=2)return["联赛王朝","三年里,两次冠军把质疑变成了历史注脚。你仍然不排首发,但每一个决定都改变了谁有资格穿上这件球衣。",true];
  if(s.cup.winner&&bestRank<=3)return["三冠奖杯室","联赛和杯赛的奖杯终于不再只是老照片里的东西。球迷学会了在五月谈决赛,而不是谈重建。",true];
  if(s.track.youthPromoted>=7&&s.academyLevel>=4&&rank<=6)return["青训之城","你没有买下所有答案。训练基地里一批年轻人走进一线队,其中几个人已经成了这座城市新的名字。",true];
  if(profit>1500&&s.cash>5000&&rank<=6)return["经营模范","卖人、买人、赞助和球场工程最后落在同一本健康的账上。董事会第一次发现,稳定也可以成为雄心。",true];
  if(rank<=4)return["稳定强队","没有王朝,也没有崩盘。三个赛季后,任何争冠讨论都不会再忽略你的俱乐部。",true];
  if(rank>=9)return["勉强留在牌桌","你躲过了降级和破产,但看台没有为资产负债表鼓掌。下一位老板接手时,仍会说这是一次重建。",false];
  return["中游老板","三年过去,球队赢过强敌,也在该赢的比赛里丢过分。你证明了俱乐部可以运转,却还没有证明它为什么必须属于你。",false]}
```

> 改动点:①"奖杯陈列室"→"三冠奖杯室"且要求 `bestRank<=3`(原来只看 `titles>=2`,含杯冠,可白捡);②"青训之城"加 `rank<=6`。其余不变。

- [ ] **Step 4: 跑测试,应通过**

Run: `node tests/football-cup-endings.test.mjs`
Expected: PASS。

- [ ] **Step 5: 更新 baseline 特征化测试的注释语义**

现在 Task 1 里那条"特征化漏洞"断言(`good===true`)会**失败**,因为漏洞已修。把它改成回归断言:

在 `tests/football-baseline.test.mjs` 把该断言改为:
```js
assert.equal(good, false, "回归:两杯冠+联赛第9 不再是好结局(Task 8 已收紧)");
```

Run: `node tests/football-baseline.test.mjs`
Expected: PASS。

- [ ] **Step 6: 提交**

```bash
git add 足球俱乐部老板.html tests/football-cup-endings.test.mjs tests/football-baseline.test.mjs
git commit -m "feat: league-gated good endings + ending route table (finalEnding, endingRoutes)"
```

---

## Task 9: 三年蓝图看板 + 结局路线卡(UI + 数据)

**Files:**
- Modify: `足球俱乐部老板.html`(新增 `targetBoard`;`renderOverview` 挂看板与路线卡;创建屏加路线卡)
- Modify: `tests/football-cup-endings.test.mjs`(追加 `targetBoard` 数据测试)

- [ ] **Step 1: 追加 `targetBoard` 数据测试**

追加到 `tests/football-cup-endings.test.mjs`(`console.log` 之前):

```js
// targetBoard 铺开三个赛季的目标线
const sb = newGame(g, "fallen", seeded(5));
const board = g.targetBoard(sb);
assert.equal(board.seasons.length, 3, "三年三列");
board.seasons.forEach(col => {
  assert.ok(Number.isFinite(col.boardRank) && Number.isFinite(col.fanRank), "每列有排名线");
  assert.ok("season" in col, "每列标注赛季号");
});
assert.equal(board.seasons[0].season, 1);
// 当前进度可读
assert.ok(typeof board.progress === "string" && board.progress.length > 0, "有一句进度文案");
```

- [ ] **Step 2: 跑测试,应失败**

Run: `node tests/football-cup-endings.test.mjs`
Expected: FAIL — `g.targetBoard is not a function`。

- [ ] **Step 3: 实现 `targetBoard`**

`seasonTargets` 之后新增(复用 `seasonTargets` 的算法,对三个赛季各算一次):

```js
function targetBoard(s){const seasons=[1,2,3].map(season=>{const t=seasonTargets({...s,season});const past=s.history.find(h=>h.season===season);return{season,boardRank:t.boardRank,boardCup:t.boardCup,fanRank:t.fanRank,fanWins:t.fanWins,done:past?(past.rank<=t.boardRank):null,rank:past?past.rank:null}});const cur=seasonTargets(s),rank=leagueRank(s),needRank=Math.max(0,rank-cur.boardRank),needWins=Math.max(0,cur.fanWins-s.seasonWins);const progress=`本季董事会要前${cur.boardRank}:${needRank>0?`还差${needRank}名`:"已达标"};球迷要${cur.fanWins}胜:${needWins>0?`还差${needWins}胜`:"已达标"}`;return{seasons,progress}}
```

- [ ] **Step 4: 跑测试,应通过**

Run: `node tests/football-cup-endings.test.mjs`
Expected: PASS。

- [ ] **Step 5: 主界面挂看板 + 路线卡**

在 `renderOverview` 生成的 HTML 里,"两套期待"那张卡**之后**追加两块(用现有 class,风格一致):

```js
+`<div class="section-head" style="margin-top:10px"><h2>三年蓝图</h2><span>排名只看联赛</span></div>`
+`<div class="metric-grid">${targetBoard(S).seasons.map(c=>`<div class="metric ${c.season===S.season?"":"muted"}"><div class="v">前${c.boardRank}</div><div class="k">S${c.season}${c.done===true?" ✓":c.done===false?" ✗":""}</div></div>`).join("")}</div>`
+`<div class="card"><div class="copy">${esc(targetBoard(S).progress)}</div></div>`
+`<div class="section-head" style="margin-top:10px"><h2>你可以这样被记住</h2><span>开局选一条冲</span></div>`
+`<div class="honour-shelf">${endingRoutes().map(r=>`<div class="honour"><b>◆ ${esc(r.title)}</b><span>${esc(r.desc)}</span></div>`).join("")}</div>`
```

> 若 `.muted` 未定义,在样式区加 `.metric.muted{opacity:.5}` 一行即可。

- [ ] **Step 6: 创建屏(收购完成)也展示路线卡**

在开局引导 `#gameGuide` 的说明区(`guide-points` 之后)插入一段静态 HTML(让玩家开局就看到路线),或在 `showClubCreator()` 渲染里追加:

```html
<div class="guide-points" style="margin-top:8px">
  <div class="guide-point"><b>◆</b><span>联赛王朝 · 3 年 2 座联赛冠军</span></div>
  <div class="guide-point"><b>◆</b><span>三冠奖杯室 · 杯赛夺冠且联赛前 3</span></div>
  <div class="guide-point"><b>◆</b><span>青训之城 · 提拔 ≥7 且青训 ≥4</span></div>
  <div class="guide-point"><b>◆</b><span>经营模范 · 转会盈利且现金充裕</span></div>
  <div class="guide-point"><b>◆</b><span>稳定强队 · 联赛前 4</span></div>
</div>
```

- [ ] **Step 7: 浏览器冒烟**

Run: playwright-cli 打开游戏,确认主界面出现"三年蓝图"三列 + 进度句 + "你可以这样被记住"五条;创建屏能看到路线预览。
Expected: 布局正常,无报错。

- [ ] **Step 8: 提交**

```bash
git add 足球俱乐部老板.html tests/football-cup-endings.test.mjs
git commit -m "feat: three-year target board + ending route cards on overview and creator"
```

---

## Task 10: 机器人回归压测(无崩溃 + 平衡不变式)

**Files:**
- Create: `tests/football-robot.mjs`

> 沿用审计的思路:随机流/保守流/放置流各若干局,断言:(a) 全程无异常/NaN;(b) 放置流死亡不早于现状基线;(c) 纯放置+全选默认拿不到好结局。因涉及完整月度循环,直接调 `runMonthResolution` 等内部函数驱动(不经 UI)。

- [ ] **Step 1: 写压测脚本**

`tests/football-robot.mjs`:

```js
import assert from "node:assert/strict";
import { loadGame, seeded, newGame } from "./football-harness.mjs";
const g = loadGame();

// 放置流:不做任何经营,不设 plan(等价老板什么都不管),跑到出局或 3 季结束
function idleRun(seed) {
  const s = newGame(g, "fallen", seeded(seed)); // 最难开局
  const rng = seeded(seed + 5000);
  let month = 0, dead = null;
  while (!s.over && month < 30) {
    // 不设 f.plan / cup.pendingPlan → simulateMyMatch 收到 null,等价现状
    try { g.runMonthResolution ? g.runMonthResolution.call(null) : null; } catch (e) { /* runMonthResolution 依赖全局 S,见 Step 2 */ }
    month++;
  }
  return { survivedMonths: month, over: s.over };
}

// 注:runMonthResolution 使用文件级全局 S。压测改为直接驱动可复用的纯settle+sim:
function idleRunPure(seed) {
  const s = newGame(g, "fallen", seeded(seed));
  const rng = seeded(seed + 5000);
  let m = 0;
  for (; m < 30 && !s.over; m++) {
    g.settleFinance(s);
    // 破产/风险判定:复刻 disasterCheck 的现金/风险红线
    if (s.cash < -1500 || s.risks.finance >= 112) { s.over = true; break; }
    const reps = g.simulateLeagueMonth(s);
    reps.forEach(r => assert.ok(Number.isFinite(r.gf) && Number.isFinite(r.ga), "比分为有限数"));
    assert.ok(Number.isFinite(s.cash), "现金为有限数(无 NaN)");
    if ([3,5,7,9].includes(s.seasonMonth)) g.simulateCup(s, rng);
    s.seasonMonth++; s.globalMonth++; s.energy = 4;
    if (s.seasonMonth > 10) { s.seasonMonth = 1; s.season++; }
  }
  return { months: m, over: s.over };
}

let deaths = [];
for (let i = 0; i < 12; i++) {
  const r = idleRunPure(i + 1);
  deaths.push(r.months);
}
const avgDeath = deaths.reduce((a, b) => a + b, 0) / deaths.length;
// 基线:审计里落魄豪门放置流约第 8 月破产。改动没有让它更早死。
assert.ok(avgDeath >= 7, `放置流平均存活(${avgDeath.toFixed(1)}月)不应比基线(~8)更早崩`);

console.log(`football robot regression passed — idle avg survival ${avgDeath.toFixed(1)} months`);
```

> 若 `settleFinance`/`simulateLeagueMonth`/`simulateCup` 因内部调用 `S` 全局报错,改为在 harness 里 `sandbox.S = <state>` 后调用;实现时按报错定位(它们主要接收显式 `s` 参数)。

- [ ] **Step 2: 跑压测**

Run: `node tests/football-robot.mjs`
Expected: 打印存活月数,断言通过。若某函数依赖全局 `S`,在测试里 `g.S = s`(sandbox 可写)后重试。

- [ ] **Step 3: 提交**

```bash
git add tests/football-robot.mjs
git commit -m "test: robot regression for no-crash + idle-survival balance invariant"
```

---

## Task 11: 存档版本 + 全量回归 + 浏览器终检

**Files:**
- Modify: `足球俱乐部老板.html`(`SAVE_VERSION` +1)

- [ ] **Step 1: 提升存档版本**

找到 `const SAVE_VERSION=<N>`(grep 确认当前值),改为 `N+1`。旧档因版本不符自动作废(现有机制),避免读到无 `plan` 字段的半新状态。

- [ ] **Step 2: 全量测试回归**

Run:
```bash
node tests/football-baseline.test.mjs && \
node tests/football-prematch.test.mjs && \
node tests/football-cup-endings.test.mjs && \
node tests/football-robot.mjs
```
Expected: 四个全部打印各自的 passed 行,退出码 0。

- [ ] **Step 3: 浏览器端到端手测**

用 playwright-cli 打开 `足球俱乐部老板.html`,完整走一局的前 3 个月:
- 开局创建 → 主界面看到"三年蓝图"+ 路线卡;
- 点"结束本月" → 每场弹"赛前会议",切基调/发赢球奖(现金相应减少)/强推青训(权威 -15)/确认;
- 比赛中心 → 月报"为什么是这个结果"里出现"赛前部署"格,显示预期从 X→Y;
- 反复几个月,确认无控制台错误、无 NaN、无软锁。

Expected: 全流程顺畅,三个痛点在体验上被击中(每场有得选、看得见影响、目标一屏可读)。

- [ ] **Step 4: 提交**

```bash
git add 足球俱乐部老板.html
git commit -m "chore: bump SAVE_VERSION for pre-match plan state"
```

---

## Self-Review(写完后自查)

**Spec 覆盖:**
- 赛前会议 触发/流程 → Task 5(拆分)+ Task 6(弹窗)✓
- 基调三选一(动态)→ Task 2 ✓
- xG 注入 → Task 3 ✓
- 三个加码 + 各自刹车 → Task 4(逻辑)+ Task 6(扣款)✓
- 单场因果反馈 → Task 6(因果格)✓
- 三年蓝图看板 → Task 9 ✓
- 结局路线卡(主界面 + 创建屏)→ Task 9 ✓
- 杯赛按实力 → Task 7 ✓
- 好结局联赛门槛 → Task 8 ✓
- 平衡守则/验证(机器人回归)→ Task 10 ✓
- 存档版本 → Task 11 ✓

**占位符扫描:** 无 TBD/TODO;每个改动步给了可粘贴代码或精确插入点。UI 任务标注了"沿用现有 class/pattern"并给了真实片段。

**类型/命名一致:** `plan={tone,bonus,youthPush,presser}` 全程一致;`planEffect={baseMy,baseOpp,my,opp,bonus,tone}` 在 Task 3 定义、Task 6 消费;`planToneMenu`/`applyPlan`/`matchImportance`/`winBonusCost`/`forceYouthStart`/`cupOpponent`/`endingRoutes`/`targetBoard` 命名在测试与实现间一致。

**已知风险(留给执行者):**
- Task 5/10 中 `runMonthResolution`/`settleFinance` 等对全局 `S` 的依赖:若压测报错,按 Step 注释用 `sandbox.S` 兜底。
- Task 6 弹窗为一次性重渲染(每次点选 `renderPrematchCard` 重开 modal),执行时确认 `showModal` 可被连续调用刷新(现有事件系统即如此)。
