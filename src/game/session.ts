import { canPlace, formatDateInput, getGoal, isSolved, parseDateInput, PIECES, solveDetailed, transform, type Placement } from './puzzle.ts';

export type PieceState = { id:number; rotation:number; flipped:boolean; position:[number,number]; angle:number; placement:Placement|null };
export type Snapshot = PieceState[];
export type Stamp = 'viewed'|'assisted'|'independent';
export type SavedSession = { pieces:Snapshot; past:Snapshot[]; future:Snapshot[]; hinted:boolean; viewed:boolean; celebrated:boolean };
export type Store = { version:1; sessions:Record<string,SavedSession>; stamps:Record<string,Stamp>; muted:boolean };
export const RACKS:[number,number][]=[[-8.35,2.1],[-5.3,2.1],[-8.4,-2.25],[-5.2,-1.9],[5.25,2.25],[8.5,2.3],[5.3,-1.8],[8.7,-1.8]];
const ROTATIONS=[0,0,1,0,0,3,1,0];
const ANGLES=[-.07,.065,.055,-.065,.065,-.055,.06,-.06];
const copy=<T>(value:T):T=>JSON.parse(JSON.stringify(value));
export function initialPieces():Snapshot{return PIECES.map((_,id)=>({id,rotation:ROTATIONS[id],flipped:false,position:[...RACKS[id]],angle:ANGLES[id],placement:null}));}
export function centerFor(p:Placement):[number,number]{const cells=transform(PIECES[p.id].cells,p.rotation,p.flipped);return [p.x-3+Math.max(...cells.map(c=>c[0]))/2,3-p.y-Math.max(...cells.map(c=>c[1]))/2];}
export function validDate(key:string){if(!/^\d{4}-\d{2}-\d{2}$/.test(key))return false;const date=parseDateInput(key);return Number.isFinite(date.getTime())&&formatDateInput(date)===key;}
export function validSnapshot(value:unknown,date:Date):value is Snapshot{
  if(!Array.isArray(value)||value.length!==8)return false;
  const placements:Placement[]=[];
  for(let id=0;id<8;id++){
    const p=value[id] as PieceState;
    if(!p||p.id!==id||!Number.isInteger(p.rotation)||p.rotation<0||p.rotation>3||typeof p.flipped!=='boolean'||!Array.isArray(p.position)||p.position.length!==2||!p.position.every(v=>Number.isFinite(v)&&Math.abs(v)<=12)||!Number.isFinite(p.angle)||Math.abs(p.angle)>Math.PI*2)return false;
    if(p.placement!==null){
      const q=p.placement;
      if(!q||q.id!==id||q.rotation!==p.rotation||q.flipped!==p.flipped||!Number.isInteger(q.x)||!Number.isInteger(q.y))return false;
      const center=centerFor(q);if(Math.abs(center[0]-p.position[0])>.001||Math.abs(center[1]-p.position[1])>.001||p.angle!==0)return false;
      placements.push(q);
    }
  }
  return placements.every(p=>canPlace(p,placements,getGoal(date)));
}
export function emptyStore():Store{return {version:1,sessions:{},stamps:{},muted:false};}
export function decodeStore(raw:string|null):Store{
  if(!raw)return emptyStore();
  try{
    const data=JSON.parse(raw);if(data.version!==1||!data.sessions||!data.stamps)return emptyStore();
    const store=emptyStore();store.muted=data.muted===true;
    for(const [key,value]of Object.entries(data.sessions)){
      if(!validDate(key))continue;const s=value as SavedSession;const date=parseDateInput(key);
      if(!s||!validSnapshot(s.pieces,date)||!Array.isArray(s.past)||!Array.isArray(s.future)||s.past.length>100||s.future.length>100||!s.past.every(v=>validSnapshot(v,date))||!s.future.every(v=>validSnapshot(v,date))||typeof s.hinted!=='boolean'||typeof s.viewed!=='boolean'||typeof s.celebrated!=='boolean')continue;
      store.sessions[key]=copy(s);
    }
    for(const [key,value]of Object.entries(data.stamps))if(validDate(key)&&['viewed','assisted','independent'].includes(value as string))store.stamps[key]=value as Stamp;
    return store;
  }catch{return emptyStore();}
}
export const STORAGE_KEY='muri-calendar-v1';
export class GameSession {
  date:Date; state:SavedSession; store:Store;
  constructor(date:Date,store:Store){this.date=date;this.store=store;this.state=copy(store.sessions[formatDateInput(date)]??this.fresh());}
  private fresh():SavedSession{return {pieces:initialPieces(),past:[],future:[],hinted:false,viewed:false,celebrated:false};}
  get placements(){return this.state.pieces.flatMap(p=>p.placement?[p.placement]:[]);}
  get solved(){return isSolved(this.placements,getGoal(this.date));}
  get stamp():Stamp|null{return this.solved&&!this.state.viewed?(this.state.hinted?'assisted':'independent'):null;}
  save(){this.store.sessions[formatDateInput(this.date)]=copy(this.state);}
  changeDate(date:Date){this.save();this.date=date;this.state=copy(this.store.sessions[formatDateInput(date)]??this.fresh());}
  commit(next:Snapshot){
    if(!validSnapshot(next,this.date)||JSON.stringify(next)===JSON.stringify(this.state.pieces))return false;
    this.state.past=[...this.state.past,copy(this.state.pieces)].slice(-100);this.state.future=[];this.state.pieces=copy(next);this.save();return true;
  }
  undo(){const previous=this.state.past.pop();if(!previous)return false;this.state.future.push(copy(this.state.pieces));this.state.pieces=previous;this.save();return true;}
  redo(){const next=this.state.future.pop();if(!next)return false;this.state.past.push(copy(this.state.pieces));this.state.pieces=next;this.save();return true;}
  restart(){this.state=this.fresh();this.save();}
  hint(){
    const result=solveDetailed(getGoal(this.date),this.placements);
    if(result.status!=='solved')return result.status;
    const next=result.solution.find(p=>!this.state.pieces[p.id].placement);if(!next)return 'unchanged';
    const pieces=copy(this.state.pieces);pieces[next.id]={id:next.id,rotation:next.rotation,flipped:next.flipped,position:centerFor(next),angle:0,placement:next};
    if(this.commit(pieces)){this.state.hinted=true;this.save();return 'placed';}return 'unchanged';
  }
  reveal(){
    const result=solveDetailed(getGoal(this.date));if(result.status!=='solved')return result.status;
    const next=copy(this.state.pieces);result.solution.forEach(p=>next[p.id]={id:p.id,rotation:p.rotation,flipped:p.flipped,position:centerFor(p),angle:0,placement:p});
    this.commit(next);this.state.viewed=true;this.upgrade('viewed');this.save();return 'solved';
  }
  collect(){const stamp=this.stamp;if(stamp)this.upgrade(stamp);this.state.celebrated=true;this.save();return stamp;}
  private upgrade(stamp:Stamp){const rank={viewed:0,assisted:1,independent:2};const key=formatDateInput(this.date);const old=this.store.stamps[key];if(!old||rank[stamp]>rank[old])this.store.stamps[key]=stamp;}
}
