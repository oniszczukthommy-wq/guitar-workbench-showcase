import {GuitarAudio} from './audio.js';
import {voicing,diagram,transpose,parseChordPro,canonical} from './music.js';
import {CameraHands} from './hands.js?v=20261025-smooth-ui';
const $=id=>document.getElementById(id);
const guitar=new GuitarAudio();
let database,pads=['C','G','Am','F','Em','Dm'],chord='C',position=0,currentSong=null,analysis=null,jobId=null,engines=[],shift=0,editSource=null,camera,arpLoop=null,arpIndex=0,mediaRecorder=null,recordingChunks=[],microphoneStream=null,microphoneSource=null,recordingUrl=null,recordingStartedAt=0,recordingTimer=null;
try{pads=JSON.parse(localStorage.getItem('guitar-pads'))||pads;}catch{}
const keys=['1','2','3','4','5','6','7','8'];
let toastTimer;
function toast(message){$('toast').textContent=message;$('toast').classList.add('visible');clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('toast').classList.remove('visible'),3500);}
async function api(path,options){const r=await fetch('/api'+path,options);const j=await r.json();if(!r.ok)throw Error(typeof j.detail==='string'?j.detail:'数据格式不正确');return j;}
function tab(id){document.querySelectorAll('.view').forEach(v=>v.hidden=v.id!==id);document.querySelectorAll('.tab').forEach(b=>b.classList.toggle('active',b.dataset.tab===id));if(id==='library')loadSongs();}
function shape(){return database?voicing(database,chord,position):null;}
function setupReferenceLayout(){
  document.querySelector('#play .intro h1').textContent='手势吉他，随时弹唱。';
  document.querySelector('#play .intro .muted').textContent='左区选和弦，右区挥手弹奏。也可以直接拨动屏幕上的琴弦。';
  const layout=document.querySelector('.instrument-layout');
  const stage=document.createElement('div');stage.className='camera-stage';stage.id='cameraStage';
  stage.innerHTML=`<video id="cameraVideo" muted playsinline></video><canvas id="handCanvas"></canvas><span class="camera-status" id="trackingStatus">屏幕弹奏 · 摄像头未开启</span><div class="camera-guide"><span>左区竖起 1–6 · 常用和弦</span><span>右区挥手 · 拨动琴弦</span></div><div id="cameraChordMenu" class="camera-menu"></div><div id="cameraChord" class="camera-chord screen-mode">C</div><div id="manualPanel" class="manual-panel"></div><div class="camera-footer"><span>双手识别在浏览器本地完成，画面不会上传。</span><div class="camera-mini-controls"><button id="cameraButton">开启摄像头</button><button id="screenButton">屏幕拨弦</button></div></div>`;
  layout.prepend(stage);layout.after(document.querySelector('.chord-panel'));
  const scorePanel=document.querySelector('.sheet-panel');scorePanel.hidden=true;layout.append(scorePanel);
  $('manualPanel').append($('strings'));
  document.querySelector('.instrument-top .eyebrow').textContent='NOW PLAYING';
  document.querySelector('.chord-panel h2').textContent='常用和弦';
  $('mute').innerHTML='止音<span>Esc</span>';
  const controls=document.createElement('div');controls.className='gesture-options';
  controls.innerHTML=`<label>操作方式<select id="gestureMethod"><option value="wave">锁定和弦＋双手挥奏 · 推荐</option><option value="pinch">右手捏合、松开触发弹奏</option></select></label><label class="auto-pattern">自动分解和弦<input id="autoPattern" type="checkbox"></label><label class="tempo-row">速度 <span id="tempoValue">84 BPM</span><input id="tempo" type="range" min="40" max="180" value="84"></label>`;
  document.querySelector('.strum-controls').before(controls);
  const advanced=document.createElement('details');advanced.className='tone-details';advanced.innerHTML='<summary>音色细节</summary>';
  advanced.append($('space').parentElement,$('velocity').parentElement);
  document.querySelector('.sound-controls').after(advanced);
  camera=new CameraHands($('cameraVideo'),$('handCanvas'),{
    status:message=>$('trackingStatus').textContent=message,
    choose:number=>{if(pads[number-1])choose(pads[number-1]);},
    strum:direction=>strum(direction),
    error:message=>toast(message),
    started:()=>{$('manualPanel').hidden=true;$('cameraChord').classList.remove('screen-mode');$('cameraButton').textContent='关闭摄像头';$('cameraStage').classList.add('camera-active');},
    stopped:()=>{$('manualPanel').hidden=false;$('cameraChord').classList.add('screen-mode');$('cameraButton').textContent='开启摄像头';$('trackingStatus').textContent='屏幕弹奏 · 摄像头未开启';$('cameraStage').classList.remove('camera-active');}
  });
  $('cameraButton').onclick=async()=>{if(camera.active){camera.stop();return;}const b=$('cameraButton');b.disabled=true;b.textContent='准备摄像头…';try{if(!guitar.ready)await enable();await camera.start();}catch(e){toast(e.message);}finally{b.disabled=false;}};
  $('screenButton').onclick=()=>{camera.stop();$('strings').scrollIntoView({block:'nearest'});};
  $('gestureMethod').onchange=e=>camera.method=e.target.value;
  $('tempo').oninput=e=>{const bpm=Number(e.target.value);$('tempoValue').textContent=bpm+' BPM';Tone.getTransport().bpm.value=bpm;};
  $('autoPattern').onchange=async e=>{if(!e.target.checked){stopArpeggio();return;}if(!guitar.ready)await enable();if(!guitar.ready){e.target.checked=false;return;}Tone.getTransport().bpm.value=Number($('tempo').value);arpIndex=0;arpLoop=new Tone.Loop(time=>{const s=shape();if(!s)return;const strings=s.notes.map((n,i)=>n===null?null:i).filter(x=>x!==null);const pattern=[0,2,3,4,3,2];const string=strings[Math.min(pattern[arpIndex++%pattern.length],strings.length-1)];guitar.pluck(string,s.notes[string],Number($('velocity').value)*.85,Math.max(0,time-Tone.now()));ring(string);},'8n').start(0);Tone.getTransport().start();};
  document.addEventListener('visibilitychange',()=>{if(document.hidden){stopRecording();camera.stop();stopArpeggio();guitar.stop();}});
  window.addEventListener('pagehide',()=>{stopRecording();camera.stop();stopArpeggio();guitar.stop();if(recordingUrl)URL.revokeObjectURL(recordingUrl);});
}
function stopArpeggio(){if(arpLoop){arpLoop.dispose();arpLoop=null;}Tone.getTransport().stop();if($('autoPattern'))$('autoPattern').checked=false;}
function recordingTime(ms){const seconds=Math.floor(ms/1000);return `${String(Math.floor(seconds/60)).padStart(2,'0')}:${String(seconds%60).padStart(2,'0')}`;}
function releaseMicrophone(){try{microphoneSource?.disconnect();}catch{}microphoneSource=null;microphoneStream?.getTracks().forEach(track=>track.stop());microphoneStream=null;clearInterval(recordingTimer);recordingTimer=null;}
async function startRecording(){
  const button=$('recordToggle'),status=$('recordStatus');
  if(!window.MediaRecorder){toast('当前浏览器不支持录音，请使用较新的 Chrome、Edge 或 Safari。');return;}
  if(!navigator.mediaDevices?.getUserMedia){toast('录音需要 HTTPS 或电脑上的 localhost。');return;}
  button.disabled=true;status.textContent='正在准备吉他音源…';
  try{
    if(!guitar.ready)await enable();
    if(!guitar.ready)throw Error('吉他音源尚未就绪，请重试。');
    await guitar.unlock();
    status.textContent='请允许使用麦克风…';
    microphoneStream=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:false,noiseSuppression:true,autoGainControl:true},video:false});
    microphoneSource=Tone.getContext().rawContext.createMediaStreamSource(microphoneStream);
    microphoneSource.connect(guitar.recordDestination);
    const choices=['audio/webm;codecs=opus','audio/mp4;codecs=mp4a.40.2','audio/mp4','audio/webm'];
    const mimeType=choices.find(type=>MediaRecorder.isTypeSupported?.(type));
    mediaRecorder=mimeType?new MediaRecorder(guitar.recordDestination.stream,{mimeType,audioBitsPerSecond:192000}):new MediaRecorder(guitar.recordDestination.stream);
    recordingChunks=[];
    if(recordingUrl){URL.revokeObjectURL(recordingUrl);recordingUrl=null;}
    $('recordingPreview').pause();$('recordingPreview').removeAttribute('src');$('recordingPreview').hidden=true;$('downloadRecording').hidden=true;
    const activeRecorder=mediaRecorder;
    activeRecorder.ondataavailable=event=>{if(event.data?.size)recordingChunks.push(event.data);};
    activeRecorder.onerror=()=>{status.textContent='录音出错，请重试';toast('录音失败，请检查麦克风权限后重试。');};
    activeRecorder.onstop=()=>{
      const type=activeRecorder.mimeType||recordingChunks[0]?.type||'audio/webm';
      const blob=new Blob(recordingChunks,{type});const elapsed=Date.now()-recordingStartedAt;
      releaseMicrophone();mediaRecorder=null;
      button.textContent='● 重新录音';button.classList.remove('recording');button.setAttribute('aria-pressed','false');button.disabled=false;
      if(!blob.size){status.textContent='没有录到音频，请重试';return;}
      recordingUrl=URL.createObjectURL(blob);const preview=$('recordingPreview');preview.src=recordingUrl;preview.hidden=false;
      const ext=type.includes('mp4')?'m4a':'webm';const link=$('downloadRecording');link.href=recordingUrl;link.download=`弦间录音-${new Date().toISOString().replace(/[:.]/g,'-')}.${ext}`;link.hidden=false;
      status.textContent=`录音完成 · ${recordingTime(elapsed)} · 可试听或下载`;
    };
    activeRecorder.start(250);recordingStartedAt=Date.now();button.disabled=false;button.textContent='■ 停止录音';button.classList.add('recording');button.setAttribute('aria-pressed','true');
    status.textContent='录音中 00:00 · 歌声 + 吉他';recordingTimer=setInterval(()=>{status.textContent=`录音中 ${recordingTime(Date.now()-recordingStartedAt)} · 歌声 + 吉他`;},500);
  }catch(error){releaseMicrophone();mediaRecorder=null;button.textContent='● 开始录音';button.classList.remove('recording');button.setAttribute('aria-pressed','false');status.textContent='录音未开始';toast(error.name==='NotAllowedError'?'麦克风权限未开启；允许访问后即可录音。':error.message||'无法开始录音。');}
  finally{if(!mediaRecorder)button.disabled=false;}
}
function stopRecording(){if(!mediaRecorder||mediaRecorder.state==='inactive')return;$('recordStatus').textContent='正在整理录音…';$('recordToggle').disabled=true;clearInterval(recordingTimer);recordingTimer=null;mediaRecorder.stop();}
function toggleRecording(){if(mediaRecorder?.state==='recording')stopRecording();else void startRecording();}
function mute(){stopArpeggio();guitar.stop();}
function choose(value){chord=canonical(value);position=0;updateChord();}
function updateChord(){
  const item=shape();$('currentChord').textContent=chord;$('currentDiagram').innerHTML=diagram(item);
  if($('cameraChord'))$('cameraChord').textContent=chord;
  document.querySelectorAll('#cameraChordMenu div').forEach(x=>x.classList.toggle('active',x.dataset.chord===chord));
  $('shapeInfo').textContent=item?`${position+1} / ${item.count} 把位`:(chord==='N'?'此处无和弦':'暂缺此和弦指法');
  document.querySelectorAll('.chord-pad').forEach(b=>{const active=b.dataset.chord===chord;b.classList.toggle('active',active);b.setAttribute('aria-pressed',String(active));});
  document.querySelectorAll('.string').forEach((b,i)=>{b.classList.toggle('muted',!item||item.notes[i]===null);b.lastElementChild.textContent=item?(item.frets[i]<0?'×':String(item.frets[i])):'—';});
  highlightScoreChord(chord);
}
function renderPads(){
  $('chordPads').replaceChildren();
  pads.forEach((label,i)=>{const b=document.createElement('button');b.className='chord-pad';b.dataset.chord=label;const name=document.createElement('strong');name.textContent=label;const key=document.createElement('kbd');key.textContent=(keys[i]||'').toUpperCase();b.append(name,key);b.addEventListener('pointerdown',e=>{e.preventDefault();choose(label);});b.addEventListener('click',e=>{if(e.detail===0)choose(label);});$('chordPads').append(b);});
  if($('cameraChordMenu')){$('cameraChordMenu').replaceChildren();pads.slice(0,6).forEach((label,i)=>{const row=document.createElement('div');row.textContent=`${i+1} · ${label}`;row.dataset.chord=label;$('cameraChordMenu').append(row);});}
  if($('readerChordStrip')){$('readerChordStrip').replaceChildren();pads.slice(0,6).forEach((label,i)=>{const button=document.createElement('button');button.type='button';button.className='reader-chord';button.dataset.chord=label;button.textContent=`${i+1} · ${label}`;button.onclick=()=>choose(label);$('readerChordStrip').append(button);});}
  updateChord();
}
async function enable(){
  const b=$('enableAudio');b.disabled=true;
  try{await guitar.load((done,total)=>{b.textContent=`加载音源 ${done} / ${total}`;});await guitar.unlock();b.textContent='吉他已就绪';$('audioStatus').textContent='37 个木吉他实录采样 · 已就绪';}
  catch(e){b.textContent='重新加载音源';toast(e.message);}
  finally{b.disabled=false;}
}
function ring(i){const b=$('strings').children[i];b?.classList.remove('ringing');if(b){void b.offsetWidth;b.classList.add('ringing');}}
async function strum(direction){
  const s=shape();if(!s){guitar.stop();return;}
  s.notes.forEach((n,i)=>{if(n!==null)ring(i);});
  if(!guitar.ready){await enable();if(!guitar.ready)return;}
  await guitar.unlock();guitar.strum(s.notes,direction,Number($('velocity').value));
}
function renderTimeline(target,segments,onClick){
  target.replaceChildren();
  segments.forEach((x,i)=>{const b=document.createElement('button');b.textContent=transpose(x.chord,shift);const t=document.createElement('span');t.textContent=`${x.start_time.toFixed(1)}–${x.end_time.toFixed(1)}s`;b.append(t);b.dataset.index=i;b.onclick=()=>onClick(x,i);target.append(b);});
}
function scoreChordButton(label){
  const button=document.createElement('button');button.type='button';button.className='score-chord';button.textContent=label;button.dataset.chord=label;button.title='切换到这个和弦';button.onclick=()=>choose(label);return button;
}
function isChordProChord(label){return Boolean(voicing(database,canonical(label)));}
function transposeChordProText(text,semitones){return String(text||'').replace(/\[([^\]]+)\]/g,(marker,label)=>isChordProChord(label)?`[${transpose(canonical(label),semitones)}]`:marker);}
function renderChordProLine(target,line){
  const pattern=/\[([^\]]+)\]/g,matches=[...line.matchAll(pattern)].filter(m=>isChordProChord(m[1]));
  const row=document.createElement('div');row.className='score-line';
  if(!matches.length){const text=document.createElement('div');text.className='score-plain';text.textContent=line;row.append(text);target.append(row);return;}
  let cursor=0,active=null;
  const add=(label,textValue)=>{if(!label&&!textValue)return;const unit=document.createElement('span');unit.className='score-unit';if(label)unit.append(scoreChordButton(transpose(canonical(label),shift)));const lyric=document.createElement('span');lyric.className='score-lyric';lyric.textContent=textValue;unit.append(lyric);row.append(unit);};
  for(const marker of matches){add(active,line.slice(cursor,marker.index));active=canonical(marker[1]);cursor=marker.index+marker[0].length;}
  add(active,line.slice(cursor));target.append(row);
}
function renderPlainLyricsWithChords(target,lines,chords){
  const total=Math.max(1,chords.at(-1)?.end_time||1),groups=lines.map(()=>[]);
  for(const event of chords){const progress=Math.max(0,Math.min(.999,(event.start_time+event.end_time)/2/total));groups[Math.min(lines.length-1,Math.floor(progress*lines.length))].push(transpose(event.chord,shift));}
  lines.forEach((line,index)=>{const row=document.createElement('div');row.className='score-line approximate';const lane=document.createElement('div');lane.className='score-chord-lane';for(const label of groups[index])lane.append(scoreChordButton(label));const lyric=document.createElement('div');lyric.className='score-plain';lyric.textContent=line||'\u00a0';row.append(lane,lyric);target.append(row);});
}
function renderScoreInto(target,song,hasInlineChords){
  target.replaceChildren();const content=String(song.lyrics||'').replace(/\r/g,'');
  if(!content.trim()){
    const notice=document.createElement('p');notice.className='sheet-empty';notice.textContent='本曲暂无歌词。下面先显示和弦谱；点“补充歌词”粘贴你提供的歌词，并用 [C]、[Am] 标出和弦位置，即可生成完整弹唱谱。';target.append(notice);
    const events=song.chords||[];if(events.length){const row=document.createElement('div');row.className='score-line chord-only-line';for(const event of events){const unit=document.createElement('div');unit.className='score-unit';unit.append(scoreChordButton(transpose(event.chord,shift)));const time=document.createElement('small');time.className='score-time';time.textContent=`${event.start_time.toFixed(0)}s`;unit.append(time);row.append(unit);}target.append(row);}else{const empty=document.createElement('p');empty.className='sheet-empty';empty.textContent='这首曲目还没有和弦数据。';target.append(empty);}highlightScoreChord(chord);return;
  }
  const sectionNames={start_of_verse:'主歌',start_of_chorus:'副歌',start_of_bridge:'桥段',start_of_tab:'间奏',start_of_instrumental:'间奏',start_of_solo:'Solo',end_of_verse:'',end_of_chorus:'',end_of_bridge:'',end_of_tab:'',end_of_instrumental:'',end_of_solo:''};
  const lines=[];
  for(const raw of content.split('\n')){
    const line=raw.trimEnd();const directive=/^\{\s*([a-z_]+)(?::\s*([^}]*))?\s*\}$/i.exec(line.trim());
    if(directive){const key=directive[1].toLowerCase();if(sectionNames[key])lines.push({section:sectionNames[key]});else if(key==='comment'&&directive[2])lines.push({section:directive[2]});continue;}
    if(/^\{\s*(?:title|subtitle|artist|tempo|key|capo|time|comment)\s*:/i.test(line.trim()))continue;
    lines.push({text:line});
  }
  if(!lines.some(item=>item.section||item.text?.trim())){const empty=document.createElement('p');empty.className='sheet-empty';empty.textContent='没有找到可显示的歌词行。';target.append(empty);return;}
  if(hasInlineChords){
    for(const item of lines){if(item.section){const heading=document.createElement('h4');heading.className='score-section';heading.textContent=item.section;target.append(heading);}else renderChordProLine(target,item.text);}
  }else renderPlainLyricsWithChords(target,lines.filter(x=>'text'in x).map(x=>x.text),song.chords||[]);
  highlightScoreChord(chord);
}
function renderScore(song){
  if(!song)return;const lyrics=String(song.lyrics||'');const hasInlineChords=[...lyrics.matchAll(/\[([^\]]+)\]/g)].some(m=>isChordProChord(m[1]));
  const hint= !lyrics.trim()?'曲库来源没有附带歌词。可在“编辑和弦与歌词”中粘贴歌词，或导入 ChordPro。':hasInlineChords?'已按 ChordPro 标记将和弦放在对应唱词上方；点击和弦可切换左侧指法。':'当前是纯歌词：和弦按时间轴顺序均分到歌词行上方，位置只是草稿。需要精确对齐时，可在歌词前插入 [C]、[Am] 这样的 ChordPro 标记。';
  $('scoreHint').textContent=hint;$('readerHint').textContent=hint;$('readerTitle').textContent=song.title+' · 弹唱谱';
  renderScoreInto($('lyrics'),song,hasInlineChords);renderScoreInto($('readerScore'),song,hasInlineChords);
}
function highlightScoreChord(label){document.querySelectorAll('.score-chord,.reader-chord').forEach(button=>button.classList.toggle('active',canonical(button.dataset.chord)===canonical(label)));}
function songChordPads(song){
  const usage=new Map();
  for(const event of song.chords||[]){const label=transpose(event.chord,shift);if(label==='N'||!voicing(database,label))continue;const item=usage.get(label)||{label,duration:0,count:0,first:event.start_time};item.duration+=Math.max(.1,event.end_time-event.start_time);item.count++;usage.set(label,item);}
  return [...usage.values()].sort((a,b)=>b.duration-a.duration||b.count-a.count||a.first-b.first).slice(0,8).map(x=>x.label);
}
function loadSong(song){
  currentSong=structuredClone(song);shift=0;$('transpose').value='0';$('songTitle').textContent=song.title;
  $('chordPanelTitle').textContent=`${song.title} · 常用和弦`;
  $('lyrics').closest('.sheet-panel').hidden=false;document.querySelector('.instrument-layout').classList.add('has-song-sheet');
  $('songMeta').replaceChildren();
  const details=document.createElement('span');details.textContent=`${song.bpm||'—'} BPM · ${song.chords.length} 段和弦 · ${song.reviewed?'已人工确认':'自动整理草稿，待核对'}`;$('songMeta').append(details);
  if(song.source){const source=document.createElement('span');source.className='song-source';const url=song.source.match(/https:\/\/chord4\.com\/tabs\/\d+\/?/)?.[0];source.append(document.createTextNode(' · 来源：'+song.source.split(' · ').slice(0,2).join(' · ')));if(url){const link=document.createElement('a');link.href=url;link.target='_blank';link.rel='noopener noreferrer';link.textContent='查看原谱';source.append(document.createTextNode(' · '),link);}$('songMeta').append(source);}
  for(const evidence of song.chart_evidence||[]){const source=document.createElement('span');source.className='song-source';const link=document.createElement('a');link.href=evidence.chart_url;link.target='_blank';link.rel='noopener noreferrer';link.textContent=`榜单来源：${evidence.name}（${evidence.retrieved_at}）`;source.append(link);const score=document.createElement('a');score.href=evidence.score_url;score.target='_blank';score.rel='noopener noreferrer';score.textContent='原谱页';source.append(document.createTextNode(' · '),score);$('songMeta').append(source);}
  $('songTools').hidden=false;
  const player=$('referenceAudio');player.pause();player.hidden=!song.media_id;if(song.media_id)player.src='/api/media/'+encodeURIComponent(song.media_id);else player.removeAttribute('src');
  updateSongTimeline();
  const usable=songChordPads(song);pads=usable;renderPads();
  if(usable.length)choose(pads[0]);else{chord='N';position=0;updateChord();toast('这首曲谱没有可用的和弦指法');}
  tab('play');
}
function updateSongTimeline(){
  if(!currentSong)return;
  renderTimeline($('timeline'),currentSong.chords,(x,i)=>{choose(transpose(x.chord,shift));if(currentSong.media_id)$('referenceAudio').currentTime=x.start_time;document.querySelectorAll('#timeline button').forEach(b=>b.classList.toggle('active',Number(b.dataset.index)===i));});renderScore(currentSong);
}
async function loadSongs(){
  try{const songs=await api('/songs?q='+encodeURIComponent($('search').value));$('songList').replaceChildren();
    for(const song of songs){const card=document.createElement('button');card.className='song-card';const title=document.createElement('h2');title.textContent=song.title;const chords=document.createElement('div');chords.className='chord-preview';chords.textContent=[...new Set(song.chords.map(x=>x.chord))].slice(0,5).join(' · ');const meta=document.createElement('small');const provenance=song.source?.startsWith('Chord4')?` · ${song.source.split(' · ').slice(0,2).join(' · ')}`:'';const ranking=(song.chart_evidence||[]).length?` · 榜单命中：${[...new Set(song.chart_evidence.map(x=>x.name))].join('、')}`:'';meta.textContent=`${song.artist||'个人曲谱'} · ${song.bpm} BPM · ${song.reviewed?'已核对':'待核对'}${provenance}${ranking}`;card.append(title,chords,meta);card.onclick=()=>loadSong(song);$('songList').append(card);}
    if(!songs.length){const p=document.createElement('p');p.className='muted';p.textContent='没有找到这首歌，可以导入曲谱或上传歌曲分析。';$('songList').append(p);}
  }catch(e){toast(e.message);}
}
let sourceOffset=0,sourceQuery='',sourceTotal=0;
async function loadSourceCharts(reset=true){
  if(reset){sourceOffset=0;$('sourceList').replaceChildren();}
  sourceQuery=$('sourceSearch').value.trim();
  try{const data=await api(`/source-charts?q=${encodeURIComponent(sourceQuery)}&offset=${sourceOffset}&limit=60`);sourceTotal=data.total;$('sourceCount').textContent=`找到 ${data.total.toLocaleString()} 份原谱`;for(const item of data.items){const card=document.createElement('button');card.className='song-card source-card';const title=document.createElement('h2');title.textContent=item.title;const meta=document.createElement('small');meta.textContent=`${item.category} · ${item.pages} 页 · 虫虫吉他公开预览图`;card.append(title,meta);card.onclick=()=>openSourceChart(item);$('sourceList').append(card);}sourceOffset+=data.items.length;$('sourceMore').hidden=sourceOffset>=sourceTotal;if(!data.items.length&&reset){const p=document.createElement('p');p.className='muted';p.textContent='没有找到匹配的曲谱';$('sourceList').append(p);}}
  catch(e){toast(e.message);}
}
function openSourceChart(item){$('sourceReaderTitle').textContent=item.title;$('sourceReaderMeta').textContent=`${item.category} · ${item.pages} 页 · 来源：ccguitar-tabs-kb`;const pages=$('sourcePages');pages.replaceChildren();for(let n=1;n<=item.pages;n++){const figure=document.createElement('figure');const caption=document.createElement('figcaption');caption.textContent=`第 ${n} 页`;const img=document.createElement('img');img.alt=`${item.title} 第 ${n} 页曲谱`;img.loading='lazy';img.src=`/api/source-charts/${encodeURIComponent(item.id)}/pages/${n}`;img.onerror=()=>{img.alt='曲谱页加载失败，请检查本机 GitHub 仓库连接';};figure.append(img,caption);pages.append(figure);}$('sourceReader').showModal();}
function editSong(song){
  editSource=structuredClone(song||{title:'新建曲谱',artist:'',bpm:80,chords:[{start_time:0,end_time:3,chord:'C'}],lyrics:'',source:'个人编配'});
  $('editorTitle').value=editSource.title;$('editorArtist').value=editSource.artist||'';$('editorBpm').value=editSource.bpm||80;$('editorLyrics').value=editSource.lyrics||'';
  $('editorChords').value=editSource.chords.map(x=>`${x.start_time} ${x.end_time} ${x.chord}`).join('\n');$('editor').showModal();
}
async function saveSong(song){const result=await api('/songs',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(song)});toast('已保存到曲库');return result;}
function download(data,name,type='application/json'){const url=URL.createObjectURL(new Blob([data],{type}));const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
async function poll(id){
  try{const job=await api('/jobs/'+id);$('jobStage').textContent=job.stage;
    if(job.status==='completed'){analysis=job.result;$('jobDetail').textContent=`${analysis.method} · ${analysis.bpm} BPM · ${analysis.duration.toFixed(1)} 秒 · 耗时 ${job.elapsed_seconds} 秒。请试听核对后保存。`;renderTimeline($('analysisChords'),analysis.chords,x=>{choose(x.chord);tab('play');});$('analysisActions').hidden=false;$('analyzeButton').disabled=false;$('downloadNotes').hidden=job.engine!=='basic-pitch';$('downloadNotes').href='/api/notes/'+id;localStorage.removeItem('guitar-job');return;}
    if(['failed','interrupted'].includes(job.status)){throw Error(job.error||'分析未完成');}
    $('jobDetail').textContent=job.status==='queued'?'等待前一个任务完成。':'分析正在进行，可以切换到演奏页继续弹琴。';setTimeout(()=>poll(id),1500);
  }catch(e){$('jobStage').textContent='分析未完成';$('jobDetail').textContent=e.message;$('analyzeButton').disabled=false;localStorage.removeItem('guitar-job');}
}
function wire(){
  document.querySelectorAll('.tab').forEach(b=>b.onclick=()=>tab(b.dataset.tab));$('openLibrary').onclick=()=>tab('library');$('enableAudio').onclick=enable;
  $('strumDown').onclick=()=>strum('down');$('strumUp').onclick=()=>strum('up');$('mute').onclick=mute;$('nextShape').onclick=()=>{const s=shape();if(s){position=(position+1)%s.count;updateChord();}};
  $('volume').oninput=e=>guitar.setVolume(Number(e.target.value));$('space').oninput=e=>guitar.setSpace(Number(e.target.value));
  $('allChords').onchange=e=>{const value=e.target.value;if(!value)return;if(!pads.includes(value)){pads=[...pads.slice(-7),value];localStorage.setItem('guitar-pads',JSON.stringify(pads));renderPads();}choose(value);};
  $('editPads').onclick=()=>{const value=prompt('输入最多 8 个和弦，用逗号分隔',pads.join(', '));if(value===null)return;const next=value.split(/[,，\s]+/).filter(Boolean).map(canonical);if(!next.length||next.length>8||next.some(x=>!voicing(database,x))){toast('请输入 1–8 个指法库支持的和弦');return;}pads=next;localStorage.setItem('guitar-pads',JSON.stringify(pads));renderPads();};
  document.addEventListener('keydown',e=>{if(/INPUT|TEXTAREA|SELECT/.test(e.target.tagName)||$('editor').open||$('credits').open||($('sheetReader').open&&e.key==='Escape'))return;const i=keys.indexOf(e.key.toLowerCase());if(i>=0&&pads[i]){choose(pads[i]);return;}if(e.code==='Space'){e.preventDefault();if(!e.repeat)strum('down');}if(e.key==='Escape')mute();if(e.key==='ArrowDown'||e.key==='ArrowUp'){e.preventDefault();if(!e.repeat)strum(e.key==='ArrowDown'?'down':'up');}});
  const active=new Map();
  const pluckAt=(e)=>{const box=$('strings').getBoundingClientRect();const buttons=$('strings').children;const height=buttons[0].getBoundingClientRect().height;const i=Math.floor((e.clientY-box.top-13)/height);if(i<0||i>5)return;const previous=active.get(e.pointerId);if(previous===i)return;active.set(e.pointerId,i);const s=shape();if(s&&s.notes[i]!=null){guitar.pluck(i,s.notes[i],Number($('velocity').value));ring(i);}};
  $('strings').addEventListener('pointerdown',e=>{e.preventDefault();$('strings').setPointerCapture(e.pointerId);const s=shape();const box=$('strings').getBoundingClientRect();const h=$('strings').children[0]?.getBoundingClientRect().height||1;const i=Math.floor((e.clientY-box.top-13)/h);if(i>=0&&i<6&&s?.notes[i]!=null)ring(i);void(async()=>{if(!guitar.ready)await enable();if(!guitar.ready)return;await guitar.unlock();pluckAt(e);})();});
  $('strings').addEventListener('pointermove',e=>{if(active.has(e.pointerId)&&guitar.ready)pluckAt(e);});
  for(const event of ['pointerup','pointercancel','lostpointercapture'])$('strings').addEventListener(event,e=>active.delete(e.pointerId));
  $('referenceAudio').ontimeupdate=()=>{if(!currentSong)return;const t=$('referenceAudio').currentTime;let activeChord=null;document.querySelectorAll('#timeline button').forEach((b,i)=>{const x=currentSong.chords[i];const active=t>=x.start_time&&t<x.end_time;b.classList.toggle('active',active);if(active)activeChord=transpose(x.chord,shift);});if(activeChord){highlightScoreChord(activeChord);if(canonical(activeChord)!==chord)choose(activeChord);}};
  $('search').oninput=loadSongs;$('newChart').onclick=()=>editSong();$('editChart').onclick=()=>{const s=structuredClone(currentSong);s.chords=s.chords.map(x=>({...x,chord:transpose(x.chord,shift)}));s.lyrics=transposeChordProText(s.lyrics,shift);editSong(s);};$('editSheetFromPanel').onclick=()=>$('editChart').click();$('closeEditor').onclick=()=>$('editor').close();$('openSheet').onclick=()=>{if(currentSong)$('sheetReader').showModal();};$('closeSheet').onclick=()=>$('sheetReader').close();$('readerStrumDown').onclick=()=>strum('down');$('readerStrumUp').onclick=()=>strum('up');$('readerMute').onclick=mute;$('readerEdit').onclick=()=>{if(currentSong){$('sheetReader').close();$('editChart').click();}};$('recordToggle').onclick=toggleRecording;
  document.querySelectorAll('[data-library-mode]').forEach(b=>b.onclick=()=>{const source=b.dataset.libraryMode==='source';document.querySelectorAll('[data-library-mode]').forEach(x=>x.classList.toggle('active',x===b));$('songLibrary').hidden=source;$('sourceLibrary').hidden=!source;if(source)loadSourceCharts();});$('sourceSearch').oninput=()=>loadSourceCharts();$('sourceMore').onclick=()=>loadSourceCharts(false);$('closeSourceReader').onclick=()=>$('sourceReader').close();
  $('editorForm').onsubmit=async e=>{e.preventDefault();try{const chords=$('editorChords').value.trim().split('\n').map((line,i)=>{const [a,b,label,...rest]=line.trim().split(/\s+/);if(rest.length||!label||!Number.isFinite(Number(a))||!Number.isFinite(Number(b)))throw Error(`第 ${i+1} 行格式不正确`);return {start_time:Number(a),end_time:Number(b),chord:canonical(label),confidence:null};});const saved=await saveSong({...editSource,title:$('editorTitle').value,artist:$('editorArtist').value,bpm:Number($('editorBpm').value),lyrics:$('editorLyrics').value,chords,original_chords:editSource.original_chords?.length?editSource.original_chords:editSource.chords,reviewed:true});$('editor').close();loadSong(saved);}catch(error){toast(error.message);}};
  $('importChart').onchange=async e=>{const file=e.target.files[0];if(!file)return;try{const text=await file.text();const doc=file.name.endsWith('.json')?JSON.parse(text):parseChordPro(text);const saved=await saveSong(doc);loadSong(saved);}catch(error){toast(error.message);}finally{e.target.value='';}};
  for(let n=-6;n<=6;n++){if(!n)continue;const o=document.createElement('option');o.value=n;o.textContent=`${n>0?'+':''}${n} 半音`;$('transpose').append(o);}
  $('transpose').onchange=e=>{shift=Number(e.target.value);updateSongTimeline();pads=songChordPads(currentSong);renderPads();if(pads[0])choose(pads[0]);else{chord='N';position=0;updateChord();}};
  $('exportChart').onclick=()=>download(JSON.stringify({...currentSong,chords:currentSong.chords.map(x=>({...x,chord:transpose(x.chord,shift)}))},null,2),currentSong.title+'.json');
  $('exportChordPro').onclick=()=>{const chart=currentSong.chords.map(x=>`[${transpose(x.chord,shift)}]`).join(' ');const lyrics=transposeChordProText(currentSong.lyrics,shift);const inline=[...String(lyrics).matchAll(/\[([^\]]+)\]/g)].some(m=>isChordProChord(m[1]));const body=inline?lyrics:`${chart}\n\n${lyrics}`;download(`{title: ${currentSong.title}}\n{tempo: ${currentSong.bpm}}\n{comment: ${inline?'保留歌词中的和弦位置标记':'和弦时间轴未与歌词逐句对齐；请按需编辑'}}\n${body}`,currentSong.title+'.chordpro','text/plain;charset=utf-8');};
  $('analysisForm').onsubmit=async e=>{e.preventDefault();$('analyzeButton').disabled=true;$('analysisActions').hidden=true;$('analysisChords').replaceChildren();$('jobStage').textContent='上传音频';try{const job=await api('/analyze',{method:'POST',body:new FormData(e.target)});jobId=job.id;localStorage.setItem('guitar-job',jobId);poll(jobId);}catch(error){$('analyzeButton').disabled=false;toast(error.message);}};
  $('engine').onchange=()=>{$('engineDescription').textContent=engines.find(x=>x.id===$('engine').value)?.detail||'';};
  $('saveAnalysis').onclick=async()=>{try{const saved=await saveSong(analysis);loadSong(saved);}catch(e){toast(e.message);}};$('playAnalysis').onclick=()=>loadSong(analysis);
  $('creditsButton').onclick=()=>$('credits').showModal();$('closeCredits').onclick=()=>$('credits').close();
}
async function init(){
  try{database=await fetch('/assets/guitar.json').then(r=>r.json());
    setupReferenceLayout();
    for(let i=0;i<6;i++){const b=document.createElement('button');b.className='string';b.style.setProperty('--thickness',`${Math.max(.7,2.5-i*.35)}px`);b.innerHTML=`<span>${['E₂','A₂','D₃','G₃','B₃','E₄'][i]}</span><span>0</span>`;b.setAttribute('aria-label',`第 ${6-i} 弦`);b.addEventListener('click',async e=>{if(e.detail===0){if(!guitar.ready)await enable();const s=shape();if(s)guitar.pluck(i,s.notes[i],Number($('velocity').value));ring(i);}});$('strings').append(b);}
    const placeholder=document.createElement('option');placeholder.value='';placeholder.textContent='选择和弦…';$('allChords').append(placeholder);
    for(const items of Object.values(database.chords))for(const x of items){const label=x.key+(x.suffix==='major'?'':x.suffix==='minor'?'m':x.suffix);const o=document.createElement('option');o.value=label;o.textContent=label;$('allChords').append(o);}
    renderPads();wire();
    const health=await api('/health');engines=health.engines;
    engines.forEach(x=>{const o=document.createElement('option');o.value=x.id;o.textContent=x.name+(x.available?'':'（尚未就绪）');o.disabled=!x.available;$('engine').append(o);});$('engine').dispatchEvent(new Event('change'));
    const sourceNames=[['Tonejs/Tone.js','浏览器音频引擎'],['nbrosowsky/tonejs-instruments','木吉他实录采样'],['tombatossals/chords-db','和弦指法数据库'],['ptnghia-j/ChordMiniApp','时间轴合并与数据校验'],['ohollo/chord-extractor','Chordino 分析接口'],['Music-and-Culture-Technology-Lab/omnizart','和弦转录'],['spotify/basic-pitch','音符转录']];
    sourceNames.forEach(([repo,role])=>{const p=document.createElement('p'),a=document.createElement('a');a.href='https://github.com/'+repo;a.target='_blank';a.rel='noopener';a.textContent=repo;p.append(a,document.createTextNode(' · '+role));$('creditsList').append(p);});
    const activeJob=localStorage.getItem('guitar-job');if(activeJob){jobId=activeJob;poll(activeJob);}
  }catch(e){toast('初始化失败：'+e.message);}
}
init();
