import assert from "node:assert/strict";
import { loadGame, seeded, newGame } from "./football-harness.mjs";
const g = loadGame();

/* ---------- 更衣室生态 ---------- */
{
  const s = newGame(g, "fallen", seeded(1));
  s.roster.forEach(p => assert.ok(p.persona, "每名球员都有性格"));
  const cap = g.captainOf(s);
  assert.ok(cap && s.roster.some(p => p.id === cap.id), "队长来自一线队");
  assert.equal(g.captainOf(s).id, cap.id, "队长稳定，不会每次重选");

  const st = g.roomState(s);
  assert.ok(st.mood >= 0 && st.mood <= 100, "气氛在 0-100");
  assert.ok(typeof st.label === "string" && st.label.length, "气氛有文案");
  assert.ok(Number.isFinite(g.roomEdge(s)), "更衣室评分是有限数");

  // 卖掉队长 = 全队士气下滑 + 队长空缺
  const s2 = newGame(g, "fallen", seeded(1));
  const cap2 = g.captainOf(s2);
  const before = s2.roster.reduce((a, p) => a + p.morale, 0) / s2.roster.length;
  g.roomShock(s2, "sell", cap2);
  s2.roster = s2.roster.filter(p => p.id !== cap2.id);
  const after = s2.roster.reduce((a, p) => a + p.morale, 0) / s2.roster.length;
  assert.ok(after < before, `卖队长后全队士气应下滑 ${before.toFixed(1)}→${after.toFixed(1)}`);
  assert.equal(s2.room.captainId, null, "队长位置被清空");
  assert.notEqual(g.captainOf(s2).id, cap2.id, "会自动产生新队长");

  // 气氛好 → 评分加成为正；气氛差 → 为负
  const hi = newGame(g, "capital", seeded(4)); hi.roster.forEach(p => p.morale = 92); hi.room.tension = 0;
  const lo = newGame(g, "capital", seeded(4)); lo.roster.forEach(p => p.morale = 12); lo.room.tension = 80;
  assert.ok(g.roomEdge(hi) > g.roomEdge(lo), "气氛越好，比赛评分加成越高");
  assert.ok(g.roomEdge(hi) > 0 && g.roomEdge(lo) < 0, "高低气氛应分居正负");

  // 气氛真的进入 xG
  const oppH = hi.clubs.find(c => c.id !== "me"), oppL = lo.clubs.find(c => c.id !== "me");
  assert.ok(g.matchPreview(hi, oppH, true).myXgRaw > g.matchPreview(lo, oppL, true).myXgRaw, "气氛影响预期进球");
}

/* ---------- 宿敌与德比 ---------- */
{
  const s = newGame(g, "promoted", seeded(2));
  const foe = g.rivalClub(s);
  assert.ok(foe && foe.id !== "me", "开局就有固定宿敌");
  assert.equal(g.isDerby(s, foe), true, "对阵宿敌 = 德比");
  assert.equal(g.isDerby(s, s.clubs.find(c => c.id !== "me" && c.id !== foe.id)), false, "其他对手不是德比");
  assert.equal(g.matchImportance(s, foe, "联赛"), "同城德比", "德比有专属重要度");

  const fans0 = s.fans, grudge0 = s.rival.grudge;
  g.settleDerby(s, 2, 0, null);
  assert.equal(s.rival.w, 1, "德比胜场入账");
  assert.ok(s.fans > fans0, "赢德比球迷上涨");
  assert.ok(s.rival.grudge > grudge0, "赢德比也会推高仇恨");

  // 叫板：赢加倍收益，输加倍代价
  const win = newGame(g, "promoted", seeded(2)), lose = newGame(g, "promoted", seeded(2));
  const wf = win.fans, lf = lose.fans;
  g.settleDerby(win, 1, 0, { presser: "叫板" });
  g.settleDerby(lose, 0, 1, { presser: "叫板" });
  assert.ok(win.fans - wf > 5, "叫板赢球，球迷大涨");
  assert.ok(lf - lose.fans > 5, "叫板输球，球迷大跌");

  // 赌约结算
  const bet = newGame(g, "promoted", seeded(2));
  bet.rival.bet = { stake: 300 };
  const cash0 = bet.cash;
  g.settleDerby(bet, 3, 1, null);
  assert.equal(bet.cash, cash0 + 300, "赢下赌约现金到账");
  assert.equal(bet.rival.bet, null, "赌约结算后清空");

  // 仇恨拉满时宿敌会主动出手
  let acted = 0;
  for (let i = 0; i < 40; i++) {
    const s3 = newGame(g, "capital", seeded(300 + i));
    s3.rival.grudge = 95;
    if (g.rivalPulse(s3, seeded(400 + i))) acted++;
  }
  assert.ok(acted > 0, "高仇恨下宿敌会挖人/截胡/放话");
  const calm = newGame(g, "capital", seeded(9)); calm.rival.grudge = 20;
  assert.equal(g.rivalPulse(calm, seeded(9)), null, "低仇恨时宿敌不主动找事");
}

