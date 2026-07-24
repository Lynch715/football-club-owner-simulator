# football-club-owner-simulator

单文件文字模拟经营游戏：足球俱乐部老板三赛季。

**在线试玩**：https://lynch715.github.io/football-club-owner-simulator/

## 玩法

你是俱乐部老板,不排首发——负责买卖球员、青训、赞助、球场和教练,比赛到点自动结算。三个赛季后,奖杯、债务和青训一起算账。

**赛前会议**:每场比赛前定一个「基调」(全力抢攻 / 铁桶偷分 / 轮换保人…,菜单随主客与强弱动态变化),看得见地改变预期进球;还能花资源加码——发赢球奖(现金)、强推青训妖人首发(教练权威)、发布会定调(赌人心),各自都带代价。赛后月报给出「赛前部署 → 预期变化 → 实际比分」的因果复盘。

**三年蓝图**:主界面常驻三赛季目标看板;开局摊牌五条结局路线——联赛王朝 / 奖杯陈列室 / 青训之城 / 经营模范 / 稳定强队,自己挑一条冲。杯赛对手按阶段升级实力,好结局需要真正的联赛成绩,不再靠白捡杯冠。

## 开发

游戏是单文件,全部逻辑在 `index.html` 的 `<script>` 内。逻辑测试**零依赖**,用 Node 内置 `vm` 把脚本载入无 DOM 沙箱、以种子 RNG 断言:

```bash
node tests/football-baseline.test.mjs
node tests/football-prematch.test.mjs
node tests/football-cup-endings.test.mjs
node tests/football-robot.mjs
```

设计方案与实施计划见 `docs/superpowers/`。
