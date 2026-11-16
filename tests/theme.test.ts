import test from 'node:test';
import assert from 'node:assert/strict';
import { seasonFor } from '../src/game/theme.ts';
test('season boundaries follow the selected calendar month, including year boundaries',()=>{
  const expected=['winter','winter','spring','spring','spring','summer','summer','summer','autumn','autumn','autumn','winter'];
  for(let month=0;month<12;month++)assert.equal(seasonFor(new Date(2026,month,16)).id,expected[month]);
});
