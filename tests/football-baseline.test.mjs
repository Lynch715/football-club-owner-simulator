import assert from "node:assert/strict";
import { loadGame, seeded, newGame } from "./football-harness.mjs";

const g = loadGame();

// 引擎可加载、状态完整
const s = newGame(g, "capital", seeded(1));
assert.ok(s.roster.length >= 20, "开局一线队应有球员");
assert.ok(s.clubs.length >= 8, "应有联赛球队");
assert.equal(s.season, 1);

// 比赛能跑出有随机方差的比分
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
assert.equal(good, false, "回归:两杯冠+联赛第9 不再是好结局(Task 8 已收紧)");

console.log("football baseline test passed");
