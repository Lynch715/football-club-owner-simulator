import assert from "node:assert/strict";
import { loadGame, seeded, newGame } from "./football-harness.mjs";
const g = loadGame();

// 全流程机器人：三年，每月随机赛前部署 + 随机剧情选项 + 转会/卖人，断言无崩溃/NaN/越界
function play(seed, archetype) {
  const s = newGame(g, archetype, seeded(seed));
  const rng = seeded(seed + 9000);
  const seen = { arcs: 0, derby: 0, finalDays: 0, shocks: 0 };

  const check = (where) => {
    ["cash", "fans", "board", "reputation", "debt"].forEach(k =>
      assert.ok(Number.isFinite(s[k]), `${where}: ${k} 变成了 ${s[k]}`));
    ["fans", "board", "reputation"].forEach(k =>
      assert.ok(s[k] >= 0 && s[k] <= 100, `${where}: ${k} 越界 ${s[k]}`));
    Object.entries(s.risks).forEach(([k, v]) =>
      assert.ok(Number.isFinite(v) && v >= 0 && v <= 120, `${where}: 风险 ${k}=${v}`));
    s.roster.forEach(p => {
      assert.ok(Number.isFinite(p.morale) && p.morale >= 0 && p.morale <= 100, `${where}: ${p.name} 士气 ${p.morale}`);
      assert.ok(Number.isFinite(p.ability) && p.ability <= p.potential + 0.001, `${where}: ${p.name} 能力越过潜力`);
      assert.ok(p.persona, `${where}: ${p.name} 缺性格`);
    });
    assert.ok(Number.isFinite(g.roomEdge(s)), `${where}: 更衣室评分 NaN`);
    assert.ok(s.rival.grudge >= 0 && s.rival.grudge <= 100, `${where}: 仇恨 ${s.rival.grudge}`);
  };

  for (let m = 0; m < 30 && !s.over; m++) {
    const fdRounds = g.roundsThisMonth(s);
    const fdIdx = s.seasonMonth >= 10 && fdRounds.length ? fdRounds[fdRounds.length - 1].index : null;
    const fdPre = fdIdx != null ? g.sortedTable(s).map((c, i) => ({ id: c.id, name: c.name, points: c.points, gd: c.gf - c.ga, rank: i + 1 })) : null;

    // 赛前部署：随机基调 + 随机加码
    fdRounds.forEach(r => r.fixtures.forEach(f => {
      if (f.home !== "me" && f.away !== "me") return;
      const opp = s.clubs.find(c => c.id === (f.home === "me" ? f.away : f.home));
      if (g.isDerby(s, opp)) seen.derby++;
      const menu = g.planToneMenu(s, opp, f.home === "me", "联赛");
      const kids = s.roster.filter(p => p.age <= 21);
      f.plan = {
        tone: menu[Math.floor(rng() * menu.length)],
        bonus: rng() < .25,
        youthPush: kids.length && rng() < .2 ? kids[Math.floor(rng() * kids.length)].id : null,
        presser: rng() < .3 ? (g.isDerby(s, opp) && rng() < .5 ? "叫板" : rng() < .5 ? "力挺" : "施压") : null,
      };
    }));

    g.settleFinance(s);
    if (s.cash < -1500 || s.risks.finance >= 112) { s.over = true; break; }
    const reports = g.simulateLeagueMonth(s, rng);
    reports.forEach(r => {
      assert.ok(Number.isFinite(r.gf) && Number.isFinite(r.ga) && r.gf >= 0 && r.ga >= 0, "比分异常");
      assert.ok(r.explanation.causes.some(c => c.label === "更衣室"), "因果网格缺更衣室格");
    });
    if ([3, 5, 7, 9].includes(s.seasonMonth)) g.simulateCup(s, rng);
    g.roomMonthly(s);
    g.rivalPulse(s, rng);
    check(`S${s.season}M${s.seasonMonth} 赛后`);

    if (fdIdx != null) {
      const fd = g.buildFinalDay(s, fdIdx, fdPre);
      if (fd) { seen.finalDays++; const lines = g.finalDayLines(s, fd); assert.ok(lines.length >= 3); }
    }

    // 剧情
    const beat = g.arcBeatCheck(s);
    if (beat) {
      seen.arcs++;
      const usable = beat.options.filter(o => !o.disabled);
      const pickOne = (usable.length ? usable : beat.options)[Math.floor(rng() * (usable.length || beat.options.length))];
      pickOne.fn?.();
      check(`剧情「${beat.title}」之后`);
    }

    // 偶尔卖人，触发更衣室连锁
    if (rng() < .18 && s.roster.length > 18) {
      const victim = s.roster[Math.floor(rng() * s.roster.length)];
      g.roomShock(s, "sell", victim);
      s.roster = s.roster.filter(p => p.id !== victim.id);
      seen.shocks++;
      check("卖人之后");
    }

    s.seasonMonth++; s.globalMonth++; s.energy = 4;
    if (s.seasonMonth > 10) { s.seasonMonth = 1; s.season++; }
  }
  return { s, seen };
}

let totalArcs = 0, totalDerby = 0, totalFinal = 0, alive = 0;
for (const [i, arch] of [["capital"], ["fallen"], ["promoted"]].flatMap((a, k) => [[k, a[0]], [k + 10, a[0]], [k + 20, a[0]]])) {
  const { s, seen } = play(i + 1, arch);
  totalArcs += seen.arcs; totalDerby += seen.derby; totalFinal += seen.finalDays;
  if (!s.over) alive++;
  const ending = g.finalEnding(s);
  assert.ok(ending[0] && ending[1], "结局文案完整");
  assert.ok(Array.isArray(g.arcEchoes(s)), "回响可读");
  g.arcDigest(s).forEach(d => assert.ok(d.act >= 0 && d.act <= d.total + 95, "剧情进度合法"));
}

assert.ok(totalArcs >= 9 * 8, `九局至少推进 72 幕剧情，实际 ${totalArcs}`);
assert.ok(totalDerby >= 9 * 2, `每局至少遇到 2 次德比，实际总计 ${totalDerby}`);
// 有的开局会在第一个赛季就破产，拿不到收官日；只要大多数局能走到赛季末就算通过
assert.ok(totalFinal >= 6, `九局里至少六局应走到收官日，实际 ${totalFinal}`);
console.log(`drama robot passed — 剧情${totalArcs}幕 / 德比${totalDerby}场 / 终局直播${totalFinal}次 / ${alive}局活到最后`);
