import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { ContactSound, QUARTER, RingRotation, flipClearance, nearestTurn, proposalFor, ringLayout, springStep, stickyRound, turnedAtCenter } from '../src/game/interaction.ts';
import { initialPieces, GameSession, emptyStore, centerFor, validSnapshot } from '../src/game/session.ts';
import { PIECES, transform, getGoal, solve } from '../src/game/puzzle.ts';

test('continuous model transforms produce the same cells as all discrete orientations',()=>{
  PIECES.forEach(({cells})=>{
    const w=Math.max(...cells.map(c=>c[0])),h=Math.max(...cells.map(c=>c[1]));
    for(let rotation=0;rotation<4;rotation++)for(const flipped of [false,true]){
      const quaternion=new THREE.Quaternion().setFromEuler(new THREE.Euler(0,flipped?Math.PI:0,-rotation*QUARTER,'ZYX'));
      const actual=cells.map(([x,y])=>new THREE.Vector3(x-w/2,-y+h/2,0).applyQuaternion(quaternion));
      const expected=transform(cells,rotation,flipped),ew=Math.max(...expected.map(c=>c[0])),eh=Math.max(...expected.map(c=>c[1]));
      assert.deepEqual(actual.map(v=>[Math.round((v.x+ew/2)*1e6)/1e6||0,Math.round((-v.y+eh/2)*1e6)/1e6||0]).sort(),[...expected].sort());
    }
  });
});
test('critical springs converge independently of frame interval and retarget without position jumps',()=>{
  const run=(dt:number)=>{let state={value:0,velocity:0};for(let t=0;t<1-.00001;t+=dt)state=springStep(state,1,dt);return state;};
  const a=run(1/30),b=run(1/60),c=run(1/120);
  assert.ok(Math.abs(a.value-b.value)<1e-10&&Math.abs(b.value-c.value)<1e-10);
  assert.ok(Math.abs(a.value-1)<1e-10);
  const moving=springStep({value:0,velocity:0},3,.02);
  const retarget=springStep(moving,-2,0);assert.deepEqual(retarget,moving);
  assert.deepEqual(springStep(moving,-2,.02,40,true),{value:-2,velocity:0});
});
test('turn targets accumulate through wraparound and reverse without dropping inputs',()=>{
  let target=0;
  for(let i=1;i<=20;i++){target=nearestTurn(i%4,target);assert.equal(target,i);}
  for(let i=19;i>=-8;i--){target=nearestTurn((i%4+4)%4,target);assert.equal(target,i);}
});
test('rotation unwraps across 180 degrees and uses hysteresis before changing preview',()=>{
  const ring=new RingRotation();ring.begin(170*Math.PI/180);
  ring.move(-170*Math.PI/180);assert.ok(Math.abs(ring.angle-20*Math.PI/180)<1e-9);
  ring.begin(0);assert.equal(ring.move(50*Math.PI/180),false);
  assert.equal(ring.move(54*Math.PI/180),true);assert.equal(ring.step,1);
  ring.move(44*Math.PI/180);assert.equal(ring.step,1);
  ring.move(36*Math.PI/180);assert.equal(ring.step,0);
  ring.move(48*Math.PI/180);assert.equal(ring.finish(),1);
  ring.move(0);assert.equal(ring.finish(),0);
});
test('grid preview sticks around a boundary and uses the same candidate for final placement',()=>{
  assert.equal(stickyRound(2.6,2),2);assert.equal(stickyRound(2.63,2),3);
  const p=initialPieces()[0];p.position=[-2.4,1];
  const candidate=proposalFor(p);
  p.position[0]+=.05;
  const preview=proposalFor(p,candidate),drop=proposalFor(p,preview);assert.deepEqual(preview,drop);
  const rotated=turnedAtCenter(p,1,false);assert.equal(rotated.placement,null);
});
test('ring operations commit only final valid poses, with one undo and no entry for a full turn',()=>{
  const date=new Date(2026,10,16),session=new GameSession(date,emptyStore());
  const base=structuredClone(session.state.pieces);
  for(let i=1;i<=3;i++)turnedAtCenter(base[0],i,false);
  assert.equal(session.state.past.length,0);
  const next=structuredClone(base);next[0]=turnedAtCenter(base[0],3,false);session.commit(next);
  assert.equal(session.state.past.length,1);session.undo();assert.deepEqual(session.state.pieces,base);
  const full=structuredClone(base);full[0]=turnedAtCenter(base[0],0,false);
  assert.equal(session.commit(full),false);
  const solution=solve(getGoal(date))!;const posed=initialPieces();
  solution.forEach(p=>posed[p.id]={id:p.id,rotation:p.rotation,flipped:p.flipped,angle:0,position:centerFor(p),placement:p});
  assert.ok(validSnapshot(posed,date));
  const turned=turnedAtCenter(posed[0],(posed[0].rotation+1)%4,posed[0].flipped);
  assert.deepEqual(turned.position,centerFor(turned.placement!));
  const invalid=structuredClone(posed);invalid[0].placement!.x=-10;invalid[0].position=centerFor(invalid[0].placement!);
  assert.equal(session.commit(invalid),false);assert.equal(session.state.past.length,0);
});
test('ring hit areas stay within phone and landscape viewports even at corners',()=>{
  for(const [width,height]of [[304,462],[374,568],[414,629],[780,350]]){
    for(const x of [0,width/2,width])for(const y of [0,height/2,height]){
      const l=ringLayout({x,y,width:150,height:110},width,height);
      assert.ok(l.x-l.radius-22>=0&&l.x+l.radius+22<=width);
      assert.ok(l.y-l.radius-22>=0&&l.y+l.radius+22<=height);
      assert.ok(l.x-32>=0&&l.x+32<=width);
    }
  }
});
test('contact audio plays once at contact and stale events can be cancelled or replaced',()=>{
  const contacts=new ContactSound();contacts.schedule(0,100);
  assert.deepEqual(contacts.ready(259),[]);assert.deepEqual(contacts.ready(260),[0]);assert.deepEqual(contacts.ready(500),[]);
  contacts.schedule(0,500);contacts.cancel(0);assert.deepEqual(contacts.ready(1000),[]);
  contacts.schedule(1,1000);contacts.schedule(1,1100);assert.deepEqual(contacts.ready(1160),[]);
  contacts.cancel();assert.deepEqual(contacts.ready(2000),[]);
});
test('flip clearance keeps every corner above the surface throughout a half turn',()=>{
  for(const scale of [.52,1])for(let i=0;i<=100;i++){
    const flip=i/100,angle=flip*Math.PI,floor=-.04;
    const height=flipClearance(2,scale,flip,floor);
    const lowestCorner=height+.125-(2*Math.abs(Math.sin(angle))+.16*Math.abs(Math.cos(angle)))*scale;
    assert.ok(lowestCorner>=floor-1e-9);
  }
});
test('partly scrolled canvases keep controls inside the visible screen and connect to the piece',()=>{
  const visible={left:0,top:150,right:374,bottom:500};
  for(const y of [0,200,568]){
    const l=ringLayout({x:187,y,width:180,height:140},374,568,visible);
    assert.ok(l.y-l.radius-22>=visible.top&&l.y+l.radius+22<=visible.bottom);
    assert.equal(l.anchorY,y);
  }
  const l=ringLayout({x:187,y:700,width:300,height:100},374,1000);
  assert.ok(l.y<650);
});
