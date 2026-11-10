"""Fetch pinned public assets and retain licenses and content hashes."""
from pathlib import Path
import ast
import concurrent.futures
import hashlib
import json
import shutil
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
PINS = {x['repo']: x['commit'] for x in json.loads((ROOT/'source-pins.json').read_text())['sources']}
ASSETS = ROOT/'dist/assets'
VENDOR = ROOT/'vendor'

def get(url):
    return urllib.request.urlopen(urllib.request.Request(url, headers={'User-Agent':'GuitarWorkbench/0.1'}), timeout=45).read()

def raw(repo, path):
    return get(f'https://raw.githubusercontent.com/{repo}/{PINS[repo]}/{path}')

def main():
    (ASSETS/'guitar-acoustic').mkdir(parents=True, exist_ok=True)
    VENDOR.mkdir(exist_ok=True)
    repo = 'nbrosowsky/tonejs-instruments'
    files = json.loads((ROOT/'scripts/samples-source.json').read_text())
    def sample(item):
        target = ASSETS/'guitar-acoustic'/item['name']
        if not target.exists():
            target.write_bytes(raw(repo, item['path']))
        return {'file':item['name'], 'bytes':target.stat().st_size, 'sha256':hashlib.sha256(target.read_bytes()).hexdigest()}
    with concurrent.futures.ThreadPoolExecutor(max_workers=5) as pool:
        samples = list(pool.map(sample, files))
    (ASSETS/'samples.json').write_text(json.dumps(samples, indent=2))
    (ASSETS/'guitar.json').write_bytes(raw('tombatossals/chords-db', 'lib/guitar.json'))
    shutil.copyfile(ROOT/'node_modules/tone/build/Tone.js', ASSETS/'Tone.js')
    licenses = []
    for name in PINS:
        folder = VENDOR/name.replace('/','--')
        folder.mkdir(exist_ok=True)
        for path in ['LICENSE','LICENSE.md','LICENSE.txt','COPYING']:
            try:
                data = raw(name,path)
            except urllib.error.HTTPError as exc:
                if exc.code == 404:
                    continue
                raise
            (folder/path).write_bytes(data)
            licenses.append({'repo':name,'commit':PINS[name],'path':path})
            break
    (VENDOR/'nbrosowsky--tonejs-instruments'/'README.md').write_bytes(raw(repo,'README.md'))
    (VENDOR/'nbrosowsky--tonejs-instruments'/'sample-source-info.txt').write_bytes(raw(repo,'sample-source-info.txt'))
    # Reuse upstream timeline utilities, not its optional placeholder confidence values.
    mini = 'ptnghia-j/ChordMiniApp'
    source = raw(mini,'python_backend/services/audio/chord_utils.py').decode()
    (VENDOR/'ptnghia-j--ChordMiniApp'/'chord_utils.original.py').write_text(source)
    tree = ast.parse(source)
    selected = {'merge_consecutive_chords','validate_chord_data','calculate_chord_statistics'}
    lines = source.splitlines()
    extracted = ['# Adapted from ChordMiniApp (MIT); source revision in source-pins.json.',
                 'from typing import List, Dict, Any, Tuple', '']
    for node in tree.body:
        if isinstance(node,ast.FunctionDef) and node.name in selected:
            extracted.extend(lines[node.lineno-1:node.end_lineno]+[''])
    (ROOT/'backend'/'chordmini_timeline.py').write_text('\n'.join(extracted))
    mediapipe = ASSETS/'mediapipe'
    mediapipe.mkdir(exist_ok=True)
    sdk = ROOT/'node_modules/@mediapipe/tasks-vision'
    shutil.copyfile(sdk/'vision_bundle.mjs',mediapipe/'vision_bundle.mjs')
    shutil.copyfile(sdk/'vision_bundle.cjs',mediapipe/'vision_bundle.classic.js')
    shutil.copytree(sdk/'wasm',mediapipe/'wasm',dirs_exist_ok=True)
    model = mediapipe/'hand_landmarker.task'
    if not model.exists():
        model.write_bytes(get('https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task'))
    (ROOT/'evidence'/'assets.json').write_text(json.dumps({'sample_count':len(samples),'sample_bytes':sum(x['bytes'] for x in samples),'licenses':licenses},indent=2))
    print(json.dumps({'samples':len(samples),'bytes':sum(x['bytes'] for x in samples),'licenses':len(licenses)}))

if __name__ == '__main__':
    main()
