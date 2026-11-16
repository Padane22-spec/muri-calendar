export type Season = { id:string; name:string; color:string; pale:string; mark:string; note:string };
export const SEASONS:Season[]=[
  {id:'spring',name:'春 · 新芽',color:'#75865d',pale:'#edf0e5',mark:'芽',note:'春生万物，落木成诗。'},
  {id:'summer',name:'夏 · 听风',color:'#4f817b',pale:'#e5efeb',mark:'叶',note:'把夏日的风，留在木纹里。'},
  {id:'autumn',name:'秋 · 拾光',color:'#a47744',pale:'#f4eadb',mark:'穗',note:'拾起一片秋色，拼好今日时光。'},
  {id:'winter',name:'冬 · 藏暖',color:'#708594',pale:'#e9eef1',mark:'松',note:'日子慢下来，木头也有温度。'},
];
export function seasonFor(date:Date):Season { const m=date.getMonth()+1;return SEASONS[m>=3&&m<=5?0:m>=6&&m<=8?1:m>=9&&m<=11?2:3]; }
export function drawPlant(ctx:CanvasRenderingContext2D,x:number,y:number,size:number,season:string,color:string){
  ctx.save();ctx.translate(x,y);ctx.scale(size/64,size/64);ctx.strokeStyle=color;ctx.fillStyle=color;ctx.lineWidth=2;ctx.lineCap='round';
  ctx.beginPath();ctx.moveTo(0,25);ctx.quadraticCurveTo(-4,0,5,-24);ctx.stroke();
  if(season==='winter'){
    for(let i=0;i<4;i++){const yy=-20+i*10;ctx.beginPath();ctx.moveTo(3,yy);ctx.lineTo(-15-i*2,yy+14);ctx.moveTo(3,yy);ctx.lineTo(18+i*2,yy+14);ctx.stroke();}
  }else{
    for(let i=0;i<3;i++){const yy=-15+i*13;const side=i%2?-1:1;ctx.beginPath();ctx.moveTo(1,yy+8);ctx.bezierCurveTo(side*24,yy+5,side*22,yy-14,1,yy+8);ctx.stroke();}
    if(season==='spring'){ctx.beginPath();ctx.arc(5,-25,4,0,Math.PI*2);ctx.stroke();}
    if(season==='autumn'){for(let i=0;i<5;i++){ctx.beginPath();ctx.ellipse(4,-24+i*7,4,7,.8,0,Math.PI*2);ctx.stroke();}}
  }
  ctx.restore();
}
