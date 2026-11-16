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
    active:0,mode:'selected',pointerType:'touch',dragging:false,ring:null,draft:null,candidate:null,
    gesture:new PieceGesture(),contacts:new ContactSound(),pieces:structuredClone(session.state.pieces),date:session.date,
    ghost:new THREE.Group(),ghostGeometry:null,ghostKey:'',ghostMaterial:new THREE.MeshBasicMaterial(),theme:{color:'#778c62'},
    views:initialPieces().map(p=>({turn:p.rotation,flip:0,target:new THREE.Vector3(),group:new THREE.Group()})),
    canvas:{hasPointerCapture:(id:number)=>id===1,releasePointerCapture:(id:number)=>released.push(id)},
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
  assert.equal(scene.ring,null);assert.equal(scene.mode,'selected');assert.deepEqual(scene.pieces,session.state.pieces);
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
test('tap selection and pointer cancellation do not enter history or lose selection',()=>{
  const {scene,session,released}=fixture();
  scene.gesture.begin({pointerId:1,pointerType:'touch',button:0,isPrimary:true,clientX:0,clientY:0});scene.mode='pressed';
  scene.pointerUp({pointerId:1,button:0});
  assert.equal(scene.active,0);assert.equal(scene.mode,'selected');assert.deepEqual(released,[1]);
  assert.equal(session.state.past.length,0);
  scene.gesture.begin({pointerId:1,pointerType:'touch',button:0,isPrimary:true,clientX:0,clientY:0});
  scene.mode='moving';scene.dragging=true;scene.draft=structuredClone(scene.pieces[0]);scene.draft.rotation=1;
  scene.pointerCancel({pointerId:2});assert.ok(scene.dragging);
  scene.pointerCancel({pointerId:1});assert.equal(scene.draft,null);assert.equal(scene.dragging,false);
  assert.equal(session.state.past.length,0);assert.equal(scene.pieces[0].rotation,0);
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
