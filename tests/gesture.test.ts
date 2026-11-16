import test from 'node:test';
import assert from 'node:assert/strict';
import { PieceGesture } from '../src/game/gesture.ts';

const touch={pointerId:1,pointerType:'touch',button:0,isPrimary:true,clientX:100,clientY:100};

test('touch taps tolerate finger jitter and crossing slop starts a sticky drag',()=>{
  const gesture=new PieceGesture();assert.ok(gesture.begin(touch));
  assert.ok(gesture.isTap);
  assert.equal(gesture.move({...touch,clientX:103,clientY:104}),false);
  assert.ok(gesture.isTap);
  assert.ok(gesture.move({...touch,clientX:107}));assert.equal(gesture.isTap,false);
  assert.ok(gesture.move(touch));
});
test('secondary fingers cannot take over, move, or end the active gesture',()=>{
  const gesture=new PieceGesture();assert.equal(gesture.begin({...touch,isPrimary:false}),false);
  gesture.begin(touch);
  const other={...touch,pointerId:2,clientX:200};
  assert.equal(gesture.begin(other),false);assert.equal(gesture.move(other),false);
  assert.equal(gesture.owns(other),false);assert.ok(gesture.isTap);
  assert.ok(gesture.owns(touch));
});
test('cancel or release clears ownership and the next touch starts as a new tap',()=>{
  const gesture=new PieceGesture();gesture.begin(touch);gesture.move({...touch,clientY:120});
  assert.equal(gesture.clear(),1);assert.equal(gesture.pointerId,null);
  assert.equal(gesture.owns(touch),false);assert.equal(gesture.move(touch),false);
  assert.equal(gesture.isTap,false);
  assert.ok(gesture.begin({...touch,pointerId:3}));assert.ok(gesture.isTap);
});
test('mouse clicks stay taps until movement exceeds slop and non-primary buttons are ignored',()=>{
  for(const pointerType of ['mouse']){
    const gesture=new PieceGesture();
    assert.equal(gesture.begin({...touch,pointerType,button:2}),false);
    assert.ok(gesture.begin({...touch,pointerType}));assert.ok(gesture.isTap);
    assert.equal(gesture.move(touch),false);
    assert.ok(gesture.move({...touch,clientX:110}));assert.equal(gesture.isTap,false);
  }
});
test('pen taps have the same jitter tolerance as a finger',()=>{
  const gesture=new PieceGesture();gesture.begin({...touch,pointerType:'pen'});
  assert.equal(gesture.move({...touch,clientX:103}),false);assert.ok(gesture.isTap);
  assert.ok(gesture.move({...touch,clientX:110}));assert.equal(gesture.isTap,false);
});
test('turning a held piece makes the attempt a move even before the finger travels',()=>{
  const gesture=new PieceGesture();gesture.begin(touch);assert.ok(gesture.isTap);
  gesture.markChanged();assert.equal(gesture.isTap,false);assert.ok(gesture.move(touch));
  gesture.clear();gesture.markChanged();assert.equal(gesture.isTap,false);
});
