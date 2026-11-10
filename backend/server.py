from pathlib import Path
from concurrent.futures import ThreadPoolExecutor
from contextlib import asynccontextmanager
from typing import Any
import importlib.util
import hashlib
import json
import os
import re
import sqlite3
import subprocess
import sys
import time
import uuid

from fastapi import FastAPI, HTTPException, UploadFile, File, Form
from fastapi.responses import FileResponse, Response
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

ROOT=Path(__file__).resolve().parents[1]
DATA=ROOT/'data'
DATA.mkdir(exist_ok=True)
JOBS=DATA/'jobs'
JOBS.mkdir(exist_ok=True)
POOL=ThreadPoolExecutor(max_workers=1)

def db():
    con=sqlite3.connect(DATA/'library.sqlite3')
    con.row_factory=sqlite3.Row
    return con

def initialize():
    with db() as con:
        con.execute('CREATE TABLE IF NOT EXISTS songs (id TEXT PRIMARY KEY, title TEXT NOT NULL, document TEXT NOT NULL, updated REAL NOT NULL)')
        con.execute('CREATE TABLE IF NOT EXISTS jobs (id TEXT PRIMARY KEY, status TEXT NOT NULL, document TEXT NOT NULL)')
        if con.execute('SELECT COUNT(*) FROM songs').fetchone()[0]==0:
            for title,labels in [('小星星 · 公版旋律伴奏练习',['C','C','F','C','F','C','G7','C']),('和弦转换 · C 调练习',['C','Am','Dm','G7']),('分解和弦 · G 调练习',['G','Em','C','D'])]:
                song={'id':str(uuid.uuid4()),'title':title,'artist':'练习曲','bpm':80,'lyrics':'','source':'本项目练习编配；不含商业歌曲歌词或原版谱','reviewed':True,
                      'chords':[{'start_time':i*3.,'end_time':(i+1)*3.,'chord':chord,'confidence':None} for i,chord in enumerate(labels)],'original_chords':[]}
                con.execute('INSERT INTO songs VALUES (?,?,?,?)',(song['id'],title,json.dumps(song,ensure_ascii=False),time.time()))

initialize()
app=FastAPI(title='Guitar Workbench')

# This user-provided repository is kept in ignored local data and read lazily.
SOURCE_REPO=DATA/'ccguitar-tabs-kb-source'
SOURCE_COMMIT='793e55ecf3a3d14c8f1ff2d1e2aff31258fa430e'
_source_charts=None

def source_charts():
    global _source_charts
    if _source_charts is None:
        try:
            raw=subprocess.run(['git','-C',str(SOURCE_REPO),'show',f'{SOURCE_COMMIT}:INDEX.md'],capture_output=True,check=True,timeout=30).stdout.decode('utf-8')
        except (subprocess.SubprocessError, OSError) as exc:
            raise HTTPException(503,'曲谱索引读取失败。请确认本机已连接 ccguitar-tabs-kb 仓库。') from exc
        items=[]
        for line in raw.splitlines():
            match=re.match(r'^\|\s*\d+\s*\|\s*(.*?)\s*\|\s*(\d+)\s*\|\s*\[([^\]]+)\]\((.+)\)\s*\|$',line)
            if not match: continue
            title,pages,label,path=match.groups()
            if not re.fullmatch(r'(?:[A-Z]|中文)/[^/]+__\d+',path): continue
            items.append({'id':path.rsplit('__',1)[-1],'title':title,'pages':int(pages),'path':path,'category':label.split('-')[1] if '-' in label else '吉他谱'})
        _source_charts=items
    return _source_charts

@app.get('/api/source-charts')
def list_source_charts(q:str='',offset:int=0,limit:int=60):
    items=source_charts(); query=q.strip().casefold()
    matches=[x for x in items if not query or query in x['title'].casefold()]
    start=max(0,offset); size=max(1,min(limit,100))
    return {'total':len(matches),'items':matches[start:start+size]}

@app.get('/api/source-charts/{chart_id}/pages/{page}')
def source_chart_page(chart_id:str,page:int):
    item=next((x for x in source_charts() if x['id']==chart_id),None)
    if not item: raise HTTPException(404,'没有找到这份原谱')
    if page<1 or page>item['pages']: raise HTTPException(404,'页码超出范围')
    rel=f"{item['path']}/p{page}.png"
    try:
        result=subprocess.run(['git','-C',str(SOURCE_REPO),'show',f'{SOURCE_COMMIT}:{rel}'],capture_output=True,check=True,timeout=90)
    except (subprocess.SubprocessError,OSError) as exc:
        raise HTTPException(503,'原谱页加载失败。请检查 GitHub 连接和仓库读取权限后重试。') from exc
    return Response(result.stdout,media_type='image/png',headers={'Cache-Control':'private, max-age=3600'})

