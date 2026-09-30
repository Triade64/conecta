const { test } = require('node:test');
const assert = require('node:assert/strict');
const { generate, sortedPeople } = require('../kitchen-rotation.js');
const base = {people:['D','B','A','C'],startDate:'2026-09-28',startWasher:'A',startSweeper:'A',days:{}};
test('alphabetical round and Friday to Monday continuity',()=>{
 const result=generate(base,'2026-10-05');
 assert.deepEqual([result['2026-09-28'].wash,result['2026-09-28'].dry],['A','B']);
 assert.deepEqual([result['2026-10-02'].wash,result['2026-10-02'].dry],['A','B']);
 assert.equal(result['2026-10-03'].wash,null);
 assert.deepEqual([result['2026-10-05'].wash,result['2026-10-05'].dry],['B','C']);
});
test('B absent: A washes C dries, then C washes D dries',()=>{
 const result=generate({...base,days:{'2026-09-28':{absent:['B']}}},'2026-09-29');
 assert.deepEqual([result['2026-09-28'].wash,result['2026-09-28'].dry],['A','C']);
 assert.deepEqual([result['2026-09-29'].wash,result['2026-09-29'].dry],['C','D']);
});
test('missing washer is skipped and all absent does not consume a turn',()=>{
 const result=generate({...base,days:{'2026-09-28':{absent:['A']},'2026-09-29':{absent:['A','B','C','D']}}},'2026-09-30');
 assert.deepEqual([result['2026-09-28'].wash,result['2026-09-28'].dry],['B','C']);
 assert.equal(result['2026-09-29'].wash,null);assert.equal(result['2026-09-30'].wash,'C');
});
test('holiday suspension does not advance and Saturday can receive tasks',()=>{
 const result=generate({...base,days:{'2026-09-28':{dishes:false},'2026-10-03':{dishes:true}}},'2026-10-05');
 assert.equal(result['2026-09-29'].wash,'A');assert.equal(result['2026-10-03'].wash,'A');assert.equal(result['2026-10-05'].wash,'B');
});
test('sweeping has its own Wednesday round with absence handling',()=>{
 const result=generate({...base,days:{'2026-09-30':{absent:['A']}}},'2026-10-07');
 assert.equal(result['2026-09-29'].sweeper,null);assert.equal(result['2026-09-30'].sweeper,'B');assert.equal(result['2026-10-07'].sweeper,'C');
});
test('manual replacement controls next washer; no absent person is assigned',()=>{
 const result=generate({...base,days:{'2026-09-28':{dry:'D'},'2026-09-29':{wash:'D',absent:['D']}}},'2026-09-29');
 assert.equal(result['2026-09-28'].dry,'D');assert.equal(result['2026-09-29'].wash,'A');
});
test('two people wrap without assigning same person to both dishes tasks',()=>{
 const result=generate({...base,people:['A','B']},'2026-09-29');
 assert.equal(result['2026-09-29'].wash,'B');assert.equal(result['2026-09-29'].dry,'A');
});
test('invalid dates fail and empty config is safe',()=>{
 assert.deepEqual(generate({},'2026-09-30'),{});
 assert.throws(()=>generate({...base,startDate:'2026-02-30'},'2026-09-30'));
 assert.deepEqual(sortedPeople([' C ','Ána','B','C']),['Ána','B','C']);
});
