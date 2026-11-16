import * as THREE from 'three';
import { BOARD, PIECES, canPlace, cellKey, getGoal, transform, type Cell, type Placement } from './puzzle';
import { woodMaterial } from './wood';
import { centerFor, type PieceState, type Snapshot } from './session';
import { drawPlant, seasonFor, type Season } from './theme';

type Callbacks={commit:(pieces:Snapshot)=>void;hover:(id:number|null)=>void;message:(text:string)=>void;sound:(kind:'pick'|'drop')=>void};
type View={group:THREE.Group;model:THREE.Group;body:THREE.Mesh;mark:THREE.Mesh;target:THREE.Vector3;shapeKey:string;shadow:THREE.Mesh};
const SURFACE=-.04;
const RACK_Z=-.47;
const clone=<T>(value:T):T=>JSON.parse(JSON.stringify(value));
function outline(cells: Cell[], inset=0): THREE.Shape {
  const keys = new Set(cells.map(cellKey));
  const edges = new Map<string, [number,number]>();
  for (const [x,y] of cells) {
    if (!keys.has(cellKey([x,y-1]))) edges.set(x+','+y,[x+1,y]);
    if (!keys.has(cellKey([x+1,y]))) edges.set((x+1)+','+y,[x+1,y+1]);
    if (!keys.has(cellKey([x,y+1]))) edges.set((x+1)+','+(y+1),[x,y+1]);
    if (!keys.has(cellKey([x-1,y]))) edges.set(x+','+(y+1),[x,y]);
  }
  const start=edges.keys().next().value!;
  let key=start;const points:THREE.Vector2[]=[];
  do {
    const [x,y]=key.split(',').map(Number);
    points.push(new THREE.Vector2(x-.5,-y+.5));
    key=edges.get(key)!.join(',');
  }while(key!==start);
  const corners=points.filter((point,i)=>{
    const before=points[(i+points.length-1)%points.length];
    const after=points[(i+1)%points.length];
    return Math.abs((point.x-before.x)*(after.y-point.y)-(point.y-before.y)*(after.x-point.x))>.01;
  });
  const adjusted=corners.map((point,i)=>{
    const before=corners[(i+corners.length-1)%corners.length];
    const after=corners[(i+1)%corners.length];
    const a=point.clone().sub(before).normalize();
    const b=after.clone().sub(point).normalize();
    const na=new THREE.Vector2(a.y,-a.x),nb=new THREE.Vector2(b.y,-b.x);
    return point.clone().add(na.add(nb).multiplyScalar(inset));
  });
  const shape=new THREE.Shape(adjusted);shape.closePath();return shape;
}
function dimensions(cells:Cell[]):Cell{return [Math.max(...cells.map(c=>c[0])),Math.max(...cells.map(c=>c[1]))];}
function pieceGeometry(cells:Cell[],source:Cell[],rotation:number,flipped:boolean){
  const [w,h]=dimensions(cells);
  const geometry=new THREE.ExtrudeGeometry(outline(cells,.075),{depth:.25,bevelEnabled:true,bevelSize:.043,bevelThickness:.035,bevelSegments:5,steps:1,curveSegments:1});
  geometry.translate(-w/2,h/2,0);
  // Project XY once, keeping grain continuous on every part of the top.
  const positions=geometry.getAttribute('position'),uv=geometry.getAttribute('uv');
  let raw=source.map(([x,y])=>[flipped?-x:x,y]);
  for(let r=0;r<rotation;r++)raw=raw.map(([x,y])=>[-y,x]);
  const minX=Math.min(...raw.map(c=>c[0])),minY=Math.min(...raw.map(c=>c[1]));
  for(let i=0;i<uv.count;i++){
    let x=positions.getX(i)+w/2+minX,y=-positions.getY(i)+h/2+minY;
    for(let r=0;r<rotation;r++)[x,y]=[y,-x];
    if(flipped)x=-x;uv.setXY(i,(x+.5)/5,(y+.5)/5);
  }
  return geometry;
}
function labelTexture(text:string,target:boolean,theme:Season){
  const canvas=document.createElement('canvas');canvas.width=canvas.height=256;const ctx=canvas.getContext('2d')!;
  if(target){
    ctx.fillStyle=theme.pale;ctx.beginPath();ctx.roundRect(15,15,226,226,24);ctx.fill();
    ctx.strokeStyle=theme.color;ctx.lineWidth=3;ctx.stroke();
    ctx.beginPath();ctx.moveTo(84,215);ctx.lineTo(172,215);ctx.stroke();
  }
  ctx.textAlign='center';ctx.textBaseline='middle';
  ctx.font=(text.includes('月')?'500 66px':'500 75px')+' \"Songti SC\",STSong,serif';
  if(!target){ctx.fillStyle='rgba(255,247,223,.6)';ctx.fillText(text,129,132);}
  ctx.fillStyle=target?theme.color:'#66503a';ctx.fillText(text,128,130);
  const texture=new THREE.CanvasTexture(canvas);texture.colorSpace=THREE.SRGBColorSpace;return texture;
}
function contactTexture(){
  const c=document.createElement('canvas');c.width=c.height=64;const ctx=c.getContext('2d')!;
  const gradient=ctx.createRadialGradient(32,32,3,32,32,32);gradient.addColorStop(0,'rgba(65,44,25,.24)');gradient.addColorStop(.6,'rgba(65,44,25,.12)');gradient.addColorStop(1,'rgba(65,44,25,0)');ctx.fillStyle=gradient;ctx.fillRect(0,0,64,64);return new THREE.CanvasTexture(c);
}
function disposeTree(root:THREE.Object3D){
  const geometries=new Set<THREE.BufferGeometry>(),materials=new Set<THREE.Material>(),textures=new Set<THREE.Texture>();
  root.traverse(obj=>{if(obj instanceof THREE.Mesh||obj instanceof THREE.LineSegments){
    geometries.add(obj.geometry);(Array.isArray(obj.material)?obj.material:[obj.material]).forEach((m:THREE.Material)=>materials.add(m));
  }});
  geometries.forEach(g=>g.dispose());materials.forEach(m=>{for(const v of Object.values(m))if(v instanceof THREE.Texture)textures.add(v);m.dispose();});textures.forEach(t=>t.dispose());
}

