import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import {fileURLToPath} from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");

// 载入游戏唯一 <script> 到无 DOM 沙箱。init() 被 typeof document 守卫,不会自动运行。
export function loadGame() {
  // 仓库里游戏以 index.html 发布,本地开发文件名为 足球俱乐部老板.html —— 两者都支持
  const candidates = ["index.html", "足球俱乐部老板.html"];
  const file = candidates.map(f => path.join(root, f)).find(p => fs.existsSync(p));
  if (!file) throw new Error("未找到游戏 HTML(index.html / 足球俱乐部老板.html)");
  const html = fs.readFileSync(file, "utf8");
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
