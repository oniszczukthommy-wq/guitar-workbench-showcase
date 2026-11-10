import test from 'node:test';
import assert from 'node:assert/strict';
import {GestureLogic} from '../dist/gesture-logic.js';
function right(y){return Array.from({length:21},(_,i)=>({x:.2+i*.001,y:y+(i===0?0:-.1),z:0}));}
test('右区挥手有防抖，静止和首次进入不发声',()=>{
 const logic=new GestureLogic();
 assert.equal(logic.update([right(.3)],1000).strum,null);
 assert.equal(logic.update([right(.3)],1080).strum,null);
 assert.equal(logic.update([right(.37)],1160).strum,'down');
 assert.equal(logic.update([right(.44)],1240).strum,null);
 assert.equal(logic.update([],1600).strum,null);
 assert.equal(logic.update([right(.6)],1680).strum,null);
});
test('捏合逐渐松开也能触发一次，不要求单帧跳过中间阈值',()=>{
 const logic=new GestureLogic();
 function hand(ratio){const points=right(.5);points[4]={x:.2,y:.4,z:0};points[8]={x:.2+ratio*.1,y:.4,z:0};points[9]={x:.2,y:.4,z:0};points[0]={x:.2,y:.5,z:0};return points;}
 assert.equal(logic.update([hand(.2)],1000,'pinch').strum,null);
 assert.equal(logic.update([hand(.45)],1080,'pinch').strum,null);
 assert.equal(logic.update([hand(.55)],1160,'pinch').strum,null);
 assert.equal(logic.update([hand(.8)],1240,'pinch').strum,'down');
 assert.equal(logic.update([hand(.9)],1480,'pinch').strum,null);
});
