import assert from "node:assert/strict";
import { loadGame, seeded, newGame } from "./football-harness.mjs";
const g = loadGame();

/* ---------- 交易结构的算术 ---------- */
{
  const s = newGame(g, "capital", seeded(1));
  const p = s.market[0];
  const plain = g.emptyTerms();

  // 一次性付清：卖方眼里的价值 = 现金支出 = 报价
  assert.equal(g.offerWorth(s, p, 1000, plain), 1000);
  assert.equal(g.cashOutlay(s, p, 1000, plain), 1000);

  // 分期：卖方打折，你当期少掏
  const inst2 = { ...plain, installment: 1 }, inst3 = { ...plain, installment: 2 };
  assert.ok(g.offerWorth(s, p, 1000, inst2) < 1000, "分2期在卖方眼里贬值");
  assert.ok(g.offerWorth(s, p, 1000, inst3) < g.offerWorth(s, p, 1000, inst2), "分3期贬得更多");
  assert.ok(g.cashOutlay(s, p, 1000, inst3) < g.cashOutlay(s, p, 1000, inst2), "期数越多当期越轻");
  assert.ok(g.cashOutlay(s, p, 1000, inst2) < 1000, "分期确实减轻当期现金");

  // 奖金与分成：当期少付，卖方眼里反而更值钱
  const bonus = { ...plain, goalBonus: true }, sell = { ...plain, sellOn: 15 };
  assert.ok(g.offerWorth(s, p, 1000, bonus) > 1000 && g.cashOutlay(s, p, 1000, bonus) < 1000, "进球奖金：卖方加分、你少掏");
  assert.ok(g.offerWorth(s, p, 1000, sell) > 1000 && g.cashOutlay(s, p, 1000, sell) < 1000, "下家分成：同上");

  // 球员交换：拿走队里的人抵钱
  const mine = s.roster.slice().sort((a, b) => b.value - a.value)[3];
  const swap = { ...plain, swapId: mine.id };
  assert.ok(g.offerWorth(s, p, 1000, swap) > 1000, "交换球员计入卖方所得");
  assert.ok(g.cashOutlay(s, p, 1000, swap) < 1000, "交换球员抵掉现金");
  assert.equal(g.termsSummary(s, swap).includes(mine.name), true, "条款摘要写清换的是谁");
}

/* ---------- 多回合议价 ---------- */
{
  const s = newGame(g, "capital", seeded(2));
  const p = s.market.find(x => !x.rivalBid) || s.market[0];

  // 低价开局：会被还价，耐心递减，要价向你靠拢
  const d = g.startDeal(s, p, Math.round(p.ask * 0.5));
  assert.equal(d.patience, 3);
  const firstAsk = d.ask;
  const r1 = g.pushDeal(s, d, seeded(99));
  assert.ok(["counter", "collapse", "accept"].includes(r1));
  if (r1 === "counter") {
    assert.equal(d.patience, 2, "还价消耗一格耐心");
    assert.ok(d.ask <= firstAsk, `还价应该往下走：${firstAsk} → ${d.ask}`);
    assert.equal(d.round, 2);
  }

  // 耐心耗尽必然谈崩
  const d2 = g.startDeal(s, p, 10);
  let res, guard = 0;
  do { res = g.pushDeal(s, d2, () => 0.999); } while (res === "counter" && guard++ < 10);
  assert.equal(res, "collapse", "一直低价会把对方磨没耐心");

  // 高价 + 甜头必然成交
  const d3 = g.startDeal(s, p, Math.round(p.ask * 1.6));
  d3.terms.goalBonus = true;
  assert.ok(g.dealAcceptChance(s, d3) > 0.8, "远高于要价时接受概率应该很高");
  assert.equal(g.pushDeal(s, d3, () => 0.01), "accept");

  // 出价越高、条款越甜，接受概率越高（单调）
  const low = g.startDeal(s, p, Math.round(p.ask * 0.6));
  const high = g.startDeal(s, p, Math.round(p.ask * 1.1));
  assert.ok(g.dealAcceptChance(s, high) > g.dealAcceptChance(s, low), "报价越高越容易被接受");

  // 竞争报价会压低你的成功率
  const rivalled = g.startDeal(s, { ...p, rivalBid: { club: "某队", fee: p.ask * 1.4 } }, p.ask);
  rivalled.rivalFee = p.ask * 1.4;
  const clean = g.startDeal(s, p, p.ask);
  assert.ok(g.dealAcceptChance(s, rivalled) < g.dealAcceptChance(s, clean), "有人抢的时候更难谈");
}

