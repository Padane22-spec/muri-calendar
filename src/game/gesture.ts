type PointerSample={pointerId:number;pointerType:string;button:number;isPrimary:boolean;clientX:number;clientY:number};

// One pointer owns a move. All inputs cross the same slop before moving a piece.
export class PieceGesture {
  pointerId:number|null=null;
  private start={x:0,y:0};
  private moved=false;
  begin(event:PointerSample){
    if(this.pointerId!==null||event.button!==0||!event.isPrimary)return false;
    this.pointerId=event.pointerId;
    this.start={x:event.clientX,y:event.clientY};this.moved=false;return true;
  }
  owns(event:{pointerId:number}){return this.pointerId!==null&&this.pointerId===event.pointerId;}
  move(event:{pointerId:number;clientX:number;clientY:number}){
    if(!this.owns(event))return false;
    this.moved ||= Math.hypot(event.clientX-this.start.x,event.clientY-this.start.y)>6;
    return this.moved;
  }
  get isTap(){return this.pointerId!==null&&!this.moved;}
  markChanged(){if(this.pointerId!==null)this.moved=true;}
  clear(){const id=this.pointerId;this.pointerId=null;this.moved=false;return id;}
}

export type InteractionMode='idle'|'selected'|'pressed'|'moving'|'rotating';
