import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { PuzzleScene } from '../src/game/Scene.ts';
import { PieceGesture } from '../src/game/gesture.ts';
import { ContactSound } from '../src/game/interaction.ts';
import { initialPieces, emptyStore, GameSession, centerFor } from '../src/game/session.ts';
import { getGoal, solve, type Placement } from '../src/game/puzzle.ts';

// Exercise the actual scene controller with a minimal canvas adapter; no browser or WebGL.
function fixture(){
  const session=new GameSession(new Date(2026,10,16),emptyStore());
  const released:number[]=[],messages:string[]=[];
  const scene=Object.create(PuzzleScene.prototype) as any;
  Object.assign(scene,{
    active:0,controlsVisible:true,mode:'selected',pointerType:'touch',dragging:false,ring:null,draft:null,candidate:null,
    gesture:new PieceGesture(),contacts:new ContactSound(),pieces:structuredClone(session.state.pieces),date:session.date,
    ghost:new THREE.Group(),ghostGeometry:null,ghostKey:'',ghostMaterial:new THREE.MeshBasicMaterial(),theme:{color:'#778c62'},
    views:initialPieces().map(p=>{const group=new THREE.Group();group.position.set(...p.position,0);return {turn:p.rotation,flip:0,target:new THREE.Vector3(),group};}),
    canvas:{style:{},focus(){},setPointerCapture(){},hasPointerCapture:(id:number)=>id===1,releasePointerCapture:(id:number)=>released.push(id)},
    downPoint:{clientX:0,clientY:0},lastPoint:{clientX:0,clientY:0},offset:new THREE.Vector2(),tilt:new THREE.Vector2(),
    pick(){return 0;},point(e:{clientX:number;clientY:number}){return new THREE.Vector3(e.clientX/100,e.clientY/100,0);},
    callbacks:{commit:(pieces:typeof session.state.pieces)=>session.commit(pieces),message:(text:string)=>messages.push(text),sound:()=>{},hover:()=>{}},
    updateView(){},
  });
  return {scene,session,released,messages};
}
const ringPoint=(degrees:number)=>({x:Math.cos(degrees*Math.PI/180)*100,y:Math.sin(degrees*Math.PI/180)*100});
function turn(scene:any,degrees:number,id=5){const p=ringPoint(degrees);scene.moveRotation(id,p.x,p.y);}

test('actual ring controller commits once on release, ignores other pointers and leaves full turns unchanged',()=>{
  const {scene,session}=fixture();
  assert.ok(scene.beginRotation(5,100,0,{x:0,y:0}));
  assert.equal(scene.beginRotation(6,100,0,{x:0,y:0}),false);
  turn(scene,90,6);assert.equal(scene.draft.rotation,0);
  turn(scene,60);turn(scene,150);turn(scene,230);
  assert.equal(session.state.past.length,0);
  scene.endRotation(6);assert.ok(scene.ring);
  scene.endRotation(5);assert.equal(session.state.past.length,1);assert.equal(session.state.pieces[0].rotation,3);
  session.undo();scene.pieces=structuredClone(session.state.pieces);
  scene.beginRotation(5,100,0,{x:0,y:0});
  for(const deg of [90,180,270,360])turn(scene,deg);
  scene.endRotation(5);assert.equal(session.state.past.length,0);
});
test('cancel and external sync restore a partial ring operation without history',()=>{
  const {scene,session}=fixture();
  scene.beginRotation(5,100,0,{x:0,y:0});turn(scene,100);scene.endRotation(5,true);
  assert.equal(session.state.past.length,0);assert.equal(scene.draft,null);
  scene.beginRotation(5,100,0,{x:0,y:0});turn(scene,100);
  scene.sync(session.date,session.state.pieces);
  assert.equal(scene.ring,null);assert.equal(scene.mode,'idle');assert.deepEqual(scene.pieces,session.state.pieces);
});
test('unplaceable ring turns reject the pose without modifying the saved board',()=>{
  const {scene,session,messages}=fixture();
  const solution=solve(getGoal(session.date))!;
  solution.forEach((p:Placement)=>scene.pieces[p.id]={id:p.id,rotation:p.rotation,flipped:p.flipped,angle:0,position:centerFor(p),placement:p});
  session.commit(scene.pieces);const before=structuredClone(session.state.pieces),history=session.state.past.length;
  scene.beginRotation(5,100,0,{x:0,y:0});turn(scene,90);scene.endRotation(5);
  assert.deepEqual(scene.pieces,before);assert.equal(session.state.past.length,history);
  assert.ok(messages.some(text=>text.includes('空间不够')));
});
test('tap selection reveals controls and pointer cancellation clears them without entering history',()=>{
  const {scene,session,released}=fixture();
  scene.gesture.begin({pointerId:1,pointerType:'touch',button:0,isPrimary:true,clientX:0,clientY:0});scene.mode='pressed';
  scene.pointerUp({pointerId:1,button:0,clientX:0,clientY:0});
  assert.equal(scene.active,0);assert.equal(scene.mode,'selected');assert.deepEqual(released,[1]);
  assert.equal(scene.controlsVisible,true);
  assert.equal(session.state.past.length,0);
  scene.gesture.begin({pointerId:1,pointerType:'touch',button:0,isPrimary:true,clientX:0,clientY:0});
  scene.mode='moving';scene.dragging=true;scene.draft=structuredClone(scene.pieces[0]);scene.draft.rotation=1;
  scene.pointerCancel({pointerId:2});assert.ok(scene.dragging);
  scene.pointerCancel({pointerId:1});assert.equal(scene.draft,null);assert.equal(scene.dragging,false);
  assert.equal(session.state.past.length,0);assert.equal(scene.pieces[0].rotation,0);
  assert.equal(scene.controlsVisible,false);assert.equal(scene.active,null);
});

