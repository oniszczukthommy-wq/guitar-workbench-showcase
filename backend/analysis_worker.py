"""Isolated, real inference adapters. Output uncertainty is never fabricated."""
from pathlib import Path
import csv
import json
import os
import sys
import numpy as np

ROOT = Path(__file__).resolve().parents[1]
os.environ['VAMP_PATH'] = str(ROOT/'.runtime/vamp')
os.environ.setdefault('TF_USE_LEGACY_KERAS','1')

def canonical(label):
    label = label.strip().replace('♭','b').replace('♯','#')
    if label.lower() in ('n','none','no_chord','x','silence',''):
        return 'N'
    label = label.replace(':min','m').replace(':maj7','maj7').replace(':maj','').replace(':','')
    return label

def segments(changes, duration):
    result=[]
    for i,(start,chord) in enumerate(changes):
        end=changes[i+1][0] if i+1<len(changes) else duration
        if end>start:
            result.append({'start_time':float(start),'end_time':float(end),'chord':canonical(chord),'confidence':None})
    return result

def estimate_from_notes(notes, duration):
    # This stage is an explicit rule-based estimate, not Basic Pitch chord output.
    templates=[('',[0,4,7]),('m',[0,3,7]),('7',[0,4,7,10]),('m7',[0,3,7,10]),('maj7',[0,4,7,11])]
    names=['C','C#','D','Eb','E','F','F#','G','Ab','A','Bb','B']
    changes=[]
    for start in np.arange(0,duration,.5):
        chroma=np.zeros(12)
        for a,b,pitch,amplitude,_ in notes:
            overlap=max(0.,min(b,start+.5)-max(a,start))
            chroma[int(pitch)%12]+=overlap*amplitude
        if chroma.sum()<.03:
            chord='N'
        else:
            best=(-float('inf'),'N')
            norm=np.linalg.norm(chroma)+1e-12
            for root in range(12):
                for suffix,intervals in templates:
                    mask=np.zeros(12); mask[[(root+x)%12 for x in intervals]]=1
                    score=float(chroma@mask/(norm*np.linalg.norm(mask)))
                    if score>best[0]: best=(score,names[root]+suffix)
            chord=best[1]
        if not changes or changes[-1][1]!=chord:
            changes.append((float(start),chord))
    return segments(changes,duration)

def run(engine, audio, output):
    import librosa
    y,sr=librosa.load(audio,sr=22050)
    duration=len(y)/sr
    if duration<1 or duration>900:
        raise ValueError('歌曲长度须为 1 秒至 15 分钟')
    tempo,beats=librosa.beat.beat_track(y=y,sr=sr,units='time')
    bpm=float(np.asarray(tempo).reshape(-1)[0])
    notes=[]
    if engine=='chordino':
        from chord_extractor.extractors import Chordino
        detected=Chordino().extract(str(audio))
        chords=segments([(x.timestamp,x.chord) for x in detected],duration)
        method='Chordino 和弦识别'
    elif engine=='basic-pitch':
        from basic_pitch.inference import predict
        import basic_pitch
        model=Path(basic_pitch.__file__).parent/'saved_models/icassp_2022/nmp.onnx'
        _,midi,detected=predict(str(audio),model_or_model_path=str(model))
        midi.write(str(output/'notes.mid'))
        notes=[(float(a),float(b),int(p),float(amp),None) for a,b,p,amp,*_ in detected]
        chords=estimate_from_notes(notes,duration)
        method='Basic Pitch 音符转录 → 规则和弦估计（适合单乐器音频）'
    elif engine=='omnizart':
        sys.path.insert(0,str(ROOT/'.runtime/omnizart'))
        import omnizart
        # Upstream __init__ resets VAMP_PATH; use our project-local arm64 build.
        os.environ['VAMP_PATH']=str(ROOT/'.runtime/vamp')
        from omnizart.chord import app
        app.transcribe(str(audio),output=str(output/'chords.mid'))
        files=list(output.glob('*.csv'))
        if not files: raise RuntimeError('Omnizart 没有输出 CSV')
        chords=[]
        with files[0].open() as f:
            for row in csv.DictReader(f):
                try:
                    chords.append({'start_time':float(row['start']),'end_time':float(row['end']),'chord':canonical(row['chord']),'confidence':None})
                except (ValueError,KeyError):
                    continue
        method='Omnizart 和弦转录'
    else:
        raise ValueError('未知分析引擎')
    from backend.chordmini_timeline import merge_consecutive_chords,validate_chord_data,calculate_chord_statistics
    chords=merge_consecutive_chords(chords)
    valid,errors=validate_chord_data(chords)
    if not valid: raise RuntimeError('; '.join(errors))
    result={'engine':engine,'method':method,'duration':duration,'bpm':round(bpm,2),'beats':[round(float(x),4) for x in beats],
            'chords':chords,'notes':[{'start':x[0],'end':x[1],'midi':x[2],'amplitude':x[3]} for x in notes],
            'statistics':calculate_chord_statistics(chords),'reviewed':False,'lyrics':''}
    (output/'result.json').write_text(json.dumps(result,ensure_ascii=False,indent=2))

if __name__=='__main__':
    run(sys.argv[1],Path(sys.argv[2]),Path(sys.argv[3]))
