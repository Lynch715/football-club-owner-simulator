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
    s.cup.stage = st; s.seasonMonth = [3, 5, 7, 9][st];
    const rep = g.simulateCup(s, rng);
    if (!rep || (!s.cup.alive && !s.cup.winner)) alive = false;
    if (s.cup.winner) break;
  }
  if (s.cup.winner) sweeps++;
}
assert.ok(sweeps / N < 0.15, `弱队夺杯率(${(sweeps / N * 100).toFixed(0)}%)应低于15%`);

// endingRoutes 是 5 条带条件的路线
const routes = g.endingRoutes();
assert.equal(routes.length, 5, "五条好结局路线");
routes.forEach(r => assert.ok(r.key && r.title && r.desc, "每条路线有 key/title/desc"));

// 联赛门槛:两杯冠 + 联赛第9 → 不再是好结局(对照 baseline 特征化)
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

// targetBoard 铺开三个赛季的目标线
const sb = newGame(g, "fallen", seeded(5));
const board = g.targetBoard(sb);
assert.equal(board.seasons.length, 3, "三年三列");
board.seasons.forEach(col => {
  assert.ok(Number.isFinite(col.boardRank) && Number.isFinite(col.fanRank), "每列有排名线");
  assert.ok("season" in col, "每列标注赛季号");
});
assert.equal(board.seasons[0].season, 1);
assert.ok(typeof board.progress === "string" && board.progress.length > 0, "有一句进度文案");

console.log("cup + endings + board test passed");
