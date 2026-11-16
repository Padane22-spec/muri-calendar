import test from 'node:test';
import assert from 'node:assert/strict';
import { BOARD, PIECES, canPlace, getGoal, isSolved, normalize, placedCells, solve, transform, type Placement } from '../src/game/puzzle.ts';

test('fixed pieces cover exactly the board apart from two date cells',()=>{
  assert.equal(BOARD.length,43);
  assert.equal(PIECES.reduce((sum,p)=>sum+p.cells.length,0),41);
  assert.equal(PIECES.length,8);
});
test('rotation and reflection preserve shape and are reversible',()=>{
  for(const piece of PIECES){
    assert.deepEqual(transform(piece.cells,4,false),normalize(piece.cells));
    assert.deepEqual(transform(transform(piece.cells,0,true),0,true),normalize(piece.cells));
    assert.equal(new Set(transform(piece.cells,3,true).map(c=>c.join(','))).size,piece.cells.length);
  }
});
test('valid solution wins; overlaps, out of bounds, and date coverage fail',()=>{
  const goal=getGoal(new Date(2026,10,16));const solution=solve(goal)!;
  assert.ok(solution);assert.ok(isSolved(solution,goal));
  assert.equal(isSolved(solution.slice(1),goal),false);
  assert.equal(canPlace({...solution[0],x:-8},solution,goal),false);
  const p:Placement={id:0,x:0,y:0,rotation:0,flipped:false};
  assert.equal(canPlace(p,[],[placedCells(p)[0],goal[1]]),false);
  assert.equal(canPlace(solution[0],[{...solution[0],id:7}],goal),false);
});
test('hint solver preserves existing placements and refuses conflicting ones',()=>{
  const goal=getGoal(new Date(2024,1,29));const solution=solve(goal)!;
  const hinted=solve(goal,solution.slice(0,3))!;
  assert.ok(isSolved(hinted,goal));assert.deepEqual(hinted.slice(0,3),solution.slice(0,3));
  assert.equal(solve(goal,[solution[0],solution[0]]),null);
});