export class PuzzleScene {
  private scene=new THREE.Scene();
  private camera=new THREE.OrthographicCamera(-12,12,6,-6,.1,100);
  private renderer:THREE.WebGLRenderer;
  private canvas:HTMLCanvasElement;
  private mount:HTMLDivElement;
  private callbacks:Callbacks;
  private pieces:Snapshot;
  private views:View[]=[];
  private geometries=new Map<string,THREE.BufferGeometry>();
  private labels=new THREE.Group();
  private targets:THREE.Mesh[]=[];
  private ghost=new THREE.Group();
  private raycaster=new THREE.Raycaster();
  private pointer=new THREE.Vector2();
  private theme:Season;
  private date:Date;
  private active:number|null=null;
  private dragging=false;
  private pointerId:number|null=null;
  private draft:PieceState|null=null;
  private offset=new THREE.Vector2();
  private lastWheel=0;
  private frame=0;
  private previousTime=performance.now();
  private resizeObserver:ResizeObserver;
  private reduced=matchMedia('(prefers-reduced-motion: reduce)');
  private celebrationUntil=0;

  constructor(mount:HTMLDivElement,date:Date,pieces:Snapshot,callbacks:Callbacks){
    this.mount=mount;this.date=date;this.theme=seasonFor(date);this.pieces=clone(pieces);this.callbacks=callbacks;
    this.renderer=new THREE.WebGLRenderer({antialias:true,alpha:true});this.renderer.setPixelRatio(Math.min(devicePixelRatio,2));
    this.renderer.shadowMap.enabled=true;this.renderer.shadowMap.type=THREE.PCFSoftShadowMap;
    this.renderer.toneMapping=THREE.ACESFilmicToneMapping;this.renderer.toneMappingExposure=1.05;
    this.canvas=this.renderer.domElement;this.canvas.tabIndex=0;this.canvas.setAttribute('aria-label','木质日历拼图：左键拖动，滚轮旋转，右键翻转');
    this.mount.appendChild(this.canvas);this.camera.position.set(0,-6.2,28);this.camera.lookAt(0,0,0);
    this.scene.add(new THREE.HemisphereLight('#fff5e2','#8f9287',2.4));
    const light=new THREE.DirectionalLight('#fff1d4',2.4);light.position.set(-6,9,17);light.castShadow=true;
    light.shadow.mapSize.set(2048,2048);light.shadow.camera.left=-13;light.shadow.camera.right=13;light.shadow.camera.top=9;light.shadow.camera.bottom=-9;
    light.shadow.normalBias=.015;light.shadow.bias=-.00015;light.shadow.radius=4;this.scene.add(light);
    const fill=new THREE.DirectionalLight('#e9edf1',.5);fill.position.set(5,-2,10);this.scene.add(fill);
    const table=new THREE.Mesh(new THREE.PlaneGeometry(100,100),new THREE.ShadowMaterial({color:'#5c4930',opacity:.2}));table.position.z=-.515;table.receiveShadow=true;this.scene.add(table);
    this.addBoard();this.addPieces();this.scene.add(this.labels,this.ghost);this.updateLabels();
    this.resizeObserver=new ResizeObserver(()=>this.resize());this.resizeObserver.observe(mount);this.resize();
    this.canvas.addEventListener('pointerdown',this.pointerDown);this.canvas.addEventListener('pointermove',this.pointerMove);
    this.canvas.addEventListener('pointerup',this.pointerUp);this.canvas.addEventListener('pointercancel',this.pointerCancel);
    this.canvas.addEventListener('lostpointercapture',this.captureLost);this.canvas.addEventListener('pointerleave',this.pointerLeave);
    this.canvas.addEventListener('wheel',this.wheel,{passive:false});this.canvas.addEventListener('contextmenu',this.contextMenu);
    window.addEventListener('keydown',this.keyDown);
    this.sync(date,pieces,true);this.render();
  }
  private addBoard(){
    const outer=outline(BOARD,-.24);const inside=outline(BOARD,-.004);
    const base=new THREE.Mesh(new THREE.ExtrudeGeometry(outer,{depth:.2,bevelEnabled:true,bevelSize:.055,bevelThickness:.045,bevelSegments:5,steps:1}),woodMaterial('#66452f',90,.55));
    base.geometry.translate(-3,3,-.46);base.castShadow=true;base.receiveShadow=true;this.scene.add(base);
    const frameShape=outline(BOARD,-.24);frameShape.holes.push(new THREE.Path(inside.getPoints().reverse()));
    const frame=new THREE.Mesh(new THREE.ExtrudeGeometry(frameShape,{depth:.36,bevelEnabled:true,bevelSize:.035,bevelThickness:.035,bevelSegments:5,steps:1}),woodMaterial('#795439',91,.5));
    frame.geometry.translate(-3,3,-.12);frame.castShadow=true;frame.receiveShadow=true;this.scene.add(frame);
    const floor=new THREE.Mesh(new THREE.ShapeGeometry(outline(BOARD)),woodMaterial('#d9bd94',15,.87));floor.geometry.translate(-3,3,SURFACE);floor.receiveShadow=true;this.scene.add(floor);
    const segments:number[]=[];
    for(const [x,y]of BOARD){const l=x-3-.5,t=3-y+.5;segments.push(l,t,SURFACE+.006,l+1,t,SURFACE+.006,l,t,SURFACE+.006,l,t-1,SURFACE+.006);}
    const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(segments,3));
    this.scene.add(new THREE.LineSegments(geometry,new THREE.LineBasicMaterial({color:'#9c805f',transparent:true,opacity:.37})));
    // Brass inlay makes the month/date boundary easy to read.
    const divider=new THREE.Mesh(new THREE.BoxGeometry(5.9,.014,.008),new THREE.MeshStandardMaterial({color:'#a68a56',metalness:.65,roughness:.48}));
    divider.position.set(-.5,1.5,SURFACE+.012);this.scene.add(divider);
    const plaque=new THREE.Mesh(new THREE.BoxGeometry(.94,.29,.025),new THREE.MeshStandardMaterial({color:'#b6a071',metalness:.72,roughness:.46}));
    plaque.position.set(-.5,3.64,.29);this.scene.add(plaque);
    const c=document.createElement('canvas');c.width=256;c.height=64;const ctx=c.getContext('2d')!;ctx.fillStyle='#554730';ctx.font='500 30px \"Songti SC\",serif';ctx.textAlign='center';ctx.fillText('木 日  ·  M U R I',128,42);
    const tex=new THREE.CanvasTexture(c);tex.colorSpace=THREE.SRGBColorSpace;
    const engraving=new THREE.Mesh(new THREE.PlaneGeometry(.8,.2),new THREE.MeshBasicMaterial({map:tex,transparent:true}));engraving.position.set(-.5,3.64,.306);this.scene.add(engraving);
  }
  private geometry(id:number,rotation:number,flipped:boolean){
    const key=[id,rotation,flipped].join(':');let geometry=this.geometries.get(key);
    if(!geometry){geometry=pieceGeometry(transform(PIECES[id].cells,rotation,flipped),PIECES[id].cells,rotation,flipped);this.geometries.set(key,geometry);}return geometry;
  }
  private addPieces(){
    const contact=contactTexture();
    PIECES.forEach((definition,id)=>{
      const group=new THREE.Group(),model=new THREE.Group();
      const colors=['#bd8f63','#cfaa7c','#c79a6b','#a87c53','#d1b387','#bc936c','#a77b55','#d9b98f'];
      const body=new THREE.Mesh(this.geometry(id,0,false),[woodMaterial(colors[id],111+id*31,.58),woodMaterial('#8b6041',213+id*31,.76)]);
      body.userData.id=id;body.castShadow=true;body.receiveShadow=true;
      const mark=new THREE.Mesh(new THREE.PlaneGeometry(.38,.38),new THREE.MeshBasicMaterial({transparent:true,depthWrite:false,opacity:.65}));mark.position.z=.286;
      model.add(body,mark);group.add(model);this.scene.add(group);
      const shadow=new THREE.Mesh(new THREE.PlaneGeometry(1,1),new THREE.MeshBasicMaterial({map:contact,transparent:true,depthWrite:false,opacity:.6}));shadow.position.z=-.51;this.scene.add(shadow);
      this.views.push({group,model,body,mark,target:new THREE.Vector3(),shapeKey:'',shadow});this.updateMark(id);
    });
  }
  private updateMark(id:number){
    const c=document.createElement('canvas');c.width=c.height=128;const ctx=c.getContext('2d')!;
    drawPlant(ctx,64,64,90,this.theme.id,'#634f36');
    const material=this.views[id].mark.material as THREE.MeshBasicMaterial;material.map?.dispose();material.map=new THREE.CanvasTexture(c);material.needsUpdate=true;
  }
  private updateLabels(){
    disposeTree(this.labels);this.labels.clear();this.targets=[];
    const goal=getGoal(this.date);
    BOARD.forEach(([x,y],i)=>{
      const target=goal.some(c=>c[0]===x&&c[1]===y);
      const mesh=new THREE.Mesh(new THREE.PlaneGeometry(.95,.95),new THREE.MeshBasicMaterial({map:labelTexture(i<12?(i+1)+'月':String(i-11),target,this.theme),transparent:true,depthWrite:false}));
      mesh.position.set(x-3,3-y,SURFACE+.014);this.labels.add(mesh);if(target)this.targets.push(mesh);
    });
  }
  sync(date:Date,pieces:Snapshot,immediate=false){
    this.cancelDrag();
    const changed=date.getTime()!==this.date.getTime();this.date=date;this.pieces=clone(pieces);
    if(changed){this.select(null);this.theme=seasonFor(date);this.updateLabels();this.views.forEach((_,id)=>this.updateMark(id));}
    pieces.forEach(p=>this.updateView(p,immediate));
  }
  private updateView(p:PieceState,immediate=false){
    const view=this.views[p.id],cells=transform(PIECES[p.id].cells,p.rotation,p.flipped);
    const key=[p.rotation,p.flipped,this.theme.id].join(':');
    if(view.shapeKey!==key){
      view.body.geometry=this.geometry(p.id,p.rotation,p.flipped);view.shapeKey=key;
      // The engraved botanical mark follows the same rotation and reflection.
      let [mx,my]=PIECES[p.id].cells[0];let raw=PIECES[p.id].cells.map(([x,y])=>[p.flipped?-x:x,y]);
      if(p.flipped)mx=-mx;
      for(let i=0;i<p.rotation;i++){[mx,my]=[-my,mx];raw=raw.map(([x,y])=>[-y,x]);}
      const minX=Math.min(...raw.map(c=>c[0])),minY=Math.min(...raw.map(c=>c[1]));const [w,h]=dimensions(cells);
      view.mark.position.set(mx-minX-w/2,-(my-minY)+h/2,.286);
      view.mark.rotation.z=-p.rotation*Math.PI/2;view.mark.scale.x=p.flipped?-1:1;
    }
    view.target.set(p.position[0],p.position[1],p.placement?0:RACK_Z);view.group.rotation.z=p.angle;
    if(immediate)view.group.position.copy(view.target);
    const [w,h]=dimensions(cells);view.shadow.scale.set(w+1.7,h+1.7,1);
  }
  private resize(){
    const width=Math.max(this.mount.clientWidth,1),height=Math.max(this.mount.clientHeight,1),aspect=width/height;
    const worldWidth=Math.max(23.7,10.5*aspect);this.camera.left=-worldWidth/2;this.camera.right=worldWidth/2;this.camera.top=worldWidth/aspect/2;this.camera.bottom=-worldWidth/aspect/2;this.camera.updateProjectionMatrix();this.renderer.setSize(width,height);
  }
  private render=()=>{
    this.frame=requestAnimationFrame(this.render);const now=performance.now();const dt=Math.min((now-this.previousTime)/1000,.05);this.previousTime=now;
    const ease=this.reduced.matches?1:1-Math.exp(-22*dt);
    this.views.forEach((v,id)=>{
      const p=this.dragging&&this.draft?.id===id?this.draft:this.pieces[id];
      const lift=(this.dragging&&this.draft?.id===id) ? .83 : this.active===id ? .11 : 0;
      v.target.z=(p.placement?0:RACK_Z)+lift;
      if(this.dragging&&this.draft?.id===id){v.group.position.x=p.position[0];v.group.position.y=p.position[1];}
      v.group.position.lerp(v.target,ease);
      v.model.rotation.z=THREE.MathUtils.lerp(v.model.rotation.z,0,ease);v.model.rotation.y=THREE.MathUtils.lerp(v.model.rotation.y,0,ease);
      v.shadow.position.x=v.group.position.x;v.shadow.position.y=v.group.position.y-.05;
      (v.shadow.material as THREE.MeshBasicMaterial).opacity=p.placement ? .16 : .6/(1+lift*3);
    });
    const breathing=this.reduced.matches?1:.96+Math.sin(now*.0017)*.04;
    this.targets.forEach(t=>{
      const material=t.material as THREE.MeshBasicMaterial;
      const celebrating=now<this.celebrationUntil&&!this.reduced.matches;
      const pulse=celebrating?Math.sin((this.celebrationUntil-now)/1500*Math.PI):0;
      t.scale.setScalar(1+pulse*.035);material.color.setRGB(1+pulse*.2,1+pulse*.16,1+pulse*.08);
      material.opacity=celebrating?1:breathing;
    });
    this.renderer.render(this.scene,this.camera);
  };
  celebrate(){this.celebrationUntil=performance.now()+1500;}
  private point(e:{clientX:number;clientY:number},z=.4){
    const rect=this.canvas.getBoundingClientRect();this.pointer.set((e.clientX-rect.left)/rect.width*2-1,-(e.clientY-rect.top)/rect.height*2+1);
    this.raycaster.setFromCamera(this.pointer,this.camera);
    return this.raycaster.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0,0,1),-z),new THREE.Vector3());
  }
  private pick(e:{clientX:number;clientY:number}){this.point(e);const hit=this.raycaster.intersectObjects(this.views.map(v=>v.body),false)[0];return hit?hit.object.userData.id as number:null;}
  private select(id:number|null){if(this.active!==id){this.active=id;this.callbacks.hover(id);}this.canvas.style.cursor=id===null?'default':this.dragging?'grabbing':'grab';}
  private pointerDown=(e:PointerEvent)=>{
    if(e.button!==0)return;const id=this.pick(e);if(id===null)return;
    e.preventDefault();this.canvas.focus({preventScroll:true});this.select(id);this.dragging=true;this.draft=clone(this.pieces[id]);this.draft.placement=null;this.draft.angle=0;
    const point=this.point(e);if(point)this.offset.set(this.draft.position[0]-point.x,this.draft.position[1]-point.y);
    this.pointerId=e.pointerId;this.canvas.setPointerCapture(e.pointerId);this.callbacks.sound('pick');this.updateView(this.draft);this.updateGhost();
  };
  private pointerMove=(e:PointerEvent)=>{
    if(this.dragging&&this.draft){
      const p=this.point(e);if(!p)return;this.draft.position=[p.x+this.offset.x,p.y+this.offset.y];this.updateView(this.draft);this.updateGhost();
    }else this.select(this.pick(e));
  };
  private proposal(p:PieceState):Placement{
    const [w,h]=dimensions(transform(PIECES[p.id].cells,p.rotation,p.flipped));
    return {id:p.id,rotation:p.rotation,flipped:p.flipped,x:Math.round(p.position[0]+3-w/2),y:Math.round(3-p.position[1]-h/2)};
  }
  private pointerUp=(e:PointerEvent)=>{
    if(e.button!==0||!this.dragging||!this.draft)return;
    const p=clone(this.draft),proposal=this.proposal(p);const nearBoard=Math.abs(p.position[0])<4.25&&Math.abs(p.position[1])<4.25;
    const placements=this.pieces.flatMap(v=>v.placement?[v.placement]:[]);
    let accepted=true;
    if(nearBoard){
      if(canPlace(proposal,placements,getGoal(this.date))){p.placement=proposal;p.position=centerFor(proposal);p.angle=0;this.callbacks.message('落得刚刚好。继续，下一块。');}
      else{accepted=false;this.callbacks.message('这里会重叠、越界或遮住日期，换个位置试试。');}
    }else{
      const [w,h]=dimensions(transform(PIECES[p.id].cells,p.rotation,p.flipped));
      p.position=[THREE.MathUtils.clamp(p.position[0],-11+w/2,11-w/2),THREE.MathUtils.clamp(p.position[1],-4.7+h/2,4.7-h/2)];p.placement=null;
      this.callbacks.message('暂放桌面，换个角度再想一想。');
    }
    this.finishDrag();
    if(accepted){const next=clone(this.pieces);next[p.id]=p;this.pieces=next;this.updateView(p);this.callbacks.commit(next);this.callbacks.sound('drop');}
    else this.updateView(this.pieces[p.id]);
  };
  private finishDrag(){
    this.dragging=false;this.draft=null;this.ghost.clear();
    if(this.pointerId!==null&&this.canvas.hasPointerCapture(this.pointerId))this.canvas.releasePointerCapture(this.pointerId);this.pointerId=null;
  }
  cancelDrag(){if(!this.dragging)return;const id=this.draft!.id;this.finishDrag();this.updateView(this.pieces[id]);}
  private pointerCancel=()=>this.cancelDrag();
  private captureLost=()=>this.cancelDrag();
  private pointerLeave=()=>{if(!this.dragging)this.select(null);};
  private ghostGeometry:THREE.ShapeGeometry|null=null;
  private ghostMaterial=new THREE.MeshBasicMaterial({color:'#778c62',transparent:true,opacity:.44,depthWrite:false});
  private updateGhost(){
    this.ghost.clear();this.ghostGeometry?.dispose();this.ghostGeometry=null;if(!this.draft)return;
    const p=this.proposal(this.draft);if(Math.abs(this.draft.position[0])>4.4||Math.abs(this.draft.position[1])>4.4)return;
    const placements=this.pieces.flatMap(v=>v.placement?[v.placement]:[]);
    this.ghostMaterial.color.set(canPlace(p,placements,getGoal(this.date))?this.theme.color:'#ba6552');
    this.ghostGeometry=new THREE.ShapeGeometry(outline(transform(PIECES[p.id].cells,p.rotation,p.flipped),.045));
    const mesh=new THREE.Mesh(this.ghostGeometry,this.ghostMaterial);mesh.position.set(p.x-3,3-p.y,SURFACE+.027);this.ghost.add(mesh);
  }
  private changeShape(kind:'rotate'|'flip',direction=1){
    if(this.active===null)return;const p=clone(this.draft??this.pieces[this.active]);
    if(kind==='rotate')p.rotation=(p.rotation+direction+4)%4;else p.flipped=!p.flipped;
    if(p.placement){
      const proposal={...p.placement,rotation:p.rotation,flipped:p.flipped};
      if(!canPlace(proposal,this.pieces.flatMap(v=>v.placement?[v.placement]:[]),getGoal(this.date))){this.callbacks.message('空间不够，拿起来调整会更容易。');return;}
      p.placement=proposal;p.position=centerFor(proposal);
    }
    p.angle=0;this.updateView(p);const v=this.views[p.id];
    if(!this.reduced.matches){if(kind==='rotate')v.model.rotation.z=direction*Math.PI/2;else v.model.rotation.y=Math.PI;}
    if(this.dragging){this.draft=p;this.updateGhost();}
    else{const next=clone(this.pieces);next[p.id]=p;this.pieces=next;this.callbacks.commit(next);}
  }
  private wheel=(e:WheelEvent)=>{
    const id=this.dragging?this.active:this.pick(e);if(id===null)return;e.preventDefault();
    if(Math.abs(e.deltaY)<2||performance.now()-this.lastWheel<160)return;this.lastWheel=performance.now();this.select(id);this.changeShape('rotate',e.deltaY>0?1:-1);
  };
  private contextMenu=(e:MouseEvent)=>{e.preventDefault();const id=this.dragging?this.active:this.pick(e);if(id!==null){this.select(id);this.changeShape('flip');}};
  private keyDown=(e:KeyboardEvent)=>{
    if(e.target instanceof HTMLInputElement||e.target instanceof HTMLTextAreaElement||e.ctrlKey||e.metaKey)return;
    if(e.key==='Escape')this.cancelDrag();
    if(e.key.toLowerCase()==='r'){e.preventDefault();this.changeShape('rotate',e.shiftKey?-1:1);}
    if(e.key.toLowerCase()==='f'){e.preventDefault();this.changeShape('flip');}
  };
  dispose(){
    cancelAnimationFrame(this.frame);this.resizeObserver.disconnect();window.removeEventListener('keydown',this.keyDown);
    this.canvas.removeEventListener('pointerdown',this.pointerDown);this.canvas.removeEventListener('pointermove',this.pointerMove);this.canvas.removeEventListener('pointerup',this.pointerUp);this.canvas.removeEventListener('pointercancel',this.pointerCancel);this.canvas.removeEventListener('lostpointercapture',this.captureLost);this.canvas.removeEventListener('pointerleave',this.pointerLeave);this.canvas.removeEventListener('wheel',this.wheel);this.canvas.removeEventListener('contextmenu',this.contextMenu);
    this.ghostGeometry?.dispose();this.ghostMaterial.dispose();this.geometries.forEach(g=>g.dispose());disposeTree(this.scene);this.renderer.dispose();this.canvas.remove();
  }
}