/* ---------- 人物故事弧 ---------- */
{
  const ids = Object.keys(g.arcTable());
  assert.equal(ids.length, 4, "四条故事线");
  ids.forEach(id => {
    assert.equal(g.arcTable()[id].beats.length, 4, `${id} 应为四幕`);
    g.arcTable()[id].beats.forEach((b, i) => {
      assert.ok(Number.isFinite(b.when), `${id} 第${i + 1}幕要有触发月`);
      assert.equal(typeof b.run, "function", `${id} 第${i + 1}幕要可运行`);
    });
  });

  // 早期不触发；到点触发；同月不连发
  const s = newGame(g, "fallen", seeded(3));
  s.globalMonth = 1;
  assert.equal(g.arcBeatCheck(s), null, "开局第一个月不触发剧情");
  s.globalMonth = 6;
  const beat = g.arcBeatCheck(s);
  assert.ok(beat && beat.title && beat.body && beat.options.length, "到点触发一张有选项的剧情卡");
  assert.equal(g.arcBeatCheck(s), null, "同一个月不会连着推两幕");

  // 选项真的改变状态
  const s2 = newGame(g, "fallen", seeded(3));
  s2.globalMonth = 6;
  const b2 = g.arcBeatCheck(s2);
  const snapshot = JSON.stringify([s2.cash, s2.fans, s2.board, s2.reputation, s2.roster.map(p => p.morale)]);
  b2.options[0].fn && b2.options[0].fn();
  assert.notEqual(JSON.stringify([s2.cash, s2.fans, s2.board, s2.reputation, s2.roster.map(p => p.morale)]), snapshot, "剧情选项应产生实际后果");

  // 全流程：跑满三年，四条线都能推进到第四幕并给出结局
  const s3 = newGame(g, "capital", seeded(11));
  const rng = seeded(77);
  for (let m = 1; m <= 30; m++) {
    s3.globalMonth = m;
    const b = g.arcBeatCheck(s3);
    if (b) b.options[Math.floor(rng() * b.options.length)].fn?.();
  }
  const digest = g.arcDigest(s3);
  assert.equal(digest.length, 4, "看板列出四条线");
  digest.forEach(d => assert.ok(d.act >= 4, `${d.name} 三年内应演完（当前 ${d.act}/${d.total}）`));
  assert.ok(g.arcEchoes(s3).length >= 1, "结算时至少留下一条回响");
  assert.ok(s3.clubHistory.milestones.length > 0, "剧情收尾会写进队史");
}