def set_job(job):
    with db() as con:
        con.execute('INSERT OR REPLACE INTO jobs VALUES (?,?,?)',(job['id'],job['status'],json.dumps(job,ensure_ascii=False)))

def get_job(job_id):
    with db() as con: row=con.execute('SELECT document FROM jobs WHERE id=?',(job_id,)).fetchone()
    if not row: raise HTTPException(404,'任务不存在')
    return json.loads(row['document'])

# An interrupted inference is explicit after a server restart.
with db() as con:
    for row in con.execute("SELECT document FROM jobs WHERE status IN ('queued','running')").fetchall():
        job=json.loads(row['document'])
        owner=job.get('owner_pid')
        if owner and os.name != 'nt':
            try:
                os.kill(owner,0)
                continue
            except ProcessLookupError:
                pass
        job.update(status='interrupted',error='服务重启，分析被中断；可以重新提交')
        con.execute('UPDATE jobs SET status=?,document=? WHERE id=?',(job['status'],json.dumps(job,ensure_ascii=False),job['id']))

def engine_status():
    suffix = '.dll' if os.name == 'nt' else ('.dylib' if sys.platform == 'darwin' else '.so')
    plugin=(ROOT/('.runtime/vamp/nnls-chroma'+suffix)).exists() and importlib.util.find_spec('chord_extractor') is not None
    omni=(ROOT/'.runtime/omnizart/omnizart/checkpoints/chord/chord_v1/variables/variables.data-00000-of-00001').exists()
    evidence=ROOT/'evidence/analysis-smoke.json'
    # Bundled acceptance evidence was recorded on macOS, not this Windows/Linux machine.
    verified=json.loads(evidence.read_text()) if evidence.exists() and sys.platform == 'darwin' else {}
    return [
        {'id':'chordino','name':'Chordino','available':plugin,'validated':verified.get('chordino',{}).get('passed',False),'detail':'歌曲和弦识别；适合先分析完整歌曲'},
        {'id':'omnizart','name':'Omnizart','available':omni and plugin and (ROOT/'.venv-omnizart'/('Scripts/python.exe' if os.name == 'nt' else 'bin/python')).exists(),'validated':verified.get('omnizart',{}).get('passed',False),'detail':'神经网络和弦转录；可与 Chordino 对比'},
        {'id':'basic-pitch','name':'Basic Pitch','available':importlib.util.find_spec('basic_pitch') is not None and importlib.util.find_spec('onnxruntime') is not None,'validated':verified.get('basic-pitch',{}).get('passed',False),'detail':'音频转音符，再估计和弦；更适合单乐器录音'}]

@app.get('/api/health')
def health():
    with db() as con: song_count=con.execute('SELECT COUNT(*) FROM songs').fetchone()[0]
    return {'status':'ok','app':'guitar-workbench','engines':engine_status(),'sample_count':37,'song_count':song_count,'chord_database':'chords-db','timeline_utilities':'ChordMiniApp'}

@app.get('/api/songs')
def songs(q:str=''):
    with db() as con: rows=con.execute('SELECT document FROM songs ORDER BY updated DESC').fetchall()
    result=[json.loads(r['document']) for r in rows]
    return [s for s in result if q.lower() in (s['title']+' '+s.get('artist','')).lower()]

class Chord(BaseModel):
    start_time:float=Field(ge=0)
    end_time:float=Field(gt=0)
    chord:str=Field(min_length=1,max_length=32)
    confidence:float|None=Field(default=None,ge=0,le=1)

class Song(BaseModel):
    title:str=Field(min_length=1,max_length=200)
    artist:str=Field(default='',max_length=200)
    bpm:float=Field(default=80,ge=20,le=300)
    lyrics:str=Field(default='',max_length=100000)
    chords:list[Chord]=Field(min_length=1,max_length=20000)
    original_chords:list[Chord]=Field(default_factory=list,max_length=20000)
    source:str=Field(default='个人导入',max_length=1000)
    reviewed:bool=False
    media_id:str|None=None
    engine:str|None=None

@app.post('/api/songs')
def save_song(song:Song):
    from backend.chordmini_timeline import validate_chord_data
    doc=song.model_dump()
    valid,errors=validate_chord_data(doc['chords'])
    if not valid: raise HTTPException(422,'; '.join(errors))
    if doc['media_id'] and not re.fullmatch(r'[a-f0-9-]{36}',doc['media_id']):
        raise HTTPException(422,'音频标识无效')
    doc['id']=str(uuid.uuid4())
    with db() as con: con.execute('INSERT INTO songs VALUES (?,?,?,?)',(doc['id'],doc['title'],json.dumps(doc,ensure_ascii=False),time.time()))
    return doc

