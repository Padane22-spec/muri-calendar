import { centerFor, type PieceState } from './session.ts';
import { transform, PIECES, type Placement } from './puzzle.ts';

export const QUARTER=Math.PI/2;
export const clamp=(value:number,min:number,max:number)=>Math.max(min,Math.min(max,value));
export type Spring={value:number;velocity:number};
// Exact critically damped solution: stable at different refresh rates and on retargeting.
export function springStep(state:Spring,target:number,dt:number,frequency=40,reduced=false):Spring{
  if(reduced)return {value:target,velocity:0};
  const displacement=state.value-target,decay=Math.exp(-frequency*dt);
  const carry=(state.velocity+frequency*displacement)*dt;
  return {value:target+(displacement+carry)*decay,velocity:(state.velocity-frequency*carry)*decay};
}
export function nearestTurn(rotation:number,target:number){return rotation+Math.round((target-rotation)/4)*4;}
export function flipClearance(halfWidth:number,scale:number,flip:number,floor:number){
  const angle=flip*Math.PI;
  return floor-.125+(halfWidth*Math.abs(Math.sin(angle))+.16*Math.abs(Math.cos(angle)))*scale;
}
export function stickyRound(value:number,previous:number|null,margin=.12){
  return previous!==null&&Math.abs(value-previous)<=.5+margin?previous:Math.round(value);
}
export function proposalFor(p:PieceState,previous:Placement|null=null,margin=.12):Placement{
  const cells=transform(PIECES[p.id].cells,p.rotation,p.flipped);
  const x=p.position[0]+3-Math.max(...cells.map(c=>c[0]))/2;
  const y=3-p.position[1]-Math.max(...cells.map(c=>c[1]))/2;
  const same=previous?.id===p.id&&previous.rotation===p.rotation&&previous.flipped===p.flipped;
  return {id:p.id,rotation:p.rotation,flipped:p.flipped,x:stickyRound(x,same?previous.x:null,margin),y:stickyRound(y,same?previous.y:null,margin)};
}
export function turnedAtCenter(p:PieceState,rotation:number,flipped:boolean):PieceState{
  const next={...p,position:[...p.position] as [number,number],rotation,flipped,angle:rotation===p.rotation&&flipped===p.flipped?p.angle:0};
  if(p.placement){next.placement=proposalFor(next,null,0);next.position=centerFor(next.placement);}
  return next;
}
export class RingRotation {
  private last=0;
  angle=0;
  step=0;
  begin(angle:number){this.last=angle;this.angle=0;this.step=0;}
  move(angle:number){
    this.angle+=Math.atan2(Math.sin(angle-this.last),Math.cos(angle-this.last));this.last=angle;
    const next=stickyRound(this.angle/QUARTER,this.step,8/90);
    const changed=next!==this.step;this.step=next;return changed;
  }
  finish(){return Math.round(this.angle/QUARTER)||0;}
}
export type RingAnchor={x:number;y:number;width:number;height:number};
export type RingLayout={x:number;y:number;radius:number;anchorX:number;anchorY:number};
export type VisibleArea={left:number;top:number;right:number;bottom:number};
export function ringLayout(anchor:RingAnchor,width:number,height:number,visible:VisibleArea={left:0,top:0,right:width,bottom:height}):RingLayout{
  const availableWidth=visible.right-visible.left,availableHeight=visible.bottom-visible.top;
  const maxRadius=Math.max(24,Math.min(112,(availableWidth-64)/2,(availableHeight-64)/2));
  const radius=clamp(Math.max(anchor.width,anchor.height)/2+24,Math.min(56,maxRadius),maxRadius);
  const inset=radius+26;
  let x=clamp(anchor.x,visible.left+inset,visible.right-inset),y=clamp(anchor.y,visible.top+inset,visible.bottom-inset);
  // If a large piece cannot be surrounded, place the ring beside its vertical edge.
  if(Math.max(anchor.width,anchor.height)/2+24>radius+1){
    const above=anchor.y-anchor.height/2-inset-8,below=anchor.y+anchor.height/2+inset+8;
    if(above>=visible.top+inset&&above<=visible.bottom-inset)y=above;
    else if(below>=visible.top+inset&&below<=visible.bottom-inset)y=below;
  }
  return {x,y,radius,anchorX:anchor.x,anchorY:anchor.y};
}
export class ContactSound {
  private pending=new Map<number,number>();
  schedule(id:number,now:number){this.pending.set(id,now+160);}
  cancel(id?:number){if(id===undefined)this.pending.clear();else this.pending.delete(id);}
  ready(now:number){const ready=[...this.pending].filter(([,time])=>time<=now).map(([id])=>id);ready.forEach(id=>this.pending.delete(id));return ready;}
}
