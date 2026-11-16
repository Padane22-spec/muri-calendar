import { forwardRef, useImperativeHandle, useRef, type PointerEvent } from 'react';
import { ringLayout, type RingLayout } from './game/interaction';
import type { ControlAnchor, PuzzleScene } from './game/Scene';

export type ControlRingHandle={update:(anchor:ControlAnchor|null,width:number,height:number)=>void};
type Props={scene:()=>PuzzleScene|null;unlock:()=>void};

export const ControlRing=forwardRef<ControlRingHandle,Props>(function ControlRing({scene,unlock},ref){
  const root=useRef<HTMLDivElement>(null),group=useRef<SVGGElement>(null),arc=useRef<SVGPathElement>(null),hit=useRef<SVGPathElement>(null);
  const line=useRef<SVGPathElement>(null),indicator=useRef<SVGCircleElement>(null),label=useRef<SVGTextElement>(null);
  const left=useRef<HTMLButtonElement>(null),right=useRef<HTMLButtonElement>(null),flip=useRef<HTMLButtonElement>(null);
  const layout=useRef<RingLayout|null>(null),owner=useRef<{id:number;element:SVGPathElement}|null>(null);
  const selectedId=useRef<number|null>(null);
  const ticks=useRef<SVGGElement>(null);
  function release(cancel=true){
    const pointer=owner.current;owner.current=null;
    if(pointer){scene()?.endRotation(pointer.id,cancel);if(pointer.element.hasPointerCapture(pointer.id))pointer.element.releasePointerCapture(pointer.id);}
  }
  useImperativeHandle(ref,()=>({update(anchor,width,height){
    if(!root.current)return;
    if(!anchor){release();root.current.hidden=true;selectedId.current=null;return;}
    if(owner.current&&!anchor.rotating)release();
    root.current.hidden=false;
    const rect=root.current.getBoundingClientRect();
    const viewport=window.visualViewport;
    const viewportLeft=viewport?.offsetLeft??0,viewportTop=viewport?.offsetTop??0;
    const visible={left:Math.max(0,viewportLeft-rect.left),top:Math.max(0,viewportTop-rect.top),right:Math.min(width,viewportLeft+(viewport?.width??window.innerWidth)-rect.left),bottom:Math.min(height,viewportTop+(viewport?.height??window.innerHeight)-rect.top)};
    if(visible.right-visible.left<112||visible.bottom-visible.top<112){release();root.current.hidden=true;return;}
    const current=layout.current;
    const fits=current&&current.x-current.radius-22>=visible.left&&current.x+current.radius+22<=visible.right&&current.y-current.radius-22>=visible.top&&current.y+current.radius+22<=visible.bottom;
    if(owner.current&&!fits)release();
    if(!current||!fits||selectedId.current!==anchor.id||(!owner.current&&!anchor.animating))layout.current=ringLayout(anchor,width,height,visible);
    selectedId.current=anchor.id;
    const {x,y,radius:r}=layout.current!;
    group.current?.setAttribute('transform','translate('+x+' '+y+')');
    const path='M '+(-r)+' 0 A '+r+' '+r+' 0 1 1 '+r+' 0';
    arc.current?.setAttribute('d',path);hit.current?.setAttribute('d',path);
    line.current?.setAttribute('d','M 0 0 L '+(anchor.x-x)+' '+(anchor.y-y));
    if(line.current)line.current.style.opacity=Math.hypot(anchor.x-x,anchor.y-y)>24?'1':'0';
    const angle=anchor.angle-Math.PI/2;
    indicator.current?.setAttribute('cx',String(Math.cos(angle)*r));indicator.current?.setAttribute('cy',String(Math.sin(angle)*r));
    const tickIndex=((Math.round(anchor.angle/(Math.PI/2))%4)+4)%4;
    ticks.current?.querySelectorAll('circle').forEach((tick,index)=>{
      const a=-Math.PI/2+index*Math.PI/2;
      tick.setAttribute('cx',String(Math.cos(a)*r));tick.setAttribute('cy',String(Math.sin(a)*r));
      tick.setAttribute('r',index===tickIndex?'5':'2');
    });
    label.current?.setAttribute('y',String(-r+22));
    if(label.current)label.current.textContent=owner.current?Math.round(anchor.angle*180/Math.PI)+'°':'拖弧线转向';
    for(const [button,bx,by] of [[left.current,x-r,y],[right.current,x+r,y],[flip.current,x,y+r]] as const){
      if(button){button.style.left=bx+'px';button.style.top=by+'px';}
    }
  }}));
  function start(event:PointerEvent<SVGPathElement>){
    if(event.button!==0||!event.isPrimary||owner.current||!layout.current)return;
    event.preventDefault();event.stopPropagation();unlock();
    const rect=root.current!.getBoundingClientRect(),{x,y}=layout.current;
    if(scene()?.beginRotation(event.pointerId,event.clientX,event.clientY,{x:rect.left+x,y:rect.top+y})){
      owner.current={id:event.pointerId,element:event.currentTarget};event.currentTarget.setPointerCapture(event.pointerId);
    }
  }
  function move(event:PointerEvent<SVGPathElement>){if(owner.current?.id===event.pointerId){event.preventDefault();scene()?.moveRotation(event.pointerId,event.clientX,event.clientY);}}
  function end(event:PointerEvent<SVGPathElement>,cancel=false){
    if(owner.current?.id!==event.pointerId)return;
    if(!cancel)scene()?.moveRotation(event.pointerId,event.clientX,event.clientY);
    release(cancel);
  }
  function action(kind:'left'|'right'|'flip'){
    if(owner.current)return;unlock();if(kind==='flip')scene()?.flipSelected();else scene()?.rotateSelected(kind==='left'?-1:1);
  }
  return <div className="control-ring" ref={root} hidden role="group" aria-label="所选积木的转向与翻面">
    <svg className="ring-svg" aria-hidden="true"><g ref={group}>
      <path ref={line} className="ring-connector"/>
      <path ref={arc} className="ring-arc"/>
      <g ref={ticks} className="ring-ticks">{[0,1,2,3].map(i=><circle key={i}/>)}</g>
      <circle ref={indicator} r="4" className="ring-indicator"/>
      <text ref={label} className="ring-label" textAnchor="middle">拖弧线转向</text>
      <path ref={hit} className="ring-hit" onPointerDown={start} onPointerMove={move} onPointerUp={e=>end(e)} onPointerCancel={e=>end(e,true)} onLostPointerCapture={e=>end(e,true)}/>
    </g></svg>
    <button ref={left} className="ring-button" onClick={()=>action('left')} aria-label="逆时针旋转90度">↶</button>
    <button ref={right} className="ring-button" onClick={()=>action('right')} aria-label="顺时针旋转90度">↷</button>
    <button ref={flip} className="ring-button ring-flip" onClick={()=>action('flip')} aria-label="翻转选中积木">⇋ <span>翻面</span></button>
  </div>;
});
