import assert from "node:assert/strict";
import { loadGame, seeded, newGame } from "./football-harness.mjs";
const g = loadGame();

// 放置流机器人:不做任何经营、不设 plan(等价老板什么都不管),直接驱动
// 核心结算+比赛循环。目的:回归"无崩溃/无 NaN + 放置流不比基线更早死"。
// 注:这是真实月循环的近似(跳过事件/预警/赛季复盘/市场刷新),用于平衡回归而非精确复现。
function idleRun(seed) {
  const s = newGame(g, "fallen", seeded(seed)); // 最难开局
  const rng = seeded(seed + 5000);
  let months = 0;
  for (; months < 30 && !s.over; months++) {
    g.settleFinance(s);
    assert.ok(Number.isFinite(s.cash), "现金必须是有限数(无 NaN)");
    // 破产红线:复刻 disasterCheck 的现金/财务风险判定
    if (s.cash < -1500 || s.risks.finance >= 112) { s.over = true; break; }
    const reps = g.simulateLeagueMonth(s, rng);
    reps.forEach(r => assert.ok(Number.isFinite(r.gf) && Number.isFinite(r.ga), "比分为有限数"));
    if ([3, 5, 7, 9].includes(s.seasonMonth) && s.cup.alive) g.simulateCup(s, rng);
    s.seasonMonth++; s.globalMonth++; s.energy = 4;
    if (s.seasonMonth > 10) { s.seasonMonth = 1; s.season++; s.cup = { alive: true, stage: 0, winner: false, results: [] }; }
  }
  return { months, over: s.over };
}

const deaths = [];
for (let i = 0; i < 12; i++) deaths.push(idleRun(i + 1).months);
const avg = deaths.reduce((a, b) => a + b, 0) / deaths.length;
// 基线:落魄豪门放置流约第 8 月崩。改动不应让它更早死。
assert.ok(avg >= 7, `放置流平均存活(${avg.toFixed(1)}月)不应比基线(~8)更早崩`);

console.log(`football robot regression passed — idle avg survival ${avg.toFixed(1)} months (${deaths.join(",")})`);