/* ---------- 赛季末决战直播 ---------- */
{
  const s = newGame(g, "capital", seeded(5));
  const pre = g.sortedTable(s).map((c, i) => ({ id: c.id, name: c.name, points: c.points, gd: c.gf - c.ga, rank: i + 1 }));
  const idx = s.schedule.length - 1;
  s.schedule[idx].forEach(f => { f.result = { gf: 1, ga: 0 }; f.played = true; });

  assert.equal(g.buildFinalDay(s, null, pre), null, "非收官月不做终局直播");
  const fd = g.buildFinalDay(s, idx, pre);
  assert.ok(fd && ["title", "survival", "mid"].includes(fd.race), "识别出争冠/保级/中游");
  assert.ok(fd.order.length >= 1, "有其他场次可供逐条播报");
  const lines = g.finalDayLines(s, fd);
  assert.ok(lines.length >= 3, "至少三条播报");
  assert.equal(lines[0].tag, "开场");
  assert.equal(lines[lines.length - 1].tag, "终场");
  lines.forEach(l => assert.ok(l.text && l.text.length > 4, "每条播报都有内容"));

  // 保级剧本
  const doomed = newGame(g, "promoted", seeded(6));
  const table = g.sortedTable(doomed);
  const preBad = table.map((c, i) => ({ id: c.id, name: c.name, points: c.points, gd: 0, rank: c.id === "me" ? table.length : (i + 1) }));
  preBad.sort((a, b) => a.rank - b.rank);
  const idx2 = doomed.schedule.length - 1;
  doomed.schedule[idx2].forEach(f => { f.result = { gf: 0, ga: 1 }; });
  const fd2 = g.buildFinalDay(doomed, idx2, preBad);
  assert.equal(fd2.race, "survival", "垫底时应进入保级日剧本");
}


/* ---------- 真实中超队名 + 宿敌降级 ---------- */
{
  // 三档开局各绑一段真实德比
  const pairs = { fallen: ["上海申花", "上海海港"], promoted: ["辽宁铁人", "大连英博"], capital: ["青岛西海岸", "青岛海牛"] };
  for (const [arch, [mine, foeName]] of Object.entries(pairs)) {
    const s = g.initialState({ ownerName: "测试", city: "城", clubName: mine, archetype: arch }, seeded(3));
    assert.equal(g.rivalClub(s).name, foeName, `${arch} 的宿敌应是 ${foeName}`);
    assert.equal(g.matchImportance(s, g.rivalClub(s), "联赛"), "同城德比");
    assert.equal(s.npcs.find(n => n.id === "rival").role, `${foeName}老板`, "宿敌老板头衔跟着球队走");
  }
  const s = newGame(g, "fallen", seeded(4));
  const fake = /海星|岭南先锋|东海联|金陵城|九牛|齐鲁泰岳|长安联合|江城码头|辽河竞技|南州凤凰|河洛|滨海蓝鲸|云岭飞鹰|楚州雄狮|松江竞技|天府星火|燕山联/;
  assert.ok(!fake.test(s.clubs.map(c => c.name).join()), "联赛里不应再有虚构队名");
  assert.equal(s.clubs.length, 12, "联赛仍是 12 队");

  // 宿敌降级：战绩留下来，故事线不能卡住，面板也不能空掉
  const rel = newGame(g, "capital", seeded(5));
  const foe = g.rivalClub(rel);
  rel.rival.w = 3; rel.rival.l = 1;
  rel.world.lastRelegated = [{ id: foe.id, name: foe.name }];
  rel.clubs = g.prepareNextSeasonClubs(rel, seeded(6));
  assert.equal(rel.rival.gone, true, "宿敌降级应被记下来");
  assert.equal(rel.rival.goneName, foe.name, "记住降级前的名字");
  assert.equal(g.rivalClub(rel), null, "降级后不再是联赛对手");
  assert.equal(g.rivalName(rel), foe.name, "名字仍然可读，故事线不会变成 undefined");
  assert.ok(rel.clubHistory.milestones.some(m => m.title.includes(foe.name)), "降级写进队史");
  rel.globalMonth = 6;
  const beat = g.arcBeatCheck(rel, true);
  assert.ok(beat && !/undefined/.test(beat.body), "宿敌降级后剧情仍能推进且没有 undefined");
}

console.log("football drama test passed");
