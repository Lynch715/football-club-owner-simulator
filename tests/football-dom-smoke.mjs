// 无浏览器的 UI 冒烟：给游戏一个假 DOM，让 init/渲染/弹窗全部真跑一遍
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const gameFile = ["足球俱乐部老板.html", "index.html"]
  .map(f => path.join(root, f)).find(p => fs.existsSync(p));
if (!gameFile) throw new Error("未找到游戏 HTML（足球俱乐部老板.html / index.html）");
const html = fs.readFileSync(gameFile, "utf8");
const script = html.match(/<script>([\s\S]*)<\/script>/)[1];

const mkEl = (tag = "div") => {
  const el = {
    tagName: tag, value: "", disabled: false, _t: "", _h: "",
    dataset: {}, style: {}, children: [], onclick: null, _cls: new Set(),
    appendChild(c) { this.children.push(c); return c },
    get firstChild() { return this.children[0] || null },
    querySelectorAll: () => [],
    addEventListener() {},
  };
  el.classList = {
    add: c => el._cls.add(c), remove: c => el._cls.delete(c),
    contains: c => el._cls.has(c), toggle: (c, on) => on ? el._cls.add(c) : el._cls.delete(c),
  };
  // 真 DOM 里 textContent 与 innerHTML 互相覆盖，shim 也必须这样
  Object.defineProperty(el, "innerHTML", {
    get() { return el._h || "" },
    set(v) {
      el._h = String(v); el._t = "";
      const n = (el._h.match(/<button/g) || []).length;
      el.children = Array.from({ length: n }, () => mkEl("button"));
    },
  });
  Object.defineProperty(el, "textContent", {
    get() { return el._t || "" },
    set(v) { el._t = String(v); el._h = ""; el.children = [] },
  });
  return el;
};
const nodes = new Map();
const $ = sel => { if (!nodes.has(sel)) nodes.set(sel, mkEl()); return nodes.get(sel) };
const store = {};
const sandbox = {
  console, Math, Date, setTimeout: fn => fn(), clearTimeout() {},
  localStorage: { getItem: k => store[k] ?? null, setItem: (k, v) => store[k] = v, removeItem: k => delete store[k] },
  document: {
    querySelector: $, getElementById: id => $("#" + id),
    querySelectorAll: () => [], createElement: mkEl, addEventListener() {},
  },
};
sandbox.window = sandbox;
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(script, sandbox);
sandbox.init();

const mask = $("#mask"), opts = $("#modalOptions");
let clicks = 0, seenTitles = new Set();
let rngState = 20260814;
const rnd = () => ((rngState = (rngState * 1664525 + 1013904223) >>> 0) / 4294967296);

function drainModals(limit = 4000) {
  let guard = 0;
  while (mask.classList.contains("show") && guard++ < limit) {
    seenTitles.add($("#modalTitle").textContent);
    const btns = opts.children.filter(b => !b.disabled);
    const b = (btns.length ? btns : opts.children)[Math.floor(rnd() * (btns.length || opts.children.length))];
    assert.ok(b && typeof b.onclick === "function", "弹窗必须有可点的按钮，否则会软锁");
    clicks++;
    b.onclick();
  }
  assert.ok(guard < limit, "弹窗链没有收敛，可能存在死循环");
}

// 建队
sandbox.chooseArchetype("capital");
$("#ownerInput").value = "林远"; $("#cityInput").value = "山城"; $("#clubInput").value = "山城竞技";
sandbox.startGame();
drainModals();

const S0 = sandbox.FootballOwnerGame.getState();
assert.ok(S0 && S0.roster.length > 20, "开局阵容就位");
assert.ok($("#panel").innerHTML.includes("更衣室"), "总览面板出现更衣室卡");
assert.ok($("#panel").innerHTML.includes("宿敌"), "总览面板出现宿敌卡");
assert.ok($("#panel").innerHTML.includes("正在发生的故事"), "总览面板出现剧情看板");
assert.ok(!/undefined|NaN|\[object Object\]/.test($("#panel").innerHTML), "总览面板没有 undefined/NaN");

// 逐月推进三年，每一屏都渲染，每一个弹窗都点
let months = 0;
for (let m = 0; m < 32; m++) {
  const S = sandbox.FootballOwnerGame.getState();
  if (S.over) break;
  months++;
  sandbox.doEndMonth();
  drainModals();
  ["overview", "squad", "transfer", "youth", "coach", "business", "relations", "schedule", "world", "history", "log"]
    .forEach(tab => {
      sandbox.switchTab(tab);
      const h = $("#panel").innerHTML;
      assert.ok(h.length > 20, `${tab} 面板渲染为空`);
      assert.ok(!/undefined|NaN/.test(h), `${tab} 面板出现 undefined/NaN`);
    });
  sandbox.switchTab("overview");
}

const S = sandbox.FootballOwnerGame.getState();
assert.ok(months >= 10, `至少推进十个月，实际 ${months}`);
assert.ok([...seenTitles].some(t => /赛前会议/.test(t)), "出现过赛前会议");
assert.ok([...seenTitles].some(t => /比赛中心/.test(t)), "出现过比赛中心");
assert.ok([...seenTitles].some(t => /最后一轮|老队长|十七岁|秦百川|那篇没发出去的稿子/.test(t)), "出现过剧情或终局直播");
assert.ok(S.arcMeta.lastMonth > 0, "剧情引擎跑起来了");

// 存档往返：戏剧层状态必须能被 JSON 存下来再读回去
{
  const raw = JSON.parse(JSON.stringify(sandbox.FootballOwnerGame.getState()));
  assert.ok(raw.version >= 3, "存档带版本号");
  assert.ok(raw.room && raw.rival && raw.arcs && raw.arcMeta, "更衣室/宿敌/剧情都进了存档");
  sandbox.FootballOwnerGame.setState(raw);
  sandbox.switchTab("overview");
  const h = $("#panel").innerHTML;
  assert.ok(h.includes("更衣室") && h.includes("宿敌") && h.includes("正在发生的故事"), "读档后戏剧层面板照常");
  assert.ok(!/undefined|NaN/.test(h), "读档后面板没有 undefined/NaN");
}

console.log(`dom smoke passed — 推进${months}个月 / 点击${clicks}次 / 弹窗类型${seenTitles.size}种 / 结局:${S.over ? S.endData?.title : "任期内"}`);