@app.get('/api/jobs/{job_id}')
def job_status(job_id:str):
    return get_job(job_id)

def process_job(job_id, input_file, engine):
    job=get_job(job_id)
    job.update(status='running',stage='解码音频')
    set_job(job)
    work=input_file.parent
    try:
        import imageio_ffmpeg
        ffmpeg=imageio_ffmpeg.get_ffmpeg_exe()
        normalized=work/'audio.wav'
        subprocess.run([ffmpeg,'-nostdin','-v','error','-y','-i',str(input_file),'-t','901','-ac','1','-ar','22050',str(normalized)],check=True,timeout=120,capture_output=True)
        job.update(stage='识别节拍与和弦' if engine!='basic-pitch' else '转录音符与估计和弦')
        set_job(job)
        interpreter=(ROOT/'.venv-omnizart'/('Scripts/python.exe' if os.name == 'nt' else 'bin/python')) if engine=='omnizart' else Path(sys.executable)
        env=os.environ.copy()
        env['PYTHONPATH']=str(ROOT)
        env['VAMP_PATH']=str(ROOT/'.runtime/vamp')
        env['TF_USE_LEGACY_KERAS']='1'
        env['OMP_NUM_THREADS']='2'
        with (work/'analysis.log').open('w') as log:
            result=subprocess.run([str(interpreter),'-m','backend.analysis_worker',engine,str(normalized),str(work)],cwd=ROOT,env=env,stdout=log,stderr=log,timeout=1200)
        if result.returncode:
            log=(work/'analysis.log').read_text(errors='replace')
            raise RuntimeError(log[-2000:])
        result=json.loads((work/'result.json').read_text())
        result.update(media_id=job_id,title=job['filename'].rsplit('.',1)[0],source='上传音频分析 · '+result['method'],original_chords=result['chords'])
        job.update(status='completed',stage='分析完成，等待人工核对',result=result,elapsed_seconds=round(time.time()-job['created'],2))
    except Exception as exc:
        job.update(status='failed',stage='分析未完成',error=str(exc)[-2000:])
    set_job(job)

@app.post('/api/analyze')
async def analyze(file:UploadFile=File(...),engine:str=Form('chordino')):
    engines={x['id']:x for x in engine_status()}
    if engine not in engines or not engines[engine]['available']:
        raise HTTPException(422,'该分析引擎尚未就绪')
    suffix=Path(file.filename or '').suffix.lower()
    if suffix not in ('.mp3','.wav','.flac','.ogg','.m4a','.mp4','.webm'):
        raise HTTPException(422,'请选择 MP3、WAV、FLAC、M4A、OGG、MP4 或 WebM')
    job_id=str(uuid.uuid4());folder=JOBS/job_id;folder.mkdir()
    path=folder/('source'+suffix)
    size=0;digest=hashlib.sha256()
    with path.open('wb') as out:
        while chunk:=await file.read(1024*1024):
            size+=len(chunk)
            if size>100*1024*1024:
                out.close();path.unlink(missing_ok=True)
                raise HTTPException(413,'文件超过 100 MB')
            digest.update(chunk);out.write(chunk)
    if not size: raise HTTPException(422,'音频文件为空')
    job={'id':job_id,'status':'queued','stage':'等待分析','engine':engine,'filename':Path(file.filename or '歌曲').name,'created':time.time(),'sha256':digest.hexdigest(),'owner_pid':os.getpid()}
    set_job(job)
    POOL.submit(process_job,job_id,path,engine)
    return job

@app.get('/api/media/{media_id}')
def media(media_id:str):
    if not re.fullmatch(r'[a-f0-9-]{36}',media_id): raise HTTPException(404)
    path=JOBS/media_id/'audio.wav'
    if not path.exists(): raise HTTPException(404)
    return FileResponse(path,media_type='audio/wav')

@app.get('/api/notes/{job_id}')
def notes(job_id:str):
    if not re.fullmatch(r'[a-f0-9-]{36}',job_id): raise HTTPException(404)
    path=JOBS/job_id/'notes.mid'
    if not path.exists(): raise HTTPException(404)
    return FileResponse(path,media_type='audio/midi',filename='notes.mid')

@app.get('/api/local-certificate')
def local_certificate():
    path=DATA/'tls/ca.crt'
    if not path.exists():raise HTTPException(404,'请先运行 scripts/prepare_https.py')
    return FileResponse(path,media_type='application/x-x509-ca-cert',filename='GuitarWorkbench-Local-CA.crt')

app.mount('/',StaticFiles(directory=ROOT/'dist',html=True),name='app')
