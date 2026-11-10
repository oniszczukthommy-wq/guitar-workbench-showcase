export const TUNING=[40,45,50,55,59,64];
const NAMES=['C','C#','D','Eb','E','F','F#','G','Ab','A','Bb','B'];
const PCS={C:0,'C#':1,Db:1,D:2,'D#':3,Eb:3,E:4,Fb:4,'E#':5,F:5,'F#':6,Gb:6,G:7,'G#':8,Ab:8,A:9,'A#':10,Bb:10,B:11,Cb:11};
export function canonical(label){
  const value=String(label).trim().replaceAll('♭','b').replaceAll('♯','#');
  if(/^(N|none|silence|x)$/i.test(value)) return 'N';
  return value.replace(':min','m').replace(':maj7','maj7').replace(':maj','').replace(':','');
}
export function transpose(label,semitones){
  const chord=canonical(label);
  if(chord==='N')return chord;
  return chord.replace(/(^|\/)([A-G](?:#|b)?)/g,(_,prefix,note)=>prefix+NAMES[(PCS[note]+semitones%12+12)%12]);
}
export function voicing(database,label,position=0){
  const chord=canonical(label);
  const match=/^([A-G](?:#|b)?)(.*)$/.exec(chord);
  if(!match)return null;
  const key=Object.keys(database.chords).find(k=>PCS[database.chords[k][0]?.key]===PCS[match[1]]);
  const tail=match[2];
  const suffix=tail===''?'major':tail==='m'?'minor':tail;
  const item=database.chords[key]?.find(x=>x.suffix===suffix);
  if(!item)return null;
  const shape=item.positions[position%item.positions.length];
  const frets=shape.frets.map(n=>n<=0?n:n+shape.baseFret-1);
  return {...shape,frets,label:chord,count:item.positions.length,notes:frets.map((f,i)=>f<0?null:TUNING[i]+f)};
}
export function parseChordPro(text){
  const title=/\{(?:title|t):\s*([^}]+)\}/i.exec(text)?.[1]||'导入曲谱';
  const artist=/\{(?:artist|a):\s*([^}]+)\}/i.exec(text)?.[1]||'';
  const bpm=Number(/\{tempo:\s*([\d.]+)\}/i.exec(text)?.[1]||80);
  if(bpm<20||bpm>300)throw Error('速度须在 20–300 BPM 之间');
  const chordMatches=[...text.replace(/\{[^}]+\}/g,'').matchAll(/\[([^\]]+)\]/g)];
  if(!chordMatches.length)throw Error('没有找到 [C]、[Am] 这样的和弦标记');
  const duration=240/bpm;
  return {title,artist,bpm,lyrics:text,chords:chordMatches.map((m,i)=>({start_time:i*duration,end_time:(i+1)*duration,chord:canonical(m[1]),confidence:null})),source:'个人导入 ChordPro；时间轴按每个和弦四拍估算',reviewed:false};
}
export function diagram(shape){
  if(!shape)return '';
  const start=Math.max(1,shape.baseFret);
  const strings=Array.from({length:6},(_,i)=>`<line x1="${20+i*16}" y1="24" x2="${20+i*16}" y2="105" stroke="currentColor" stroke-width="1"/>`).join('');
  const frets=Array.from({length:6},(_,i)=>`<line x1="20" y1="${24+i*16}" x2="100" y2="${24+i*16}" stroke="currentColor" stroke-width="${i===0&&start===1?3:1}"/>`).join('');
  const dots=shape.frets.map((f,i)=>f<=0?`<text x="${20+i*16}" y="16" text-anchor="middle" font-size="11" fill="currentColor">${f<0?'×':'○'}</text>`:`<circle cx="${20+i*16}" cy="${24+(f-start+.5)*16}" r="5" fill="currentColor"/>`).join('');
  return `<svg viewBox="0 0 120 118" role="img" aria-label="和弦指法">${strings}${frets}${dots}${start>1?`<text x="5" y="37" font-size="10" fill="currentColor">${start}</text>`:''}</svg>`;
}