/* ---------- 拍桌走人 ---------- */
{
  const s = newGame(g, "capital", seeded(3));
  const p = s.market[0];
  const d = g.startDeal(s, p, Math.round(p.ask * 0.8));
  const before = d.ask;
  const r = g.walkAway(s, d, () => 0.01);   // 必定回头
  assert.equal(r, "return");
  assert.ok(d.ask <= before, "对方回头时要价不会更高");
  assert.equal(d.walked, true);
  const d2 = g.startDeal(s, p, 10);
  assert.equal(g.walkAway(s, d2, () => 0.99), "gone", "运气不好就是没人回头");
}

/* ---------- 未来负债真的会被结算 ---------- */
{
  const s = newGame(g, "capital", seeded(4));
  g.ensureLedger(s);
  const cash0 = s.cash;
  g.addLiability(s, { type: "installment", amount: 300, dueMonth: s.globalMonth + 1, label: "某人转会" });
  g.settleLedger(s);
  assert.equal(s.cash, cash0, "没到期不扣钱");
  s.globalMonth += 2;
  const paid = g.settleLedger(s);
  assert.equal(paid.length, 1);
  assert.equal(s.cash, cash0 - 300, "到期扣款");
  assert.equal(g.ledgerSummary(s).owed, 0, "结清后从账上消失");

  // 进球奖金：达标才付
  const star = s.roster[0];
  g.addLiability(s, { type: "goalBonus", playerId: star.id, goals: star.goals + 3, amount: 250, club: "某队" });
  const c1 = s.cash;
  g.checkGoalBonuses(s);
  assert.equal(s.cash, c1, "没进够球不付");
  star.goals += 3;
  assert.equal(g.checkGoalBonuses(s).length, 1);
  assert.equal(s.cash, c1 - 250, "进够了就得付");

  // 下家分成：卖他的时候被抽走
  const p2 = s.roster[1];
  g.addLiability(s, { type: "sellOn", playerId: p2.id, pct: 20, club: "某队" });
  assert.equal(g.sellOnDue(s, p2, 1000), 200, "按比例分给原东家");
  assert.equal(g.sellOnDue(s, p2, 1000), 0, "只抽一次");
}

/* ---------- 外援与自定义名单 ---------- */
{
  const s = newGame(g, "fallen", seeded(5));
  const foreigners = s.roster.filter(p => p.foreign);
  assert.equal(foreigners.length, 4, "一线队应有 4 名外援");
  assert.ok(foreigners.every(p => p.pos !== "GK"), "外援不占门将名额");
  const locals = s.roster.filter(p => !p.foreign);
  assert.ok(foreigners.reduce((a, p) => a + p.ability, 0) / 4 >
            locals.reduce((a, p) => a + p.ability, 0) / locals.length, "外援通常是队里最强的几个");

  assert.deepEqual([...g.parseNameList("张三\n李四，王五、赵六;张三")], ["张三", "李四", "王五", "赵六"], "分隔符与去重");
  assert.equal([...g.parseNameList("")].length, 0);
  const s2 = newGame(g, "capital", seeded(6));
  g.saveNameList("甲\n乙\n丙");
  const used = g.renameSquad(s2);
  assert.equal(used, 3, "名单按顺序发下去");
  assert.deepEqual([...s2.roster.slice(0, 3).map(p => p.name)], ["甲", "乙", "丙"]);
  g.saveNameList("");
  assert.equal(g.renameSquad(s2), 0, "清空后不再改名");
}