test('rapid direction changes preserve every input and a second finger cannot use the ring buttons during a move',()=>{
  const {scene,session}=fixture();
  for(let i=1;i<=8;i++){scene.rotateSelected(1);assert.equal(scene.views[0].turn,i);}
  for(let i=7;i>=-2;i--){scene.rotateSelected(-1);assert.equal(scene.views[0].turn,i);}
  assert.equal(scene.pieces[0].rotation,2);
  const previous=structuredClone(session.state.pieces),history=session.state.past.length;
  scene.gesture.begin({pointerId:1,pointerType:'touch',button:0,isPrimary:true,clientX:0,clientY:0});
  scene.mode='moving';scene.dragging=true;scene.draft=structuredClone(scene.pieces[0]);
  scene.rotateSelected();scene.flipSelected();
  assert.deepEqual(session.state.pieces,previous);assert.equal(session.state.past.length,history);
  scene.cancelDrag();
});

function pointer(pointerType='touch',clientX=0,clientY=0){
  return {pointerId:1,pointerType,isPrimary:true,button:0,clientX,clientY,preventDefault(){}};
}
test('only a tap opens controls for touch, pen and mouse; hovering and a new press never open them',()=>{
  for(const type of ['touch','pen','mouse']){
    const {scene,session}=fixture();scene.controlsVisible=false;
    scene.pointerDown(pointer(type));assert.equal(scene.controlsVisible,false);assert.equal(scene.mode,'pressed');
    scene.pointerMove(pointer(type,3,2));assert.equal(scene.mode,'pressed');
    scene.pointerUp(pointer(type,3,2));assert.equal(scene.controlsVisible,true);
    assert.equal(session.state.past.length,0);
    scene.cancelDrag();scene.pointerMove(pointer('mouse',50));assert.equal(scene.controlsVisible,false);
  }
});
test('valid drops and invalid drops both leave the ring hidden until the next tap',()=>{
  for(const valid of [true,false]){
    const {scene,session}=fixture();scene.pointerDown(pointer());scene.pointerMove(pointer('touch',20));
    assert.equal(scene.mode,'moving');assert.equal(scene.controlsVisible,false);
    const solution=solve(getGoal(session.date))!,placement=solution.find(p=>p.id===0)!;
    const position=valid?centerFor(placement):[0,0];
    scene.draft.rotation=placement.rotation;scene.draft.flipped=placement.flipped;
    scene.positionDraft=()=>{scene.draft.position=[...position];scene.candidate=null;};
    // An out-of-bounds candidate guarantees rejection.
    if(!valid){scene.draft.position=[0,0];scene.proposal=()=>({...placement,x:-1,y:-1});}
    scene.pointerUp(pointer('touch',20));
    assert.equal(scene.controlsVisible,false);assert.equal(scene.draft,null);
    assert.equal(session.state.past.length,valid?1:0);
    scene.pointerDown(pointer());scene.pointerUp(pointer());assert.equal(scene.controlsVisible,true);
  }
});
test('a swipe ending before a move event is still a drag and cannot accidentally open controls',()=>{
  const {scene}=fixture();scene.pointerDown(pointer());scene.pointerUp(pointer('touch',30));
  assert.equal(scene.controlsVisible,false);assert.equal(scene.draft,null);
});
test('ring actions keep controls visible, while an external board replacement dismisses stale selection',()=>{
  const {scene,session}=fixture();scene.rotateSelected();assert.equal(scene.controlsVisible,true);
  scene.sync(session.date,session.state.pieces);assert.equal(scene.controlsVisible,true);
  const replacement=structuredClone(session.state.pieces);replacement[0].position=[-7,2];
  scene.sync(session.date,replacement);assert.equal(scene.controlsVisible,false);assert.equal(scene.active,null);
});
test('an explicit tap selection survives mouse travel to the ring instead of changing the selected piece',()=>{
  const {scene}=fixture();scene.pointerType='mouse';scene.controlsVisible=true;scene.pick=()=>1;
  scene.pointerMove(pointer('mouse',80));assert.equal(scene.active,0);
  scene.controlsVisible=false;scene.pointerMove(pointer('mouse',80));assert.equal(scene.active,1);
});
