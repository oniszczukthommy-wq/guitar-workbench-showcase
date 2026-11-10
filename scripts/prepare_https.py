"""Create project-local development TLS certificates without changing OS trust."""
from pathlib import Path
import json
import os
import subprocess

ROOT=Path(__file__).resolve().parents[1]
TLS=ROOT/'data/tls'
TLS.mkdir(parents=True,exist_ok=True)
try:
    ip=subprocess.check_output(['/usr/sbin/ipconfig','getifaddr','en0'],text=True).strip()
except subprocess.CalledProcessError:
    ip='127.0.0.1'

def run(args):
    subprocess.run(['/usr/bin/openssl',*args],cwd=TLS,check=True,stdout=subprocess.DEVNULL,stderr=subprocess.PIPE)

if not (TLS/'ca.key').exists():
    run(['genrsa','-out','ca.key','2048'])
    (TLS/'ca.cnf').write_text('[req]\ndistinguished_name=dn\nx509_extensions=ca\nprompt=no\n[dn]\nCN=Guitar Workbench Local CA\n[ca]\nbasicConstraints=critical,CA:TRUE\nkeyUsage=critical,keyCertSign,cRLSign\nsubjectKeyIdentifier=hash\n')
    run(['req','-x509','-new','-key','ca.key','-days','365','-sha256','-config','ca.cnf','-out','ca.crt'])
config=f'[req]\ndistinguished_name=dn\nprompt=no\n[dn]\nCN=localhost\n[server]\nbasicConstraints=CA:FALSE\nkeyUsage=digitalSignature,keyEncipherment\nextendedKeyUsage=serverAuth\nsubjectAltName=DNS:localhost,IP:127.0.0.1,IP:{ip}\n'
(TLS/'server.cnf').write_text(config)
run(['genrsa','-out','server.key','2048'])
run(['req','-new','-key','server.key','-config','server.cnf','-out','server.csr'])
run(['x509','-req','-in','server.csr','-CA','ca.crt','-CAkey','ca.key','-CAcreateserial','-out','server.crt','-days','90','-sha256','-extensions','server','-extfile','server.cnf'])
for p in TLS.glob('*.key'):os.chmod(p,0o600)
(TLS/'addresses.json').write_text(json.dumps({'ip':ip,'https':f'https://{ip}:8611/','certificate':f'http://{ip}:8610/api/local-certificate'},indent=2))
print(f'HTTPS: https://{ip}:8611/\n手机证书: http://{ip}:8610/api/local-certificate')
