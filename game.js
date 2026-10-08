'use strict';
(() => {
const canvas = document.getElementById('game'), ctx = canvas.getContext('2d');
const W = 420, H = 640, R = 21, STEP = R * 2, DY = Math.sqrt(3) * R;
const DANGER_Y = 522;
const TOP = 30, ROWS = 14, LAUNCH = {x: W / 2, y: 584};
const names = ['水星','金星','地球','火星','木星','土星','天王星','海王星','冥王星'];
const colors = ['#a8b7c8','#edc574','#51b5ed','#e67d66','#daaa83','#e7d29d','#8cd9d4','#688fea','#c4a7df'];
const status = document.getElementById('status');
let board = new Map(), shot = null, aim = -Math.PI / 2, current = 0, next = 1, busy = false, flashes = [], last = 0, drag = false, activePointer = null, gameOver = false;
const unlocked = new Set([0,1,2]);
const overlay = document.getElementById('game-over');
const key = (r,c) => `${r},${c}`;
const cells = [];
for(let r=0;r<ROWS;r++) for(let c=0;c<(r%2?9:10);c++) cells.push({r,c,x:R+c*STEP+(r%2?R:0),y:TOP+r*DY});
const neighbors = p => cells.filter(q=>q!==p && Math.abs(Math.hypot(q.x-p.x,q.y-p.y)-STEP)<0.1);
// Every unlocked level has a positive weight; later planets are rarer.
const levelWeight = level => 1 / Math.pow(2, level);
function randomLevel(){
 const levels=[...unlocked].sort((a,b)=>a-b);
 let roll=Math.random()*levels.reduce((sum,level)=>sum+levelWeight(level),0);
 for(const level of levels){roll-=levelWeight(level);if(roll<0)return level;}
 return levels[levels.length-1];
}
const upperFirst = (a,b) => a.r-b.r || a.c-b.c;
function checkGameOver(){
 if(![...board.values()].some(p=>p.y+R>=DANGER_Y))return false;
 gameOver=true;busy=false;shot=null;drag=false;activePointer=null;
 overlay.hidden=false;canvas.style.cursor='default';
 status.textContent='危険ラインに到達しました。「もう一度遊ぶ」で再開できます。';
 document.getElementById('retry').focus();return true;
}
const stars = Array.from({length:65},(_,i)=>({x:(i*113.7)%W,y:(i*79.3)%H,r:i%5===0?1.3:0.7}));
function labels(){
 document.getElementById('current').textContent=names[current];document.getElementById('next').textContent=names[next];
 document.querySelectorAll('.evo').forEach((el,i)=>{el.classList.toggle('locked',!unlocked.has(i));el.title=unlocked.has(i)?'発射可能':'合体でアンロック';});
 document.getElementById('available').textContent=[...unlocked].sort((a,b)=>a-b).map(i=>names[i]).join('・');
}
function reset(){board.clear();shot=null;busy=false;flashes=[];aim=-Math.PI/2;drag=false;activePointer=null;gameOver=false;last=0;unlocked.clear();[0,1,2].forEach(i=>unlocked.add(i));overlay.hidden=true;canvas.style.cursor='crosshair';current=0;next=1;for(const p of cells) if(p.r<3 && (p.r<2 || p.c%3!==1)) board.set(key(p.r,p.c),{...p,level:(p.c+2*p.r)%3});labels();status.textContent='方向を合わせて、クリック／指を離して発射';}
function planet(x,y,level,alpha=1){
 const radius=R*(0.59+level*0.041);ctx.save();ctx.globalAlpha=alpha;
 if(level===5){ctx.strokeStyle='#e7d29d99';ctx.lineWidth=5;ctx.beginPath();ctx.ellipse(x,y,R*.95,R*.32,-.35,0,Math.PI*2);ctx.stroke();}
 const g=ctx.createRadialGradient(x-radius*.35,y-radius*.4,1,x,y,radius);g.addColorStop(0,'#ffffff');g.addColorStop(.16,colors[level]);g.addColorStop(1,'#26334f');ctx.fillStyle=g;ctx.beginPath();ctx.arc(x,y,radius,0,Math.PI*2);ctx.fill();
 ctx.save();ctx.beginPath();ctx.arc(x,y,radius,0,Math.PI*2);ctx.clip();ctx.globalAlpha=alpha*.3;ctx.fillStyle=level===2?'#77e6a0':'#fff';
 for(let i=0;i<3;i++){ctx.beginPath();ctx.ellipse(x+Math.sin(i*3+level)*radius*.45,y+(i-1)*radius*.45,radius*.36,radius*.14,.4,0,Math.PI*2);ctx.fill();}ctx.restore();
 ctx.fillStyle='#fff';ctx.font='bold 10px sans-serif';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(level+1,x,y+1);ctx.restore();
}
// The same fixed-step collision path drives both flight and the aiming preview.
function advance(p, distance){
 let remaining=distance;
 while(remaining>0){const step=Math.min(2,remaining);remaining-=step;p.x+=p.vx*step;p.y+=p.vy*step;
 if(p.x<R){p.x=2*R-p.x;p.vx=Math.abs(p.vx);}if(p.x>W-R){p.x=2*(W-R)-p.x;p.vx=-Math.abs(p.vx);}
 if(p.y<=TOP){p.y=TOP;return {ceiling:true};}
 let hit=null, best=Infinity;for(const q of board.values()){const d=Math.hypot(p.x-q.x,p.y-q.y);if(d<=STEP && d<best){best=d;hit=q;}}if(hit)return {planet:hit};
 }return null;
}
function landing(p,hit){
 const candidates=hit.planet?neighbors(hit.planet):cells.filter(q=>q.r===0);
 return candidates.filter(q=>!board.has(key(q.r,q.c))).sort((a,b)=>Math.hypot(a.x-p.x,a.y-p.y)-Math.hypot(b.x-p.x,b.y-p.y))[0];
}
function settle(p,hit){
 const cell=landing(p,hit);
 if(!cell){status.textContent='近くに空きマスがありません。「はじめから」で再開できます。';shot=null;busy=false;return;}
 let placed={...cell,level:p.level};board.set(key(cell.r,cell.c),placed);let merges=0;const newUnlocks=[];
 // Resolve around the surviving upper cell; equal-height ties use the left cell.
 while(true){
 const match=neighbors(placed).map(q=>board.get(key(q.r,q.c))).filter(q=>q&&q.level===placed.level).sort(upperFirst)[0];if(!match)break;
 merges++;
 if(placed.level===8){
 board.delete(key(match.r,match.c));board.delete(key(placed.r,placed.c));
 [placed,match].forEach(q=>flashes.push({x:q.x,y:q.y,t:0,color:colors[8]}));break;
 }
 const survivor=upperFirst(placed,match)<=0?placed:match;
 const removed=survivor===placed?match:placed;
 board.delete(key(removed.r,removed.c));
 flashes.push({x:removed.x,y:removed.y,t:0,color:colors[removed.level]});
 survivor.level++;placed=survivor;
 if(!unlocked.has(placed.level)){unlocked.add(placed.level);newUnlocks.push(names[placed.level]);}
 flashes.push({x:placed.x,y:placed.y,t:0,color:colors[placed.level]});
 }
 shot=null;busy=false;labels();
 // Merges finish first, so a planet rescued by an upward merge is safe.
 if(checkGameOver())return;
 current=next;next=randomLevel();labels();
 status.textContent=newUnlocks.length?`${newUnlocks.join('・')}をアンロック！ 発射候補に追加しました`:merges>1?`${merges}連鎖！ 惑星が進化しました`:merges?'合体！ 惑星が進化しました':'方向を合わせて、次の惑星を発射';
}
function fire(){if(busy||gameOver)return;busy=true;shot={...LAUNCH,vx:Math.cos(aim),vy:Math.sin(aim),level:current};status.textContent='惑星が飛行中…';}
function target(e){if(gameOver||busy)return;const rect=canvas.getBoundingClientRect();const x=(e.clientX-rect.left)*W/rect.width,y=(e.clientY-rect.top)*H/rect.height;aim=Math.max(-Math.PI+.14,Math.min(-.14,Math.atan2(Math.min(-10,y-LAUNCH.y),x-LAUNCH.x)));}
canvas.addEventListener('pointerdown',e=>{if(busy||gameOver||activePointer!==null||e.isPrimary===false||e.button!==0)return;drag=true;activePointer=e.pointerId;target(e);canvas.setPointerCapture(e.pointerId);});
canvas.addEventListener('pointermove',e=>{if(!busy&&!gameOver && (e.pointerType==='mouse'||(drag&&e.pointerId===activePointer)))target(e);});
canvas.addEventListener('pointerup',e=>{if(!drag||e.pointerId!==activePointer||gameOver)return;drag=false;activePointer=null;target(e);fire();});
canvas.addEventListener('pointercancel',e=>{if(e.pointerId===activePointer){drag=false;activePointer=null;}});
canvas.addEventListener('lostpointercapture',()=>{drag=false;activePointer=null;});
document.getElementById('reset').addEventListener('click',reset);
document.getElementById('retry').addEventListener('click',()=>{reset();document.getElementById('reset').focus();});
function draw(dt){
 ctx.clearRect(0,0,W,H);ctx.fillStyle='#0b1328';ctx.fillRect(0,0,W,H);ctx.fillStyle='#b4ceff55';for(const s of stars){ctx.beginPath();ctx.arc(s.x,s.y,s.r,0,Math.PI*2);ctx.fill();}
 ctx.strokeStyle='#72ded74d';ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(0,8);ctx.lineTo(W,8);ctx.stroke();
 for(const p of cells){ctx.fillStyle='#7793bc0c';ctx.beginPath();ctx.arc(p.x,p.y,2,0,Math.PI*2);ctx.fill();}
 ctx.save();ctx.strokeStyle='#f08a9a99';ctx.lineWidth=1.5;ctx.setLineDash([7,6]);ctx.beginPath();ctx.moveTo(0,DANGER_Y);ctx.lineTo(W,DANGER_Y);ctx.stroke();ctx.setLineDash([]);ctx.fillStyle='#f3a0af';ctx.font='9px sans-serif';ctx.textAlign='left';ctx.fillText('DANGER / 危険ライン',12,DANGER_Y-8);ctx.restore();
 if(!busy&&!gameOver){const preview={...LAUNCH,vx:Math.cos(aim),vy:Math.sin(aim)};let hit=null;ctx.fillStyle='#a4e8e0a0';for(let i=0;i<100;i++){hit=advance(preview,10);if(hit)break;ctx.beginPath();ctx.arc(preview.x,preview.y,1.5,0,Math.PI*2);ctx.fill();}if(hit){const cell=landing(preview,hit);if(cell){ctx.strokeStyle='#80e4dc70';ctx.lineWidth=1;ctx.beginPath();ctx.arc(cell.x,cell.y,R-2,0,Math.PI*2);ctx.stroke();}}}
 for(const p of board.values())planet(p.x,p.y,p.level);
 for(const f of flashes){f.t+=dt;ctx.globalAlpha=Math.max(0,1-f.t/.5);ctx.strokeStyle=f.color;ctx.lineWidth=2;ctx.beginPath();ctx.arc(f.x,f.y,R+f.t*50,0,Math.PI*2);ctx.stroke();}ctx.globalAlpha=1;flashes=flashes.filter(f=>f.t<.5);
 // Fixed hull and rotating turret share the unchanged launch center.
 ctx.save();ctx.translate(LAUNCH.x,LAUNCH.y);
 ctx.fillStyle='#6ee9df55';ctx.beginPath();ctx.moveTo(-18,20);ctx.lineTo(-13,37);ctx.lineTo(-8,20);ctx.moveTo(8,20);ctx.lineTo(13,37);ctx.lineTo(18,20);ctx.fill();
 ctx.fillStyle='#243c59';ctx.strokeStyle='#659fae';ctx.lineWidth=1.5;ctx.beginPath();ctx.moveTo(0,-24);ctx.lineTo(17,-3);ctx.lineTo(38,23);ctx.lineTo(17,17);ctx.lineTo(0,24);ctx.lineTo(-17,17);ctx.lineTo(-38,23);ctx.lineTo(-17,-3);ctx.closePath();ctx.fill();ctx.stroke();
 ctx.fillStyle='#83e6ed';ctx.beginPath();ctx.moveTo(0,-17);ctx.lineTo(8,-3);ctx.lineTo(-8,-3);ctx.closePath();ctx.fill();
 ctx.rotate(aim+Math.PI/2);ctx.fillStyle='#476781';ctx.fillRect(-7,-38,14,30);ctx.fillStyle='#6ee9df';ctx.fillRect(-6,-39,12,5);ctx.restore();
 if(shot)planet(shot.x,shot.y,shot.level);else planet(LAUNCH.x,LAUNCH.y,current);
 ctx.fillStyle='#7288a7';ctx.font='9px sans-serif';ctx.textAlign='center';ctx.fillText('AIM · RELEASE · MERGE',W/2,H-15);
}
function frame(time){const dt=Math.min((time-last)/1000||0,.035);last=time;if(shot&&!gameOver){const hit=advance(shot,440*dt);if(hit)settle(shot,hit);}draw(dt);requestAnimationFrame(frame);}
names.forEach((name,i)=>{const el=document.createElement('div');el.className='evo';const dot=document.createElement('i');dot.style.background=colors[i];el.append(dot,document.createTextNode(name));document.getElementById('evolution').append(el);});
reset();requestAnimationFrame(frame);
})();