/* ---------- 挂牌、兜售与竞价 ---------- */
{
  const s = newGame(g, "fallen", seeded(7));
  const p = s.roster.slice().sort((a, b) => b.ability - a.ability)[2];
  const m0 = p.morale;
  const price = g.setListPrice(s, p, 0.85);
  assert.equal(p.listed, true);
  assert.ok(price < p.value, "清仓价低于身价");
  assert.ok(p.morale < m0, "被贱卖会掉士气");
  assert.ok(g.listedPrice(p) === price);

  // 标价越低越多人问
  // 球员 id 带时间戳，不同局之间对不上，按排序位置取同一个人
  const cheap = newGame(g, "fallen", seeded(7)), dear = newGame(g, "fallen", seeded(7));
  const byAbility = st => st.roster.slice().sort((a, b) => b.ability - a.ability)[2];
  const pc = byAbility(cheap), pd = byAbility(dear);
  g.setListPrice(cheap, pc, 0.85); g.setListPrice(dear, pd, 1.5);
  const club = cheap.clubs.find(c => c.id !== "me");
  assert.ok(g.bidInterest(cheap, pc, club) > g.bidInterest(dear, pd, club), "便宜的更多人问");

  // 兜售能拿回报价，且结构各不相同
  let sawStyles = new Set(), sawOffers = 0;
  for (let i = 0; i < 25; i++) {
    const s2 = newGame(g, "fallen", seeded(200 + i));
    const q = s2.roster.slice().sort((a, b) => b.ability - a.ability)[2];
    g.setListPrice(s2, q, 0.85);
    const offers = g.shopPlayer(s2, q, seeded(300 + i));
    sawOffers += offers.length;
    offers.forEach(o => {
      sawStyles.add(o.style);
      assert.ok(o.cashNow <= o.fee, "当期到账不会超过总价");
      assert.ok(o.playerWilling >= 0 && o.playerWilling <= 100);
    });
  }
  assert.ok(sawOffers > 0, "清仓价应该有人问");
  assert.ok(sawStyles.size >= 3, `报价结构应该有多种，实际 ${[...sawStyles].join()}`);

  // 成交：现金进账、人离队、分期尾款挂到未来
  const s3 = newGame(g, "fallen", seeded(9));
  const q3 = s3.roster[5];
  g.setListPrice(s3, q3, 1.1);
  const offer = { id: "x", playerId: q3.id, club: "某某队", clubId: "club1", fee: 800, style: "installment", cashNow: 400, note: "分两期", rival: false };
  const cash0 = s3.cash;
  g.acceptBid(s3, q3, offer);
  assert.equal(s3.cash, cash0 + 400, "先到账一半");
  assert.ok(!s3.roster.some(x => x.id === q3.id), "人已经走了");
  assert.equal(g.ensureLedger(s3).filter(x => x.type === "installment").length, 1, "尾款挂在账上");
  assert.equal(s3.track.transferIncome, 800, "收入按总价记");

  // 卖给宿敌要付球迷代价
  const s4 = newGame(g, "fallen", seeded(11));
  const q4 = s4.roster[6], foe = g.rivalClub(s4);
  const fans0 = s4.fans, grudge0 = s4.rival.grudge;
  g.acceptBid(s4, q4, { id: "y", playerId: q4.id, club: foe.name, clubId: foe.id, fee: 600, style: "cash", cashNow: 600, note: "一次性", rival: true });
  assert.ok(s4.fans < fans0 - 5, "卖给宿敌球迷大跌");
  assert.ok(s4.rival.grudge > grudge0, "仇恨上升");
}

/* ---------- 截止日大戏 ---------- */
{
  const s = newGame(g, "capital", seeded(13));
  const beats = g.deadlineBeats(s, seeded(14));
  assert.ok(beats.length >= 1, "截止日应该有戏");
  beats.forEach(b => {
    assert.ok(b.title && b.body && typeof b.options === "function");
    const opts = b.options();
    assert.ok(opts.length >= 2, "每个选择至少两条路");
    opts.forEach(o => assert.ok(o.text && typeof o.fn === "function"));
  });
  // 卖掉球员那条路：人真的会走，钱真的会到
  const s2 = newGame(g, "capital", seeded(13));
  const star = g.deadlineStar(s2);
  const b2 = g.deadlineBeats(s2, seeded(14)).find(x => x.key === "lateBid");
  if (b2) {
    const cash0 = s2.cash, n0 = s2.roster.length;
    b2.options()[0].fn();
    assert.equal(s2.roster.length, n0 - 1, "接受报价后少一个人");
    assert.ok(s2.cash > cash0, "钱到账");
    assert.ok(!s2.roster.some(p => p.id === star.id));
  }
  // 最多同时来两件事，别把玩家淹死
  for (let i = 0; i < 20; i++) {
    const s3 = newGame(g, "capital", seeded(400 + i));
    assert.ok(g.pickDeadlineBeats(s3, seeded(500 + i)).length <= 2, "截止日最多两件事");
  }
}

console.log("football transfer test passed");
