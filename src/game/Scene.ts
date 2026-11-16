import * as THREE from 'three';
import { BOARD, PIECES, canPlace, cellKey, getGoal, isSolved, transform, type Cell, type Placement } from './puzzle';
import { woodMaterial } from './wood';

export type GameState = { placed: number; solved: boolean; moves: number; selected: number | null; message: string };
type PieceView = { id: number; group: THREE.Group; body: THREE.Mesh; rotation: number; flipped: boolean; rack: THREE.Vector2; placement: Placement | null; lift: number };
const CENTER = 3;
const BOARD_Z = 0.15;
const RACK_Z = -0.19;
const rackPositions = [[-8.2,2.1],[-5.25,2.1],[-8.2,-2.2],[-5.1,-1.9],[5.3,2.25],[8.5,2.3],[5.3,-1.8],[8.7,-1.8]];

// Trace only the outside of the cell union, yielding a single wooden piece
// instead of a collection of cubes with internal seams.
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
function pieceGeometry(cells: Cell[]) {
  const shape=outline(cells,.065);
  const geometry = new THREE.ExtrudeGeometry(shape,{depth:.23,bevelEnabled:true,bevelSize:.035,bevelThickness:.035,bevelSegments:3,steps:1,curveSegments:1});
  const [cx,cy]=shapeCenter(cells);
  geometry.translate(-cx,cy,0);
  return geometry;
}
function shapeCenter(cells: Cell[]): Cell { return [Math.max(...cells.map(c=>c[0]))/2, Math.max(...cells.map(c=>c[1]))/2]; }
function disposeObject(object: THREE.Object3D) {
  const materials = new Set<THREE.Material>(); const textures = new Set<THREE.Texture>();
  object.traverse(child=>{
    if (child instanceof THREE.Mesh || child instanceof THREE.LineSegments) {
      child.geometry.dispose();
      const list=Array.isArray(child.material)?child.material:[child.material];
      list.forEach((m:THREE.Material)=>materials.add(m));
    }
  });
  materials.forEach(m=>{ const map=(m as THREE.MeshStandardMaterial).map; if(map) textures.add(map); m.dispose(); });
  textures.forEach(t=>t.dispose());
}

export class PuzzleScene {
  private scene = new THREE.Scene();
  private camera = new THREE.OrthographicCamera(-11,11,6,-6,.1,100);
  private renderer: THREE.WebGLRenderer;
  private pieces: PieceView[]=[];
  private labels = new THREE.Group();
  private ghost = new THREE.Group();
  private raycaster = new THREE.Raycaster();
  private pointer = new THREE.Vector2();
  private resizeObserver: ResizeObserver;
  private frame=0;
  private goal: Cell[];
  private active: PieceView | null=null;
  private hovered: PieceView | null=null;
  private dragging=false;
  private offset=new THREE.Vector2();
  private previous: { position: THREE.Vector3; rotation: number; flipped:boolean; placement: Placement|null } | null=null;
  private lastWheel=0;
  private moves=0;
  private message='挑一块木头，开始今天的拼图。';
  private solved=false;
  private destroyed=false;
  private onChange: (state:GameState)=>void;
  private canvas:HTMLCanvasElement;
  private mount:HTMLDivElement;
  private keyHandler=(e:KeyboardEvent)=>this.keyDown(e);

