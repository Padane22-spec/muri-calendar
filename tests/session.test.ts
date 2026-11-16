import test from 'node:test';
import assert from 'node:assert/strict';
import { GameSession, centerFor, decodeStore, emptyStore, initialPieces, validSnapshot } from '../src/game/session.ts';
import { getGoal, solve, solveDetailed, type Placement } from '../src/game/puzzle.ts';
const date=new Date(2026,10,16);
function solutionPieces(solution:Placement[]){const pieces=initialPieces();solution.forEach(p=>pieces[p.id]={id:p.id,rotation:p.rotation,flipped:p.flipped,angle:0,position:centerFor(p),placement:p});return pieces;}

test('commits, undo and redo preserve complete poses and clear the redo branch',()=>{
  const session=new GameSession(date,emptyStore()),initial=initialPieces();
  const changed=structuredClone(initial);changed[0].position=[-8,1.5];changed[0].rotation=1;
  assert.ok(session.commit(changed));assert.deepEqual(session.state.past,[initial]);
  assert.ok(session.undo());assert.deepEqual(session.state.pieces,initial);
  assert.ok(session.redo());assert.deepEqual(session.state.pieces,changed);
  session.undo();const branch=structuredClone(initial);branch[1].flipped=true;
  session.commit(branch);assert.equal(session.state.future.length,0);
  assert.equal(session.commit(branch),false);
  const invalid=structuredClone(branch);invalid[0].position=[NaN,0];
  assert.equal(session.commit(invalid),false);
});
test('date switching saves independent sessions, including rack poses and history',()=>{
  const store=emptyStore(),session=new GameSession(date,store);
  const changed=initialPieces();changed[2].position=[-7.4,-2.1];session.commit(changed);
  session.changeDate(new Date(2024,1,29));assert.deepEqual(session.state.pieces,initialPieces());
  session.hint();session.changeDate(date);assert.deepEqual(session.state.pieces,changed);
  assert.equal(session.state.past.length,1);
  const restored=new GameSession(date,decodeStore(JSON.stringify(store)));
  assert.deepEqual(restored.state,session.state);
});
test('independent and assisted completion award different stamps; undo cannot erase hint usage',()=>{
  const store=emptyStore(),session=new GameSession(date,store);
  assert.equal(session.hint(),'placed');assert.equal(session.state.hinted,true);
  session.undo();assert.equal(session.state.hinted,true);session.redo();
  session.commit(solutionPieces(solve(getGoal(date))!));
  assert.equal(session.collect(),'assisted');assert.equal(store.stamps['2026-11-16'],'assisted');
  session.restart();assert.equal(session.state.hinted,false);assert.equal(store.stamps['2026-11-16'],'assisted');
  session.commit(solutionPieces(solve(getGoal(date))!));assert.equal(session.collect(),'independent');
  session.restart();session.hint();session.commit(solutionPieces(solve(getGoal(date))!));session.collect();
  assert.equal(store.stamps['2026-11-16'],'independent');
});
test('reference solution never qualifies for a stamp even after undo and redo',()=>{
  const store=emptyStore(),session=new GameSession(date,store);
  session.reveal();assert.ok(session.solved);assert.equal(session.stamp,null);
  assert.equal(store.stamps['2026-11-16'],'viewed');assert.equal(session.collect(),null);
  session.undo();assert.equal(session.state.viewed,true);session.redo();assert.equal(session.collect(),null);
  session.restart();session.commit(solutionPieces(solve(getGoal(date))!));session.collect();
  assert.equal(store.stamps['2026-11-16'],'independent');session.reveal();assert.equal(store.stamps['2026-11-16'],'independent');
});
test('completed saved attempts retain celebration status',()=>{
  const store=emptyStore(),session=new GameSession(date,store);
  session.commit(solutionPieces(solve(getGoal(date))!));session.collect();session.save();
  const restored=new GameSession(date,decodeStore(JSON.stringify(store)));
  assert.equal(restored.solved,true);assert.equal(restored.state.celebrated,true);
});
test('corrupt, mismatched, overlapping or impossible saved poses are discarded',()=>{
  assert.deepEqual(decodeStore('{broken'),emptyStore());
  assert.deepEqual(decodeStore('{"version":999}'),emptyStore());
  const store=emptyStore(),session=new GameSession(date,store);session.save();
  store.sessions['2026-11-16'].pieces[0].rotation=100;
  assert.equal(Object.keys(decodeStore(JSON.stringify(store)).sessions).length,0);
  const poses=solutionPieces(solve(getGoal(date))!);poses[0].position=[0,0];assert.equal(validSnapshot(poses,date),false);
  const bad=initialPieces();bad[0].placement={id:0,rotation:0,flipped:false,x:-5,y:0};bad[0].position=centerFor(bad[0].placement);
  assert.equal(validSnapshot(bad,date),false);
  const fresh=emptyStore();fresh.stamps['2026-02-30']='independent';assert.deepEqual(decodeStore(JSON.stringify(fresh)).stamps,{});
});
test('search distinguishes a proven impossibility from exhausted budget',()=>{
  assert.equal(solveDetailed(getGoal(date),[],0).status,'limit');
  const solution=solve(getGoal(date))!;
  assert.equal(solveDetailed(getGoal(date),[solution[0],solution[0]]).status,'unsolvable');
  assert.equal(solveDetailed(getGoal(date)).status,'solved');
});
test('history stays bounded and seasonal collection is separated by full date',()=>{
  const store=emptyStore(),session=new GameSession(date,store);
  for(let i=0;i<110;i++){const next=structuredClone(session.state.pieces);next[0].position=[-8+i*.001,2];session.commit(next);}
  assert.equal(session.state.past.length,100);
  session.commit(solutionPieces(solve(getGoal(date))!));session.collect();
  session.changeDate(new Date(2025,10,16));assert.equal(store.stamps['2025-11-16'],undefined);
});

test('reset preserves mute preference and history cannot remove reference exposure',()=>{
  const store=emptyStore();store.muted=true;const session=new GameSession(date,store);
  session.reveal();session.undo();session.redo();
  assert.equal(session.state.viewed,true);session.restart();
  assert.equal(session.state.viewed,false);assert.equal(store.muted,true);
  assert.equal(decodeStore(JSON.stringify(store)).muted,true);
});
