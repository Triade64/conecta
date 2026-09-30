const { test } = require('node:test');
const assert = require('node:assert/strict');
const { generate, sortedPeople } = require('../kitchen-rotation.js');
const base = {people:['D','B','A','C'],startDate:'2026-09-28',startWasher:'A',sweepPairs:[['A','B'],['C','D']],startSweepPair:0,days:{}};
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
test('sweeping keeps fixed pairs when one member is absent',()=>{
 const result=generate({...base,days:{'2026-09-30':{absent:['A']}}},'2026-10-07');
 assert.equal(result['2026-09-29'].sweepers,null);assert.deepEqual(result['2026-09-30'].sweepers,['A','B']);assert.deepEqual(result['2026-10-07'].sweepers,['C','D']);
});
test('both sweeping members absent does not skip pair or change the next pair',()=>{
 const result=generate({...base,days:{'2026-09-30':{absent:['A','B','C','D']}}},'2026-10-14');
 assert.deepEqual(result['2026-09-30'].sweepers,['A','B']);assert.deepEqual(result['2026-10-07'].sweepers,['C','D']);assert.deepEqual(result['2026-10-14'].sweepers,['A','B']);
});
test('four office pairs follow the supplied order and wrap, independently of dishes',()=>{
 const sweepPairs=[['Gabriel','Gabriele'],['Janice','Klarice'],['Rose','Simone'],['Vitoria','Chaiane']];
 const result=generate({...base,sweepPairs},'2026-10-28');
 ['2026-09-30','2026-10-07','2026-10-14','2026-10-21','2026-10-28'].forEach((date,i)=>assert.deepEqual(result[date].sweepers,sweepPairs[i%4]));
});
test('suspending sweeping preserves turn; moved date keeps a full pair',()=>{
 const result=generate({...base,days:{'2026-09-30':{sweep:false},'2026-10-01':{sweep:true,sweepPair:0}}},'2026-10-07');
 assert.equal(result['2026-09-30'].sweepers,null);assert.deepEqual(result['2026-10-01'].sweepers,['A','B']);assert.deepEqual(result['2026-10-07'].sweepers,['C','D']);
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