  constructor(mount:HTMLDivElement,date:Date,onChange:(state:GameState)=>void) {
    this.mount=mount; this.onChange=onChange; this.goal=getGoal(date);
    this.renderer=new THREE.WebGLRenderer({antialias:true,alpha:true});
    this.renderer.setPixelRatio(Math.min(devicePixelRatio,2));
    this.renderer.shadowMap.enabled=true; this.renderer.shadowMap.type=THREE.PCFSoftShadowMap;
    this.renderer.toneMapping=THREE.ACESFilmicToneMapping; this.renderer.toneMappingExposure=1.15;
    this.canvas=this.renderer.domElement;
    this.canvas.setAttribute('aria-label','木质日历拼图：左键拖动，滚轮旋转，右键翻转');
    this.canvas.tabIndex=0;
    mount.appendChild(this.canvas);
    this.camera.position.set(0,-6.2,28); this.camera.lookAt(0,0,0);
    this.scene.add(new THREE.HemisphereLight('#fff5e4','#a29580',3));
    const light=new THREE.DirectionalLight('#fff4dc',3.0); light.position.set(-7,10,15); light.castShadow=true;
    light.shadow.mapSize.set(2048,2048); light.shadow.camera.left=-12; light.shadow.camera.right=12; light.shadow.camera.top=9; light.shadow.camera.bottom=-9;
    light.shadow.normalBias=.025; light.shadow.bias=-.0001; light.shadow.radius=4; this.scene.add(light);
    const table=new THREE.Mesh(new THREE.PlaneGeometry(200,200),new THREE.ShadowMaterial({color:'#746044',opacity:.17}));
    table.position.z=-.28; table.receiveShadow=true; this.scene.add(table);
    this.addBoard(); this.addPieces(); this.scene.add(this.labels,this.ghost); this.updateLabels();
    this.resizeObserver=new ResizeObserver(()=>this.resize()); this.resizeObserver.observe(mount); this.resize();
    this.canvas.addEventListener('pointerdown',this.pointerDown);
    this.canvas.addEventListener('pointermove',this.pointerMove);
    this.canvas.addEventListener('pointerup',this.pointerUp);
    this.canvas.addEventListener('pointercancel',this.pointerCancel);
    this.canvas.addEventListener('lostpointercapture',this.captureLost);
    this.canvas.addEventListener('pointerleave',this.pointerLeave);
    this.canvas.addEventListener('wheel',this.wheel,{passive:false});
    this.canvas.addEventListener('contextmenu',this.contextMenu);
    window.addEventListener('keydown',this.keyHandler);
    this.render(); this.emit();
  }
  private addBoard() {
    const shape=outline(BOARD);
    const rim=new THREE.Mesh(new THREE.ExtrudeGeometry(shape,{depth:.35,bevelEnabled:true,bevelSize:.12,bevelThickness:.08,bevelSegments:4,steps:1}),woodMaterial('#ba895b',35));
    rim.geometry.translate(-CENTER,CENTER,-.38); rim.castShadow=true; rim.receiveShadow=true; this.scene.add(rim);
    const inset=new THREE.Mesh(new THREE.ShapeGeometry(shape),woodMaterial('#e1be8e',7));
    inset.geometry.translate(-CENTER,CENTER,BOARD_Z-.015); inset.receiveShadow=true; this.scene.add(inset);
    const segments:number[]=[];
    for(const [x,y] of BOARD) {
      const l=x-CENTER-.5,t=CENTER-y+.5;
      segments.push(l,t,BOARD_Z,l+1,t,BOARD_Z, l+1,t,BOARD_Z,l+1,t-1,BOARD_Z, l+1,t-1,BOARD_Z,l,t-1,BOARD_Z,l,t-1,BOARD_Z,l,t,BOARD_Z);
    }
    const geo=new THREE.BufferGeometry(); geo.setAttribute('position',new THREE.Float32BufferAttribute(segments,3));
    this.scene.add(new THREE.LineSegments(geo,new THREE.LineBasicMaterial({color:'#98744e',transparent:true,opacity:.38})));
  }
  private addPieces() {
    PIECES.forEach((definition,id)=>{
      const group=new THREE.Group();
      const material=woodMaterial(definition.color,18+id*41,.63);
      const side=woodMaterial('#ac794d',18+id*41,.82);
      const rotation=[0,0,1,0,0,3,1,0][id];
      const body=new THREE.Mesh(pieceGeometry(transform(definition.cells,rotation,false)),[material,side]);
      body.castShadow=true; body.receiveShadow=true; body.userData.id=id;
      group.add(body); group.position.set(rackPositions[id][0],rackPositions[id][1],RACK_Z);
      group.rotation.z=[-.09,.08,.07,-.09,.07,-.06,.07,-.08][id];
      this.scene.add(group);
      this.pieces.push({id,group,body,rotation,flipped:false,rack:new THREE.Vector2(...rackPositions[id]),placement:null,lift:RACK_Z});
    });
  }
  private updateLabels() {
    disposeObject(this.labels); this.labels.clear();
    BOARD.forEach(([x,y],i)=>{
      const target=this.goal.some(c=>c[0]===x && c[1]===y);
      const canvas=document.createElement('canvas'); canvas.width=canvas.height=192;
      const ctx=canvas.getContext('2d')!;
      if(target) {
        ctx.fillStyle='#f2e5ca'; ctx.beginPath(); ctx.roundRect(8,8,176,176,18); ctx.fill();
        ctx.strokeStyle='#7d8b6c'; ctx.lineWidth=3; ctx.stroke();
        ctx.fillStyle='#7d8b6c'; ctx.beginPath(); ctx.arc(96,157,3,0,Math.PI*2); ctx.fill();
      }
      ctx.fillStyle=target?'#52634c':'#654d34'; ctx.font=(i<12?'500 57px':'500 65px')+' "Songti SC", "Noto Serif SC", serif';
      ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(i<12?(i+1)+'月':String(i-11),96,target?92:98);
      const texture=new THREE.CanvasTexture(canvas);texture.colorSpace=THREE.SRGBColorSpace;
      const mesh=new THREE.Mesh(new THREE.PlaneGeometry(.93,.93),new THREE.MeshBasicMaterial({map:texture,transparent:true,depthWrite:false}));
      mesh.position.set(x-CENTER,CENTER-y,BOARD_Z+.012);this.labels.add(mesh);
    });
  }
  private emit() {
    const placed=this.pieces.flatMap(p=>p.placement?[p.placement]:[]);
    this.solved=isSolved(placed,this.goal);
    this.onChange({placed:placed.length,solved:this.solved,moves:this.moves,selected:this.active?.id??this.hovered?.id??null,message:this.solved?'今天的每一块，都恰到好处。':this.message});
  }
  private resize() {
    const {width,height}=this.mount.getBoundingClientRect();
    const aspect=Math.max(width,1)/Math.max(height,1);
    const worldWidth=Math.max(23.2,10.5*aspect);
    this.camera.left=-worldWidth/2;this.camera.right=worldWidth/2;
    this.camera.top=worldWidth/aspect/2;this.camera.bottom=-worldWidth/aspect/2;
    this.camera.updateProjectionMatrix();this.renderer.setSize(width,height);
  }
  private render=()=>{
    if(this.destroyed)return;
    this.frame=requestAnimationFrame(this.render);
    this.pieces.forEach(p=>{
      const lifted=this.dragging&&this.active===p;
      const hover=!this.dragging&&this.hovered===p;
      const z=lifted?.95:(p.placement?BOARD_Z+.06:RACK_Z)+(hover?.12:0);
      p.group.position.z=THREE.MathUtils.lerp(p.group.position.z,z,.2);
      p.body.rotation.z=THREE.MathUtils.lerp(p.body.rotation.z,0,.22);
      p.body.rotation.y=THREE.MathUtils.lerp(p.body.rotation.y,0,.2);
    });
    this.renderer.render(this.scene,this.camera);
  };
  private point(e:{clientX:number;clientY:number},z=.4) {
    const rect=this.canvas.getBoundingClientRect();
    this.pointer.set((e.clientX-rect.left)/rect.width*2-1,-(e.clientY-rect.top)/rect.height*2+1);
    this.raycaster.setFromCamera(this.pointer,this.camera);
    return this.raycaster.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0,0,1),-z),new THREE.Vector3());
  }
  private pick(e:{clientX:number;clientY:number}) {
    this.point(e);
    const hit=this.raycaster.intersectObjects(this.pieces.map(p=>p.body),false)[0];
    return hit?this.pieces[hit.object.userData.id]:null;
  }
  private pointerDown=(e:PointerEvent)=>{
    if(e.button!==0)return;
    const p=this.pick(e); if(!p)return;
    e.preventDefault();this.canvas.focus({preventScroll:true});
    this.previous={position:p.group.position.clone(),rotation:p.rotation,flipped:p.flipped,placement:p.placement};
    this.active=p; this.hovered=p; this.dragging=true;
    p.placement=null;p.group.rotation.z=0;
    const point=this.point(e); if(point)this.offset.set(p.group.position.x-point.x,p.group.position.y-point.y);
    this.canvas.setPointerCapture(e.pointerId);this.canvas.style.cursor='grabbing';
    this.message='滚轮旋转 · 右键翻转 · 松开自动吸附';this.updateGhost();this.emit();
  };
  private pointerMove=(e:PointerEvent)=>{
    if(this.dragging&&this.active){
      const point=this.point(e);if(!point)return;
      this.active.group.position.x=point.x+this.offset.x;this.active.group.position.y=point.y+this.offset.y;
      this.updateGhost();
    }else{
      const hovered=this.pick(e);
      if(hovered!==this.hovered){this.hovered=hovered;this.active=hovered;this.emit();}
      this.canvas.style.cursor=hovered?'grab':'default';
    }
  };
  private pointerUp=(e:PointerEvent)=>{
    if(!this.dragging||!this.active||e.button!==0)return;
    const p=this.active;const proposal=this.proposal(p);
    const onBoard=Math.abs(p.group.position.x)<4.15&&Math.abs(p.group.position.y)<4.15;
    if(onBoard&&canPlace(proposal,this.placements(),this.goal)){
      p.placement=proposal;this.snap(p,proposal);this.moves++;
      this.message='落得刚刚好，继续下一块。';
    }else if(onBoard){
      this.restore();this.message='这里有重叠、越界或遮住了日期，请换个位置。';
    }else{
      p.placement=null;
      p.group.position.x=THREE.MathUtils.clamp(p.group.position.x,-9.3,9.3);
      p.group.position.y=THREE.MathUtils.clamp(p.group.position.y,-3.4,3.4);
      this.moves++;this.message='木块已放回桌面，可以继续调整。';
    }
    this.finishDrag(e.pointerId);this.emit();
  };
  private pointerCancel=(e:PointerEvent)=>{if(this.dragging){this.restore();this.finishDrag(e.pointerId);this.message='已取消这次移动。';this.emit();}};
  private captureLost=()=>{if(this.dragging){this.restore();this.finishDrag();this.emit();}};
  private pointerLeave=()=>{if(!this.dragging){this.active=null;this.hovered=null;this.emit();}};
  private finishDrag(pointerId?:number){
    this.dragging=false;this.previous=null;disposeObject(this.ghost);this.ghost.clear();
    if(pointerId!==undefined&&this.canvas.hasPointerCapture(pointerId))this.canvas.releasePointerCapture(pointerId);
    this.canvas.style.cursor='grab';
  }
  private placements(){return this.pieces.flatMap(p=>p.placement?[p.placement]:[]);}
  private proposal(p:PieceView):Placement {
    const [cx,cy]=shapeCenter(transform(PIECES[p.id].cells,p.rotation,p.flipped));
    return {id:p.id,rotation:p.rotation,flipped:p.flipped,x:Math.round(p.group.position.x+CENTER-cx),y:Math.round(CENTER-p.group.position.y-cy)};
  }
  private snap(p:PieceView,placement:Placement){
    const [cx,cy]=shapeCenter(transform(PIECES[p.id].cells,placement.rotation,placement.flipped));
    p.group.position.x=placement.x-CENTER+cx;p.group.position.y=CENTER-placement.y-cy;p.group.rotation.z=0;
  }
  private rebuild(p:PieceView){p.body.geometry.dispose();p.body.geometry=pieceGeometry(transform(PIECES[p.id].cells,p.rotation,p.flipped));}
  private restore(){
    if(!this.active||!this.previous)return;const p=this.active;
    p.group.position.copy(this.previous.position);p.rotation=this.previous.rotation;p.flipped=this.previous.flipped;p.placement=this.previous.placement;
    this.rebuild(p);p.body.rotation.set(0,0,0);
  }
  private updateGhost(){
    disposeObject(this.ghost);this.ghost.clear();if(!this.active||!this.dragging)return;
    const proposal=this.proposal(this.active);
    if(Math.abs(this.active.group.position.x)>4.2||Math.abs(this.active.group.position.y)>4.2)return;
    const valid=canPlace(proposal,this.placements(),this.goal);
    const cells=transform(PIECES[proposal.id].cells,proposal.rotation,proposal.flipped);
    const geometry=new THREE.ShapeGeometry(outline(cells,.045));
    const mesh=new THREE.Mesh(geometry,new THREE.MeshBasicMaterial({color:valid?'#729071':'#ba6b57',transparent:true,opacity:.45,depthWrite:false}));
    mesh.position.set(proposal.x-CENTER,CENTER-proposal.y,BOARD_Z+.024);this.ghost.add(mesh);
  }
  rotate(direction=1){
    const p=this.active;if(!p)return;
    const old=p.rotation;p.rotation=(p.rotation+direction+4)%4;
    if(p.placement){const proposal={...p.placement,rotation:p.rotation};if(!canPlace(proposal,this.placements(),this.goal)){p.rotation=old;this.message='这个位置没有足够空间旋转，先拿起木块。';this.emit();return;}p.placement=proposal;this.snap(p,proposal);this.moves++;}
    this.rebuild(p);p.body.rotation.z=direction*Math.PI/2;this.updateGhost();this.emit();
  }
  flip(){
    const p=this.active;if(!p)return;const old=p.flipped;p.flipped=!p.flipped;
    if(p.placement){const proposal={...p.placement,flipped:p.flipped};if(!canPlace(proposal,this.placements(),this.goal)){p.flipped=old;this.message='翻面后会与其他木块重叠，先拿起来试试。';this.emit();return;}p.placement=proposal;this.snap(p,proposal);this.moves++;}
    this.rebuild(p);p.body.rotation.y=Math.PI;this.updateGhost();this.emit();
  }
  private wheel=(e:WheelEvent)=>{
    const p=this.dragging?this.active:this.pick(e);if(!p)return;
    e.preventDefault();if(Math.abs(e.deltaY)<2||performance.now()-this.lastWheel<160)return;
    this.lastWheel=performance.now();this.active=p;this.rotate(e.deltaY>0?1:-1);
  };
  private contextMenu=(e:MouseEvent)=>{e.preventDefault();const p=this.dragging?this.active:this.pick(e);if(p){this.active=p;this.flip();}};
  private keyDown(e:KeyboardEvent){
    if(e.target instanceof HTMLInputElement||e.target instanceof HTMLButtonElement)return;
    if(e.key==='Escape'&&this.dragging){this.restore();this.finishDrag();this.emit();}
    if(e.key.toLowerCase()==='r'){e.preventDefault();this.rotate(e.shiftKey?-1:1);}
    if(e.key.toLowerCase()==='f'){e.preventDefault();this.flip();}
  }
  reset(date:Date){
    if(this.dragging)this.finishDrag();this.goal=getGoal(date);this.active=this.hovered=null;this.moves=0;
    this.pieces.forEach(p=>{p.placement=null;p.rotation=[0,0,1,0,0,3,1,0][p.id];p.flipped=false;p.group.position.set(p.rack.x,p.rack.y,RACK_Z);p.group.rotation.z=[-.09,.08,.07,-.09,.07,-.06,.07,-.08][p.id];this.rebuild(p);p.body.rotation.set(0,0,0);});
    this.updateLabels();this.message='新的开始。让今天的月份和日期露出来。';this.emit();
  }
  applySolution(solution:Placement[],one=false){
    if(this.dragging){this.restore();this.finishDrag();}
    const targets=one?solution.filter(p=>!this.pieces[p.id].placement).slice(0,1):solution;
    targets.forEach(placement=>{const p=this.pieces[placement.id];p.rotation=placement.rotation;p.flipped=placement.flipped;p.placement={...placement};this.rebuild(p);this.snap(p,placement);});
    this.moves+=targets.length;this.message=one?'给你一点灵感：已经放好一块木头。':'参考拼法已摆好。重置后，可以再自己试一次。';this.emit();
  }
  getPlacements(){return this.placements().map(p=>({...p}));}
  dispose(){
    this.destroyed=true;cancelAnimationFrame(this.frame);this.resizeObserver.disconnect();
    window.removeEventListener('keydown',this.keyHandler);
    this.canvas.removeEventListener('pointerdown',this.pointerDown);this.canvas.removeEventListener('pointermove',this.pointerMove);this.canvas.removeEventListener('pointerup',this.pointerUp);
    this.canvas.removeEventListener('pointercancel',this.pointerCancel);this.canvas.removeEventListener('lostpointercapture',this.captureLost);this.canvas.removeEventListener('pointerleave',this.pointerLeave);
    this.canvas.removeEventListener('wheel',this.wheel);this.canvas.removeEventListener('contextmenu',this.contextMenu);
    disposeObject(this.scene);this.renderer.dispose();this.canvas.remove();
  }
}
