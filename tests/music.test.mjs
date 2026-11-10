import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {voicing,transpose,parseChordPro} from '../dist/music.js';
const db=JSON.parse(fs.readFileSync(new URL('../dist/assets/guitar.json',import.meta.url)));
test('数据库品位正确转换为各弦实际音高',()=>{
  assert.deepEqual(voicing(db,'C').notes,[null,48,52,55,60,64]);
  assert.deepEqual(voicing(db,'Am').notes,[null,45,52,57,60,64]);
  assert.deepEqual(voicing(db,'D',1).notes,[null,50,54,57,62,66]);
});
test('升降号同音映射支持 Csharp/Fsharp 数据库键名',()=>{
  assert.ok(voicing(db,'C#'));
  assert.ok(voicing(db,'F#m'));
  assert.deepEqual(voicing(db,'Db').notes,voicing(db,'C#').notes);
  assert.deepEqual(voicing(db,'Gb').notes,voicing(db,'F#').notes);
});
test('移调保留小调与斜杠低音，不改变无和弦标记',()=>{
  assert.equal(transpose('Cm7/G',2),'Dm7/A');
  assert.equal(transpose('Bbmaj7',-2),'Abmaj7');
  assert.equal(transpose('N',3),'N');
});
test('ChordPro 导入明确按每和弦四拍生成可编辑时间轴',()=>{
  const s=parseChordPro('{title:练习}\n{tempo:120}\n[C]一[Am]二');
  assert.equal(s.title,'练习');
  assert.equal(s.chords[1].start_time,2);
  assert.match(s.source,/估算/);
});
