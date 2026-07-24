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
  const ra = g.simulateMyMatch(sa, oa, true, "联赛", seeded(400 + i), { tone: { key: "attack", my: 1.18, opp: 1.1, injury: .02 }, bonus: false });
  attackGF += ra.gf;
  const sp = newGame(g, "capital", seeded(300 + i));
  const op = sp.clubs.find(c => c.id !== "me");
  const rp = g.simulateMyMatch(sp, op, true, "联赛", seeded(400 + i), { tone: { key: "park", my: 0.82, opp: 0.72, injury: 0 }, bonus: false });
  parkGF += rp.gf;
}
assert.ok(attackGF > parkGF, `抢攻总进球(${attackGF})应高于铁桶(${parkGF})`);

// planEffect 被写进 report 供反馈用
const sx = newGame(g, "capital", seeded(9));
const ox = sx.clubs.find(c => c.id !== "me");
const rx = g.simulateMyMatch(sx, ox, true, "联赛", seeded(9), { tone: { key: "park", label: "铁桶偷分", my: 0.82, opp: 0.72, injury: 0 }, bonus: false });
assert.ok(rx.planEffect && rx.planEffect.baseMy > 0 && rx.planEffect.my <= rx.planEffect.baseMy, "planEffect 记录 base→调整后");

// 赢球奖成本为正
const sc = newGame(g, "fallen", seeded(3));
assert.ok(g.winBonusCost(sc) > 0, "赢球奖成本为正");

// 强推青训:被指定的年轻球员一定首发(apps>0),赢/平则成长
// 注:球员 id 用 Date.now() 生成,跨 state 不稳定,故每次从当前 state 取 kid
let grew = false;
for (let i = 0; i < 60 && !grew; i++) {
  const s2 = newGame(g, "promoted", seeded(11));
  const k2 = s2.roster.slice().sort((a, b) => a.ability - b.ability).find(p => p.age <= 21) || s2.roster.slice().sort((a, b) => a.ability - b.ability)[0];
  const ab0 = k2.ability;
  const e2 = s2.clubs.slice().sort((a, b) => a.strength - b.strength)[0];
  const r = g.simulateMyMatch(s2, e2, true, "联赛", seeded(900 + i), { tone: { key: "attack", my: 1.18, opp: 1.1, injury: .02 }, bonus: false, youthPush: k2.id });
  assert.ok(k2.apps > 0, "强推的球员必首发(apps>0)");
  if (r.gf >= r.ga && k2.ability > ab0) grew = true;
}
assert.ok(grew, "强推青训在不败时应有成长");

// 发布会"力挺"输球:board 下降
let dropped = false;
for (let i = 0; i < 60 && !dropped; i++) {
  const s3 = newGame(g, "capital", seeded(21));
  const b3 = s3.clubs.slice().sort((a, b) => b.strength - a.strength)[0];
  const bb = s3.board;
  const r = g.simulateMyMatch(s3, b3, false, "联赛", seeded(1200 + i), { tone: { key: "park", my: 0.82, opp: 0.72, injury: 0 }, bonus: false, presser: "力挺" });
  if (r.gf < r.ga && s3.board < bb) dropped = true;
}
assert.ok(dropped, "力挺后输球,董事会信心下降");

// buildMatchNarrative 在有 plan 时,causes 里应出现"赛前部署"格
const sn = newGame(g, "capital", seeded(31));
const on = sn.clubs.find(c => c.id !== "me");
const rn = g.simulateMyMatch(sn, on, true, "联赛", seeded(31), { tone: { key: "park", label: "铁桶偷分", my: 0.82, opp: 0.72, injury: 0 }, bonus: true });
assert.ok(rn.explanation.causes.some(c => c.label.includes("赛前部署")), "因果网格含赛前部署格");

console.log("prematch test passed");
