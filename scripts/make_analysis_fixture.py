"""Controlled four-chord fixture rendered from the actual sampled guitar."""
from pathlib import Path
from fractions import Fraction
import numpy as np
import soundfile as sf
from scipy.signal import resample_poly

ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'evidence/fixture.wav'
NOTES={'C':0,'D':2,'E':4,'F':5,'G':7,'A':9,'B':11}
bank=[]
for path in (ROOT/'dist/assets/guitar-acoustic').glob('*.mp3'):
    name=path.stem
    pitch=12*(int(name[-1])+1)+NOTES[name[0]]+(1 if 's' in name else 0)
    wave,sr=sf.read(path)
    if wave.ndim>1:wave=wave.mean(axis=1)
    if sr!=22050:wave=resample_poly(wave,22050,sr)
    bank.append((pitch,wave))
result=np.zeros(22050*16)
chords=[[48,52,55,60,64],[45,52,57,60,64],[41,48,53,57,60,65],[43,47,50,55,59,67]]
for i,notes in enumerate(chords):
    for beat in [0,1.5]:
        for j,pitch in enumerate(notes):
            source=min(bank,key=lambda x:abs(x[0]-pitch))
            ratio=Fraction(2**((source[0]-pitch)/12)).limit_denominator(1000)
            wave=resample_poly(source[1],ratio.numerator,ratio.denominator)[:int(22050*1.45)]
            wave[-700:]*=np.linspace(1,0,min(700,len(wave)))
            start=int((i*3+beat+j*.018)*22050)
            result[start:start+len(wave)]+=wave*.17
result=result/(max(1,np.max(np.abs(result))))*.85
sf.write(OUT,result,22050)
print(OUT)
