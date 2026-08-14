import fs from "node:fs";
// 每次都从游戏文件现取样式，别用缓存 —— 审计只看排版，把两张大图换成同色渐变
import path from "node:path";import {fileURLToPath} from "node:url";
const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"../..");
const GAME=["足球俱乐部老板.html","index.html"].map(f=>path.join(ROOT,f)).find(p=>fs.existsSync(p));
const gameHtml=fs.readFileSync(GAME,"utf8");
const css=gameHtml.slice(gameHtml.indexOf("<style>")+7,gameHtml.indexOf("</style>"))
  .replace(/--hero-image:url\("data:[^"]*"\)/,'--hero-image:url(HERO)')
  .replace(/url\("data:[^"]*"\)/g,'url(IMG)')
  .replace('--hero-image:url(HERO)','--hero-image:linear-gradient(160deg,#22402c,#0e1a12)')
  .replace(/--banner-image:url\(IMG\)/,'--banner-image:linear-gradient(115deg,#24422e,#101a13)')
  .replace(/url\(IMG\)/g,'none');
const shots=JSON.parse(fs.readFileSync(path.join(ROOT,"tests/ui-audit/shots.json"),"utf8"));

// 去重：每种弹窗形态留一个最有代表性的（选项最多 / 正文最长）
const keep=[],seenKind=new Map();
const kindOf=n=>n.startsWith("tab:")?n:n.replace(/\s\d+\/\d+.*/,"").replace(/·.*/,"").replace(/第\d赛季\d+月/,"月报").trim();
for(const s of shots){
  const k=s.kind==="modal"?kindOf(s.name):s.name;
  const score=(s.options||"").length+(s.body||"").length;
  const prev=seenKind.get(k);
  if(!prev||score>prev.score){seenKind.set(k,{shot:s,score});}
}
for(const {shot} of seenKind.values())keep.push(shot);
const order=["chrome","modal","panel","end"];
keep.sort((a,b)=>order.indexOf(a.kind)-order.indexOf(b.kind)||a.name.localeCompare(b.name,"zh"));

const modalHTML=s=>`<div class="modal"><h2>${s.title||""}</h2><div class="modal-body">${s.body||""}</div><div class="modal-options">${s.options||""}</div></div>`;
const bodyOf=s=>s.kind==="chrome"?`<section class="stats">${s.stats}</section><section class="forecast">${s.forecast}</section><section class="club-strip">${s.strip}</section><section class="actions">${s.actions}</section>`
  :s.kind==="modal"?modalHTML(s)
  :s.kind==="end"?`<div class="end-card">${s.end}</div>`
  :`<section id="panel-like">${s.panel}</section>`;

const screens=keep.map((s,i)=>({id:"s"+i,name:s.name,kind:s.kind,html:bodyOf(s)}));

const frameDoc=inner=>`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}
html,body{background:var(--bg)}body{padding:6px}
#panel-like{border:1px solid var(--line);background:#131d17;padding:8px;border-radius:5px}
.modal,.end-card{margin:0 auto}
</style></head><body><div id="app" style="padding:0">${inner}</div>
<script>${DETECTOR}<\/script></body></html>`;

const DETECTOR=`
(function(){
 const findings=[];
 const scrollableX=el=>{const o=getComputedStyle(el);return /(auto|scroll)/.test(o.overflowX)};
 document.querySelectorAll("#app *").forEach(el=>{
  const cs=getComputedStyle(el);
  if(cs.display==="none"||!el.getClientRects().length)return;
  const over=el.scrollWidth-el.clientWidth;
  if(over>1&&!scrollableX(el)){
   const clipped=cs.textOverflow==="ellipsis"||cs.overflow==="hidden";
   findings.push({sel:path(el),over,type:clipped?"截断":"溢出",text:(el.textContent||"").trim().slice(0,40)});
   el.style.outline="2px solid "+(clipped?"#ffb020":"#ff3b30");
   el.style.outlineOffset="1px";
  }
 });
 // 弹窗高度：超过 90vh 会被压成滚动条；决策类弹窗更严重（确认键掉到折叠线以下）
 document.querySelectorAll(".modal,.end-card").forEach(el=>{
  const h=el.scrollHeight,vh=window.innerHeight,opts=el.querySelectorAll(".modal-options button");
  // 新版弹窗自己分区滚动：真正要查的是「最后一个按钮是否还在弹窗可视区里」
  if(opts.length){
   const last=opts[opts.length-1],lr=last.getBoundingClientRect(),er=el.getBoundingClientRect();
   // 掉出弹窗只有在「够不到」时才算问题：任一祖先能滚动就还够得到
   let reachable=false;
   for(let p=last.parentElement;p&&p!==el.parentElement;p=p.parentElement){
    const o=getComputedStyle(p);
    if(/(auto|scroll)/.test(o.overflowY)&&p.scrollHeight>p.clientHeight+1){reachable=true;break}
   }
   if(!reachable&&(lr.bottom>er.bottom+1||lr.top<er.top-1))
    findings.push({sel:".modal-options button:last-child",over:Math.round(lr.bottom-er.bottom),type:"确认键够不到",text:(last.textContent||"").trim().slice(0,20)});
   const needScroll=[...opts].some(b=>{const r=b.getBoundingClientRect();return r.bottom>er.bottom+1});
   if(needScroll)findings.push({sel:".modal-options",over:opts.length,type:"按钮区需要滚动",text:opts.length+"个按钮，最后一个要滚才看得到"});
  }
  if(h>vh*0.9){
   const decision=opts.length>1;
   findings.push({sel:decision?".modal(决策弹窗)":".modal(报告弹窗)",over:Math.round(h-vh*0.9),
    type:decision?"决策弹窗超高":"报告弹窗超高",text:Math.round(h)+"px > 90vh("+Math.round(vh*0.9)+"px)，"+opts.length+"个按钮"});
   if(decision)el.style.outline="2px solid #ff3b30";
  }
  if(opts.length>8)findings.push({sel:".modal-options",over:opts.length,type:"选项过多",text:opts.length+"个按钮堆在一屏"});
 });
 // 窄格里的文字被折成一条竖带。注意 grid 子项默认 stretch，量盒子会误判 —— 量文字行盒
 const lineBoxes=el=>{const r=document.createRange();r.selectNodeContents(el);return r.getClientRects().length};
 document.querySelectorAll(".live-event b,.final-line b,.fixture .when,.fixture-top .when,.news-date,.legend-rank,.pos,.stat .value,.metric .v,.outlook,.factor-chip").forEach(el=>{
  if(el.querySelector("br"))return;              // 本来就写了换行的不算
  const lines=lineBoxes(el);
  if(lines>1){findings.push({sel:path(el),over:lines,type:"窄列堆叠",text:(el.textContent||"").trim().slice(0,26)+" → 折成"+lines+"行"});el.style.outline="2px solid #ff9500"}
 });
 // 横向滚动条卡片被压成细长条
 document.querySelectorAll(".honour").forEach(el=>{
  const r=el.getBoundingClientRect();
  if(r.height>150){findings.push({sel:".honour",over:Math.round(r.height),type:"卡片被压成细长条",text:(el.textContent||"").trim().slice(0,26)});el.style.outline="2px solid #ff9500"}
 });
 function path(el){let p=el.tagName.toLowerCase();if(el.className&&typeof el.className==="string")p+="."+el.className.trim().split(/\\s+/).slice(0,2).join(".");return p}
 parent.postMessage({audit:true,name:document.title,findings},"*");
})();`;

// 需要在 frameDoc 之前定义 DETECTOR —— 重新组装
const build=inner=>`<!doctype html><html><head><meta charset="utf-8"><title>frame</title><style>${css}
html,body{background:var(--bg)}body{padding:6px;margin:0}
#panel-like{border:1px solid var(--line);background:#131d17;padding:8px;border-radius:5px}
.modal,.end-card{margin:0 auto}
</style></head><body><div id="app" style="padding:0">${inner}</div><script>${DETECTOR}<\/script></body></html>`;

const esc=s=>s.replace(/&/g,"&amp;").replace(/"/g,"&quot;").replace(/</g,"&lt;").replace(/>/g,"&gt;");

const page=`<!doctype html><html lang="zh"><head><meta charset="utf-8">
<title>足球俱乐部老板 · UI 审计台</title>
<style>
body{margin:0;background:#0b120e;color:#edf2eb;font-family:"PingFang SC","Microsoft YaHei",system-ui,sans-serif}
header{position:sticky;top:0;z-index:99;background:#0b120e;border-bottom:1px solid #3b4b41;padding:12px 16px}
h1{font-size:17px;margin:0 0 6px}
#summary{font-size:13px;line-height:1.7}
#summary .ok{color:#86c95e}#summary .bad{color:#ff6a5e}#summary .warn{color:#ffb020}
#list{max-height:34vh;overflow:auto;font-size:12px;margin-top:8px;border-top:1px solid #3b4b41;padding-top:6px}
#list div{padding:2px 0;border-bottom:1px solid #1e2a22}
.screen{padding:18px 16px;border-bottom:1px solid #22302a}
.screen h2{font-size:14px;color:#dfb85d;margin:0 0 8px}
.pair{display:flex;gap:16px;align-items:flex-start}
.col{flex:0 0 auto}
.col span{display:block;font-size:11px;color:#a6b0a8;margin-bottom:4px}
iframe{border:1px solid #3b4b41;background:#101814;border-radius:4px}
.desk iframe{width:1000px;height:var(--h,700px)}
.mob iframe{width:390px;height:var(--h,700px)}
</style></head><body>
<header>
 <h1>《模拟足球老板》UI 审计台 <span style="font-size:11px;color:#a6b0a8">左：桌面 1000px　右：手机 390px　红框=内容溢出　黄框=文字被截断</span></h1>
 <div id="summary">正在测量…</div>
 <div id="list"></div>
</header>
${screens.map(s=>`<section class="screen"><h2>${esc(s.name)}</h2><div class="pair">
 <div class="col desk"><span>桌面 1000px</span><iframe data-name="${esc(s.name)}｜桌面" srcdoc="${esc(build(s.html))}"></iframe></div>
 <div class="col mob"><span>手机 390px</span><iframe data-name="${esc(s.name)}｜手机" srcdoc="${esc(build(s.html))}"></iframe></div>
</div></section>`).join("\n")}
<script>
const all=[];let done=0;const total=document.querySelectorAll("iframe").length;
addEventListener("message",e=>{
 if(!e.data||!e.data.audit)return;done++;
 const fr=[...document.querySelectorAll("iframe")].find(f=>f.contentWindow===e.source);
 const name=fr?fr.dataset.name:"?";
 e.data.findings.forEach(f=>all.push({...f,name}));
 if(fr){try{fr.style.height=Math.min(2600,fr.contentDocument.documentElement.scrollHeight+16)+"px"}catch(_){}}
 if(done>=total)report();
});
function report(){
 const bad=all.filter(f=>f.type!=="截断"),cut=all.filter(f=>f.type==="截断");
 document.getElementById("summary").innerHTML=
  \`共 \${total} 个画面。<span class="\${bad.length?"bad":"ok"}">溢出/超高/堆叠 \${bad.length} 处</span> · <span class="\${cut.length?"warn":"ok"}">文字截断 \${cut.length} 处</span>\`;
 const groups={};all.forEach(f=>{(groups[f.type]=groups[f.type]||[]).push(f)});
 const keys=Object.keys(groups).sort((a,b)=>groups[b].length-groups[a].length);
 document.getElementById("list").innerHTML=all.length?keys.map(k=>{
  const rows=groups[k],seen=new Set(),uniq=rows.filter(f=>{const key=f.sel+"|"+f.text;if(seen.has(key))return false;seen.add(key);return true});
  return \`<div style="margin-top:6px"><b style="color:\${k==="截断"?"#ffb020":"#ff6a5e"}">■ \${k} × \${rows.length}</b></div>\`+
   uniq.slice(0,8).map(f=>\`<div style="padding-left:14px">\${f.name} — <code>\${f.sel}</code> — \${f.text}\`+(f.over?\` (+\${f.over})\`:"")+\`</div>\`).join("")+
   (uniq.length>8?\`<div style="padding-left:14px;color:#a6b0a8">…另有 \${uniq.length-8} 种同类</div>\`:"");
 }).join(""):'<div class="ok">没有发现溢出、截断或堆叠。</div>';
}
setTimeout(()=>{if(done<total)report()},4000);
// 浏览器里没法手动滚（审计时只有截图权限），页面自己走
let auto=null;
function startAuto(){if(auto)return;auto=setInterval(()=>{
 const y=scrollY;scrollBy(0,innerHeight-140);
 if(scrollY<=y+2)scrollTo(0,0);},5000)}
setTimeout(startAuto,6000);
<\/script></body></html>`;
fs.writeFileSync(path.join(ROOT,"ui-audit.html"),page);
console.log("screens:",screens.length,"| bytes:",page.length);
