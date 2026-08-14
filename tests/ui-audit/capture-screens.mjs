import fs from "node:fs"; import vm from "node:vm";
import path from "node:path";import {fileURLToPath} from "node:url";
const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"../..");
const SRC=["足球俱乐部老板.html","index.html"].map(f=>path.join(ROOT,f)).find(p=>fs.existsSync(p));
const html=fs.readFileSync(SRC,"utf8");
const script=html.match(/<script>([\s\S]*)<\/script>/)[1];
const mkEl=(tag="div")=>{const el={tagName:tag,dataset:{},style:{},children:[],_cls:new Set(),_t:"",_h:"",value:"",disabled:false,
 appendChild(c){el.children.push(c);return c},get firstChild(){return el.children[0]||null},querySelectorAll:()=>[],addEventListener(){}};
 // 真 DOM 里 textContent 与 innerHTML 互相覆盖，shim 也必须这样，否则会读到上一次弹窗的残留
 Object.defineProperty(el,"innerHTML",{get:()=>el._h||"",set:v=>{el._h=String(v);el._t="";el.children=(String(v).match(/<button/g)||[]).map(()=>mkEl("button"))}});
 Object.defineProperty(el,"textContent",{get:()=>el._t||"",set:v=>{el._t=String(v);el._h="";el.children=[]}});
 el.classList={add:c=>el._cls.add(c),remove:c=>el._cls.delete(c),contains:c=>el._cls.has(c),toggle:(c,o)=>o?el._cls.add(c):el._cls.delete(c)};return el};
const nodes=new Map(),$=s=>{if(!nodes.has(s))nodes.set(s,mkEl());return nodes.get(s)};
const store={};const sb={console,Math,Date,setTimeout:f=>f(),clearTimeout(){},
 localStorage:{getItem:k=>store[k]??null,setItem:(k,v)=>store[k]=v,removeItem:k=>delete store[k]},
 document:{querySelector:$,getElementById:i=>$("#"+i),querySelectorAll:()=>[],createElement:mkEl,addEventListener(){}}};
sb.window=sb;sb.globalThis=sb;vm.createContext(sb);vm.runInContext(script,sb);sb.init();

const mask=$("#mask"),opts=$("#modalOptions");
const shots=[];
const snapModal=(name)=>{
  const buttons=opts.children.map(b=>`<button>${b.innerHTML||""}</button>`).join("");
  shots.push({name,kind:"modal",title:$("#modalTitle").textContent,
    body:$("#modalBody").innerHTML||`<span class="__txt">${$("#modalBody").textContent}</span>`,options:buttons});
};
let rs=987654321;const rnd=()=>((rs=(rs*1664525+1013904223)>>>0)/4294967296);
const wanted=new Map();
const drain=(pickIdx)=>{let g=0;
  while(mask.classList.contains("show")&&g++<600){
    const t=$("#modalTitle").textContent;
    if(!wanted.has(t)&&/赛前会议|比赛中心|月报|最后一轮|老队长|十七岁|秦百川|那篇没发出去|赛季复盘|俱乐部事件|预警|合同承诺|转会截止/.test(t)){
      wanted.set(t,1);snapModal(t);}
    const bs=opts.children.filter(b=>!b.disabled);
    const arr=bs.length?bs:opts.children;
    arr[pickIdx==null?Math.floor(rnd()*arr.length):Math.min(pickIdx,arr.length-1)].onclick();
  }};

sb.chooseArchetype("fallen");
$("#ownerInput").value="欧阳明诚";$("#cityInput").value="山城";$("#clubInput").value="山城竞技联合";
sb.startGame();drain();

// 玩到第 10 个月：拿到赛前会议、剧情、终局直播
for(let m=0;m<10;m++){
  const S=sb.FootballOwnerGame.getState();if(S.over)break;
  // 第一个月先把赛前会议原样拍下来（不点任何按钮）
  if(m===0){sb.doEndMonth();snapModal("赛前会议（原样）");}
  else sb.doEndMonth();
  drain();
  ["overview","squad","transfer","youth","coach","business","relations","schedule","world","history","log"].forEach(tab=>{
    sb.switchTab(tab);
    const key="tab:"+tab;
    if(!wanted.has(key)||m===9){wanted.set(key,1);
      const i=shots.findIndex(s=>s.name===key);
      const shot={name:key,kind:"panel",panel:$("#panel").innerHTML};
      if(i>=0)shots[i]=shot;else shots.push(shot);}
  });
}
// 顶部区域
shots.unshift({name:"顶部：数据条 / 预测 / 俱乐部条 / 行动",kind:"chrome",
  stats:$("#stats").innerHTML,forecast:$("#forecast").innerHTML,strip:$("#clubStrip").innerHTML,actions:$("#actions").innerHTML});
// 结算页
const S=sb.FootballOwnerGame.getState();
S.arcs.captain.outcome={title:"某某的号码被挂上看台",text:"他从青年队打到退役，最后一次走出球员通道时，全场站着。"};
S.arcs.rival.outcome={title:"这座城市的主人",text:"3胜2平1负。三年之后，德比这个词在本市指的是他们客场作战。"};
S.arcs.media.outcome={title:"年度人物：他把球队还给了这座城市",text:"那篇稿子被印在赛季手册的第一页。"};
S.arcs.wonderkid.outcome={title:"某某成了这座城市的名字",text:"从青训营到国家队，他没有换过俱乐部。看台上开始出现印着他名字的球衣。"};
sb.showEnd("三冠奖杯室","联赛和杯赛的奖杯终于不再只是老照片里的东西。球迷学会了在五月谈决赛，而不是谈重建。",true);
shots.push({name:"三年结算页",kind:"end",end:$("#endCard").innerHTML});
fs.writeFileSync(path.join(ROOT,"tests/ui-audit/shots.json"),JSON.stringify(shots,null,1));
console.log("captured",shots.length,"screens:",shots.map(s=>s.name).join(" | "));
