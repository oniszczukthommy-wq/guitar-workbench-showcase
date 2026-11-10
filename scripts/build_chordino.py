"""Project-local arm64 Chordino build; no changes to system plugins."""
from pathlib import Path
import subprocess
import re
ROOT = Path(__file__).resolve().parents[1]
SDK = ROOT/'.runtime/vamp-plugin-sdk'
SRC = ROOT/'.runtime/nnls-chroma'
OUT = ROOT/'.runtime/vamp'
OUT.mkdir(exist_ok=True)

def run(args, cwd):
    subprocess.run(args, cwd=cwd, check=True)

source = SRC/'chromamethods.cpp'
if not (SRC/'chromamethods.cpp.upstream').exists():
    (SRC/'chromamethods.cpp.upstream').write_bytes(source.read_bytes())
s = (SRC/'chromamethods.cpp.upstream').read_text()
s = re.sub(r'#include <boost/[^\n]+\n', '', s)
s = s.replace('using namespace boost;', '''
// Portability adaptation: std file I/O and delimiter parsing replace Boost.
static std::vector<std::string> split_dict(const std::string& input) {
    std::vector<std::string> result;
    std::string item;
    for (char c : input) {
        if (c == ',' || c == ';' || c == ' ' || c == '=') {
            if (!item.empty()) { result.push_back(item); item.clear(); }
            if (c == '=') result.push_back("=");
        } else item += c;
    }
    if (!item.empty()) result.push_back(item);
    return result;
}
''')
s = s.replace('typedef tokenizer<char_separator<char> > Tok;', 'typedef std::vector<std::string> Tok;')
s = s.replace('char_separator<char> sep(",; ","=");', '')
s = s.replace('iostreams::stream<iostreams::file_source> chordDictFile(chordDictFilename);', 'std::ifstream chordDictFile(chordDictFilename.c_str());')
s = s.replace('Tok tok(line, sep);', 'Tok tok = split_dict(line);')
s = s.replace('lexical_cast<float>(*tok_iter)', 'std::stof(*tok_iter)')
source.write_text(s)
flags = ['-std=c++11','-O3','-fPIC','-arch','arm64','-mmacosx-version-min=11.0','-I'+str(SDK)]
objects = []
for f in ['PluginAdapter.cpp','RealTime.cpp']:
    p = SDK/'src/vamp-sdk'/f
    o = OUT/(f+'.o')
    run(['clang++',*flags,'-c',str(p),'-o',str(o)],OUT)
    objects.append(str(o))
for f in ['chromamethods.cpp','NNLSBase.cpp','NNLSChroma.cpp','Chordino.cpp','Tuning.cpp','plugins.cpp','viterbi.cpp']:
    p = SRC/f
    o = OUT/(f+'.o')
    run(['clang++',*flags,'-c',str(p),'-o',str(o)],OUT)
    objects.append(str(o))
o=OUT/'nnls.c.o'
run(['clang','-O3','-fPIC','-arch','arm64','-c',str(SRC/'nnls.c'),'-o',str(o)],OUT)
run(['clang++','-arch','arm64','-dynamiclib',*objects,str(o),'-framework','Accelerate','-o',str(OUT/'nnls-chroma.dylib')],OUT)
print(OUT/'nnls-chroma.dylib')
