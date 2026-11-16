import * as THREE from 'three';
import { BOARD, PIECES, canPlace, cellKey, getGoal, transform, type Cell, type Placement } from './puzzle.ts';
import { woodMaterial } from './wood.ts';
import { centerFor, RACKS, type PieceState, type Snapshot } from './session.ts';
import { drawPlant, seasonFor, type Season } from './theme.ts';
import { PieceGesture, type InteractionMode } from './gesture.ts';
import { QUARTER, clamp, springStep, nearestTurn, flipClearance, proposalFor, turnedAtCenter, RingRotation, ContactSound, type Spring, type RingAnchor } from './interaction.ts';

export type ControlAnchor=RingAnchor&{id:number;angle:number;rotating:boolean;animating:boolean};
type Callbacks={commit:(pieces:Snapshot)=>void;hover:(id:number|null)=>void;message:(text:string)=>void;sound:(kind:'pick'|'drop')=>void;controls?:(anchor:ControlAnchor|null)=>void};
type MotionKey='x'|'y'|'z'|'scale'|'turn'|'flip'|'angle'|'tiltX'|'tiltY';
type View={group:THREE.Group;model:THREE.Group;body:THREE.Mesh;mark:THREE.Mesh;back:THREE.Mesh;target:THREE.Vector3;shadow:THREE.Mesh;motion:Record<MotionKey,Spring>;turn:number;flip:number;scale:number;angle:number};
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
  private labels=new THREE.Group();
  private targets:THREE.Mesh[]=[];
  private ghost=new THREE.Group();
  private raycaster=new THREE.Raycaster();
  private pointer=new THREE.Vector2();
  private theme:Season;
  private date:Date;
  private active:number|null=null;
  private controlsVisible=false;
  private dragging=false;
  private mode:InteractionMode='idle';
  private candidate:Placement|null=null;
  private downPoint={clientX:0,clientY:0};
  private lastPoint={clientX:0,clientY:0};
  private fingerLift=0;
  private tilt=new THREE.Vector2();
  private ring:{pointerId:number;center:{x:number;y:number};rotation:RingRotation;base:PieceState;turn:number}|null=null;
  private contacts=new ContactSound();
  private taughtControls=false;
  private gesture=new PieceGesture();
  private pointerType='mouse';
  private compact=false;
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
    this.canvas=this.renderer.domElement;this.canvas.tabIndex=0;this.canvas.setAttribute('aria-label','木质日历拼图：鼠标拖动或单指拖动，点选后拖动积木旁的弧线旋转，点击手柄翻面');
    this.mount.appendChild(this.canvas);this.camera.position.set(0,-6.2,28);this.camera.lookAt(0,0,0);
    this.scene.add(new THREE.HemisphereLight('#fff5e2','#8f9287',2.4));
    const light=new THREE.DirectionalLight('#fff1d4',2.4);light.position.set(-6,9,17);light.castShadow=true;
    light.shadow.mapSize.set(2048,2048);light.shadow.camera.left=-13;light.shadow.camera.right=13;light.shadow.camera.top=9;light.shadow.camera.bottom=-9;
    light.shadow.normalBias=.015;light.shadow.bias=-.00015;light.shadow.radius=4;this.scene.add(light);
    const fill=new THREE.DirectionalLight('#e9edf1',.5);fill.position.set(5,-2,10);this.scene.add(fill);
    const table=new THREE.Mesh(new THREE.PlaneGeometry(100,100),new THREE.ShadowMaterial({color:'#5c4930',opacity:.2}));table.position.z=-.515;table.receiveShadow=true;this.scene.add(table);
    this.addBoard();this.addPieces();this.scene.add(this.labels,this.ghost);this.updateLabels();
    this.resizeObserver=new ResizeObserver(()=>this.resize());this.resizeObserver.observe(mount);this.resize();
    this.pointerDown=this.pointerDown.bind(this);this.pointerMove=this.pointerMove.bind(this);
    this.pointerUp=this.pointerUp.bind(this);this.pointerCancel=this.pointerCancel.bind(this);
    this.canvas.addEventListener('pointerdown',this.pointerDown);this.canvas.addEventListener('pointermove',this.pointerMove);
    this.canvas.addEventListener('pointerup',this.pointerUp);this.canvas.addEventListener('pointercancel',this.pointerCancel);
    this.canvas.addEventListener('lostpointercapture',this.captureLost);this.canvas.addEventListener('pointerleave',this.pointerLeave);
    this.canvas.addEventListener('wheel',this.wheel,{passive:false});this.canvas.addEventListener('contextmenu',this.contextMenu);
    window.addEventListener('keydown',this.keyDown);
    window.addEventListener('blur',this.windowBlur);
    document.addEventListener('pointerdown',this.outsideDown,true);
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
  private addPieces(){
    const contact=contactTexture();
    PIECES.forEach((definition,id)=>{
      const group=new THREE.Group(),model=new THREE.Group();
      const colors=['#bd8f63','#cfaa7c','#c79a6b','#a87c53','#d1b387','#bc936c','#a77b55','#d9b98f'];
      const geometry=pieceGeometry(definition.cells,definition.cells,0,false);geometry.translate(0,0,-.125);
      const body=new THREE.Mesh(geometry,[woodMaterial(colors[id],111+id*31,.58),woodMaterial('#8b6041',213+id*31,.76)]);
      body.userData.id=id;body.castShadow=true;body.receiveShadow=true;
      const mark=new THREE.Mesh(new THREE.PlaneGeometry(.38,.38),new THREE.MeshBasicMaterial({transparent:true,depthWrite:false,opacity:.65}));
      const [w,h]=dimensions(definition.cells);
      mark.position.set(definition.cells[0][0]-w/2,-definition.cells[0][1]+h/2,.161);
      const back=mark.clone();back.geometry=mark.geometry;back.rotation.y=Math.PI;back.position.z=-.161;
      model.rotation.order='ZYX';model.position.z=.125;model.add(body,mark,back);group.add(model);this.scene.add(group);
      const shadow=new THREE.Mesh(new THREE.PlaneGeometry(1,1),new THREE.MeshBasicMaterial({map:contact,transparent:true,depthWrite:false,opacity:.6}));shadow.position.z=-.51;this.scene.add(shadow);
      const motion=Object.fromEntries(['x','y','z','scale','turn','flip','angle','tiltX','tiltY'].map(key=>[key,{value:0,velocity:0}])) as Record<MotionKey,Spring>;
      this.views.push({group,model,body,mark,back,target:new THREE.Vector3(),shadow,motion,turn:0,flip:0,scale:1,angle:0});this.updateMark(id);
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
    const changed=date.getTime()!==this.date.getTime();
    const replaced=changed||this.ring!==null||this.gesture.pointerId!==null||JSON.stringify(pieces)!==JSON.stringify(this.pieces);
    this.cancelDrag(replaced);this.contacts.cancel();
    this.date=date;this.pieces=clone(pieces);
    if(changed){this.theme=seasonFor(date);this.updateLabels();this.views.forEach((_,id)=>this.updateMark(id));}
    pieces.forEach(p=>this.updateView(p,immediate));
  }
  private updateView(p:PieceState,immediate=false){
    const view=this.views[p.id];
    view.turn=immediate?p.rotation:nearestTurn(p.rotation,view.turn);
    const flip=Number(p.flipped);
    view.flip=immediate?flip:flip+Math.round((view.flip-flip)/2)*2;
    const inTray=this.compact&&!p.placement&&!(this.dragging&&this.draft?.id===p.id&&this.mode==='moving');
    const position=inTray?this.trayPosition(p.id):p.position;
    view.target.set(position[0],position[1],p.placement?0:RACK_Z);
    view.scale=inTray ? .52 : 1;view.angle=p.angle;
    if(immediate){
      const values={x:position[0],y:position[1],z:view.target.z,scale:view.scale,turn:view.turn,flip:view.flip,angle:p.angle,tiltX:0,tiltY:0};
      for(const key of Object.keys(values) as MotionKey[])view.motion[key]={value:values[key],velocity:0};
      this.applyMotion(view);
    }
  }
  private applyMotion(v:View){
    const m=v.motion;v.group.position.set(m.x.value,m.y.value,m.z.value);
    v.group.rotation.set(m.tiltX.value,m.tiltY.value,m.angle.value);
    v.model.rotation.set(0,m.flip.value*Math.PI,-m.turn.value*QUARTER,'ZYX');v.model.scale.setScalar(m.scale.value);
  }
  private resize(){
    this.cancelDrag();
    const width=Math.max(this.mount.clientWidth,1),height=Math.max(this.mount.clientHeight,1),aspect=width/height;
    this.compact=matchMedia('(max-width:720px)').matches;
    const worldWidth=this.compact?Math.max(10.4,15.8*aspect):Math.max(23.7,10.5*aspect);
    const centerY=this.compact?-3.1:0;
    this.camera.position.set(0,centerY-6.2,28);this.camera.lookAt(0,centerY,0);
    this.camera.left=-worldWidth/2;this.camera.right=worldWidth/2;this.camera.top=worldWidth/aspect/2;this.camera.bottom=-worldWidth/aspect/2;this.camera.updateProjectionMatrix();this.renderer.setSize(width,height);
    this.pieces.forEach(p=>this.updateView(p,true));
  }
  private trayPosition(id:number):[number,number]{return [(id%4-1.5)*2.45,-5.7-Math.floor(id/4)*2.7];}
  private render=()=>{
    this.frame=requestAnimationFrame(this.render);const now=performance.now();const dt=Math.min((now-this.previousTime)/1000,.05);this.previousTime=now;
    this.views.forEach((v,id)=>{
      const moving=this.mode==='moving'&&this.draft?.id===id;
      const manipulating=this.draft?.id===id&&(moving||this.mode==='rotating');
      const p=manipulating?this.draft!:this.pieces[id];
      const selected=!p.placement&&this.active===id&&(this.controlsVisible||this.pointerType==='mouse');
      const lift=manipulating ? .83 : selected ? .11 : 0;
      if(moving&&this.pointerType==='touch')this.fingerLift=this.reduced.matches?40:Math.min(40,this.fingerLift+dt*400);
      if(moving&&this.draft)this.positionDraft(this.lastPoint);
      const targets={x:v.target.x,y:v.target.y,z:(p.placement?0:RACK_Z)+lift,scale:v.scale,turn:v.turn,flip:v.flip,angle:v.angle,tiltX:moving&&!this.reduced.matches?this.tilt.x:0,tiltY:moving&&!this.reduced.matches?this.tilt.y:0};
      if(this.mode==='rotating'&&this.ring?.base.id===id){
        targets.z=Math.max(.6,targets.z);
        targets.turn=this.ring.turn+(this.reduced.matches?this.ring.rotation.step:this.ring.rotation.angle/QUARTER);
      }
      for(const key of Object.keys(targets) as MotionKey[]){
        const direct=moving&&(key==='x'||key==='y');
        const frequency=key==='flip'?30:key==='turn'?44:40;
        v.motion[key]=springStep(v.motion[key],targets[key],dt,frequency,this.reduced.matches||direct);
      }
      const halfWidth=(dimensions(PIECES[id].cells)[0]+1)/2+.04;
      v.motion.z.value=Math.max(v.motion.z.value,flipClearance(halfWidth,v.motion.scale.value,v.motion.flip.value,p.placement?SURFACE:-.51));
      this.applyMotion(v);
      const cells=transform(PIECES[id].cells,p.rotation,p.flipped),[w,h]=dimensions(cells),scale=v.motion.scale.value;
      const shadowLift=Math.max(0,v.group.position.z-(p.placement?0:RACK_Z));
      const spread=1+shadowLift*.25;v.shadow.scale.set((w+1.7)*scale*spread,(h+1.7)*scale*spread,1);
      v.shadow.position.x=v.group.position.x;v.shadow.position.y=v.group.position.y-.05;
      (v.shadow.material as THREE.MeshBasicMaterial).opacity=p.placement&&!manipulating ? .16 : .6/(1+shadowLift*3);
    });
    this.tilt.multiplyScalar(Math.exp(-dt*14));
    for(const _id of this.contacts.ready(now))this.callbacks.sound('drop');
    this.scene.updateMatrixWorld(true);this.updateControls();
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
  private select(id:number|null){
    if(this.active!==id||id===null){this.controlsVisible=false;this.callbacks.controls?.(null);}
    if(this.active!==id){this.active=id;this.callbacks.hover(id);}
    if(this.mode==='idle'||this.mode==='selected')this.mode=id===null?'idle':'selected';
    this.canvas.style.cursor=id===null?'default':this.dragging?'grabbing':'grab';
  }
  private updateControls(){
    if(!this.controlsVisible||this.active===null||this.mode==='moving'||this.mode==='pressed'){this.callbacks.controls?.(null);return;}
    const v=this.views[this.active],bounds=new THREE.Box3().setFromObject(v.model),size={width:this.mount.clientWidth,height:this.mount.clientHeight};
    const points:THREE.Vector3[]=[];
    for(const x of [bounds.min.x,bounds.max.x])for(const y of [bounds.min.y,bounds.max.y])for(const z of [bounds.min.z,bounds.max.z])points.push(new THREE.Vector3(x,y,z).project(this.camera));
    const xs=points.map(p=>(p.x+1)*size.width/2),ys=points.map(p=>(1-p.y)*size.height/2);
    const left=Math.min(...xs),right=Math.max(...xs),top=Math.min(...ys),bottom=Math.max(...ys);
    const animating=Math.abs(v.motion.turn.value-v.turn)>.01||Math.abs(v.motion.flip.value-v.flip)>.01;
    this.callbacks.controls?.({id:this.active,x:(left+right)/2,y:(top+bottom)/2,width:right-left,height:bottom-top,angle:this.ring?.rotation.angle??0,rotating:this.ring!==null,animating});
  }
  private pointerDown(e:PointerEvent){
    if(this.gesture.pointerId===null&&!this.ring&&e.isPrimary)this.pointerType=e.pointerType;
    if(e.button!==0||this.gesture.pointerId!==null||this.ring||!e.isPrimary)return;
    this.pointerType=e.pointerType;const id=this.pick(e);if(id===null){this.select(null);return;}
    if(!this.gesture.begin(e))return;
    e.preventDefault();this.canvas.focus({preventScroll:true});this.select(id);this.mode='pressed';this.contacts.cancel(id);
    this.controlsVisible=false;this.callbacks.controls?.(null);
    this.downPoint={clientX:e.clientX,clientY:e.clientY};this.lastPoint=this.downPoint;
    this.canvas.setPointerCapture(e.pointerId);
  };
  private startMove(){
    if(this.active===null)return;
    const id=this.active,v=this.views[id];
    this.controlsVisible=false;this.callbacks.controls?.(null);
    this.mode='moving';this.dragging=true;this.fingerLift=0;this.candidate=null;
    this.draft=clone(this.pieces[id]);this.draft.placement=null;this.draft.angle=0;
    this.draft.position=[v.group.position.x,v.group.position.y];
    const point=this.point(this.downPoint);if(point)this.offset.set(this.draft.position[0]-point.x,this.draft.position[1]-point.y);
    this.updateView(this.draft);this.callbacks.sound('pick');this.updateGhost();
  }
  private positionDraft(e:{clientX:number;clientY:number}){
    if(!this.draft)return;
    const point=this.point({clientX:e.clientX,clientY:e.clientY-this.fingerLift});if(!point)return;
    this.draft.position=[point.x+this.offset.x,point.y+this.offset.y];this.updateView(this.draft);this.updateGhost();
  }
  private pointerMove(e:PointerEvent){
    if(this.ring)return;
    if(this.gesture.pointerId!==null){
      if(!this.gesture.move(e))return;
      if(this.mode==='pressed')this.startMove();
      if(this.mode!=='moving')return;
      this.tilt.set(clamp((e.clientY-this.lastPoint.clientY)*.0015,-.052,.052),clamp((e.clientX-this.lastPoint.clientX)*.0015,-.052,.052));
      this.lastPoint={clientX:e.clientX,clientY:e.clientY};this.positionDraft(e);
    }else if(e.pointerType==='mouse'&&!this.controlsVisible){this.pointerType=e.pointerType;this.select(this.pick(e));}
  };
  private proposal(p:PieceState):Placement{return proposalFor(p,this.candidate);}
  private pointerUp(e:PointerEvent){
    if(e.button!==0||!this.gesture.owns(e))return;
    if(this.mode==='pressed'){
      if(this.gesture.move(e))this.startMove();
      else{
        this.finishDrag();this.controlsVisible=true;
        if(!this.taughtControls){this.taughtControls=true;this.callbacks.message('拖弧线转向，点「翻面」换一面；拖积木本体移动。');}
        return;
      }
    }
    if(!this.draft||this.mode!=='moving')return;
    this.lastPoint={clientX:e.clientX,clientY:e.clientY};this.positionDraft(e);
    const p=clone(this.draft),proposal=this.proposal(p);const nearBoard=Math.abs(p.position[0])<4.25&&Math.abs(p.position[1])<4.25;
    const placements=this.pieces.flatMap(v=>v.placement?[v.placement]:[]);let accepted=true;
    if(nearBoard){
      if(canPlace(proposal,placements,getGoal(this.date))){p.placement=proposal;p.position=centerFor(proposal);p.angle=0;this.callbacks.message('落得刚刚好。继续，下一块。');}
      else{accepted=false;this.callbacks.message('这里会重叠、越界或遮住日期，换个位置试试。');}
    }else{
      const [w,h]=dimensions(transform(PIECES[p.id].cells,p.rotation,p.flipped));
      p.position=[clamp(p.position[0],-11+w/2,11-w/2),clamp(p.position[1],-4.7+h/2,4.7-h/2)];p.placement=null;
      if(this.compact)p.position=[...(this.pieces[p.id].placement?RACKS[p.id]:this.pieces[p.id].position)];
      this.callbacks.message(this.compact?'已放回积木托盘，换个角度再试。':'暂放桌面，换个角度再想一想。');
    }
    this.finishDrag();
    if(accepted)this.commitPiece(p,true);else this.updateView(this.pieces[p.id]);
  };
  private commitPiece(p:PieceState,contact=false){
    const next=clone(this.pieces);next[p.id]=p;
    const changed=JSON.stringify(next)!==JSON.stringify(this.pieces);
    this.pieces=next;this.updateView(p);
    if(changed){this.callbacks.commit(next);if(contact)this.contacts.schedule(p.id,performance.now());}
  }
  private finishDrag(){
    const pointerId=this.gesture.clear();
    this.dragging=false;this.draft=null;this.candidate=null;this.mode=this.active===null?'idle':'selected';this.clearGhost();
    if(pointerId!==null&&this.canvas.hasPointerCapture(pointerId))this.canvas.releasePointerCapture(pointerId);
  }
  cancelDrag(dismissControls=true){
    this.contacts.cancel();
    const id=this.draft?.id;this.ring=null;this.finishDrag();
    if(id!==undefined)this.updateView(this.pieces[id]);
    if(dismissControls)this.select(null);
  }
  private pointerCancel(e:PointerEvent){if(this.gesture.owns(e))this.cancelDrag();}
  private captureLost=(e:PointerEvent)=>{if(this.gesture.owns(e))this.cancelDrag();};
  private windowBlur=()=>this.cancelDrag();
  private outsideDown=(e:PointerEvent)=>{
    if(e.isPrimary&&e.target instanceof Node&&!this.mount.parentElement?.contains(e.target))this.cancelDrag();
  };
  private pointerLeave=()=>{if(!this.controlsVisible&&this.gesture.pointerId===null&&!this.ring&&this.pointerType==='mouse')this.select(null);};
  private ghostGeometry:THREE.ShapeGeometry|null=null;
  private ghostMaterial=new THREE.MeshBasicMaterial({color:'#778c62',transparent:true,opacity:.44,depthWrite:false});
  private clearGhost(){this.ghost.clear();this.ghostGeometry?.dispose();this.ghostGeometry=null;this.ghostKey='';}
  private ghostKey='';
  private updateGhost(){
    if(!this.draft)return;
    const p=this.proposal(this.draft);this.candidate=p;
    if(Math.abs(this.draft.position[0])>4.4||Math.abs(this.draft.position[1])>4.4){this.clearGhost();return;}
    const placements=this.pieces.flatMap(v=>v.placement?[v.placement]:[]);
    this.ghostMaterial.color.set(canPlace(p,placements,getGoal(this.date))?this.theme.color:'#ba6552');
    const key=JSON.stringify(p);if(key===this.ghostKey)return;this.clearGhost();this.ghostKey=key;
    this.ghostGeometry=new THREE.ShapeGeometry(outline(transform(PIECES[p.id].cells,p.rotation,p.flipped),.045));
    const mesh=new THREE.Mesh(this.ghostGeometry,this.ghostMaterial);mesh.position.set(p.x-3,3-p.y,SURFACE+.027);this.ghost.add(mesh);
  }
  private changeShape(kind:'rotate'|'flip',direction=1){
    if(this.active===null||this.ring||this.mode==='pressed')return;
    const old=this.draft??this.pieces[this.active];
    const p=turnedAtCenter(old,kind==='rotate'?(old.rotation+direction+4)%4:old.rotation,kind==='flip'?!old.flipped:old.flipped);
    if(p.placement&&!canPlace(p.placement,this.pieces.flatMap(v=>v.placement?[v.placement]:[]),getGoal(this.date))){this.callbacks.message('空间不够，拿起来调整会更容易。');return;}
    const previousTurn=this.views[p.id].turn;
    this.contacts.cancel(p.id);this.updateView(p);
    const v=this.views[p.id];
    if(kind==='rotate')v.turn=previousTurn+direction;
    if(this.dragging){this.gesture.markChanged();this.draft=p;this.updateGhost();}
    else this.commitPiece(p);
  }
  rotateSelected(direction=1){if(this.gesture.pointerId===null)this.changeShape('rotate',direction);}
  flipSelected(){if(this.gesture.pointerId===null)this.changeShape('flip');}
  beginRotation(pointerId:number,clientX:number,clientY:number,center:{x:number;y:number}){
    if(this.active===null||this.gesture.pointerId!==null||this.ring)return false;
    const base=clone(this.pieces[this.active]),rotation=new RingRotation();
    rotation.begin(Math.atan2(clientY-center.y,clientX-center.x));
    this.contacts.cancel(base.id);this.mode='rotating';this.draft=clone(base);
    this.ring={pointerId,center,rotation,base,turn:this.views[base.id].turn};
    if(base.placement)this.updateGhost();return true;
  }
  moveRotation(pointerId:number,clientX:number,clientY:number){
    if(!this.ring||this.ring.pointerId!==pointerId)return;
    const {center,rotation,base}=this.ring;
    if(rotation.move(Math.atan2(clientY-center.y,clientX-center.x))){
      this.draft=turnedAtCenter(base,((base.rotation+rotation.step)%4+4)%4,base.flipped);
      if(base.placement)this.updateGhost();
      this.callbacks.message('转向 '+(((base.rotation+rotation.step)%4+4)%4)*90+'°');
    }
  }
  endRotation(pointerId:number,cancel=false){
    if(!this.ring||this.ring.pointerId!==pointerId)return;
    const {base,rotation,turn}=this.ring;
    const step=rotation.finish(),p=turnedAtCenter(base,((base.rotation+step)%4+4)%4,base.flipped);
    const valid=!p.placement||canPlace(p.placement,this.pieces.flatMap(v=>v.placement?[v.placement]:[]),getGoal(this.date));
    this.ring=null;this.draft=null;this.candidate=null;this.clearGhost();this.mode='selected';
    if(cancel||!valid){this.updateView(base);if(!cancel)this.callbacks.message('空间不够，拿起来调整会更容易。');}
    else{this.views[p.id].turn=turn+step;this.commitPiece(p);}
  }
  private wheel=(e:WheelEvent)=>{
    if(this.ring||this.mode==='pressed')return;const id=this.dragging?this.active:this.pick(e);if(id===null)return;e.preventDefault();
    if(Math.abs(e.deltaY)<2||performance.now()-this.lastWheel<160)return;this.lastWheel=performance.now();this.select(id);this.changeShape('rotate',e.deltaY>0?1:-1);
  };
  private contextMenu=(e:MouseEvent)=>{e.preventDefault();if(this.pointerType==='touch'||this.ring)return;const id=this.dragging?this.active:this.pick(e);if(id!==null){this.select(id);this.changeShape('flip');}};
  private keyDown=(e:KeyboardEvent)=>{
    if(e.target instanceof HTMLInputElement||e.target instanceof HTMLTextAreaElement||e.ctrlKey||e.metaKey)return;
    if(e.key==='Escape')this.cancelDrag();
    if(e.key.toLowerCase()==='r'){e.preventDefault();this.changeShape('rotate',e.shiftKey?-1:1);}
    if(e.key.toLowerCase()==='f'){e.preventDefault();this.changeShape('flip');}
  };
  dispose(){
    this.cancelDrag();this.callbacks.controls?.(null);window.removeEventListener('blur',this.windowBlur);document.removeEventListener('pointerdown',this.outsideDown,true);
    cancelAnimationFrame(this.frame);this.resizeObserver.disconnect();window.removeEventListener('keydown',this.keyDown);
    this.canvas.removeEventListener('pointerdown',this.pointerDown);this.canvas.removeEventListener('pointermove',this.pointerMove);this.canvas.removeEventListener('pointerup',this.pointerUp);this.canvas.removeEventListener('pointercancel',this.pointerCancel);this.canvas.removeEventListener('lostpointercapture',this.captureLost);this.canvas.removeEventListener('pointerleave',this.pointerLeave);this.canvas.removeEventListener('wheel',this.wheel);this.canvas.removeEventListener('contextmenu',this.contextMenu);
    this.ghostGeometry?.dispose();this.ghostMaterial.dispose();disposeTree(this.scene);this.renderer.dispose();this.canvas.remove();
  }
}
