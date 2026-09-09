import json
from pathlib import Path

def rows(name):
 s=json.loads(json.loads(Path('docs/artifacts/phase17-live-'+name+'.json').read_text())['content'][0]['text'])['result']
 return json.loads(s.split('>\n')[1].split('\n</')[0])
ddl=rows('ddl'); guards=rows('guards');helpers=rows('helpers')
s='-- Catalog schema/types and reachable trigger functions read from production metadata 2026-09-08. No customer rows.\n'
for r in ddl:s+='create table '+r['schema']+'.'+r['name']+' (\n'+r['columns']+'\n);\n'
known={r['name'] for r in ddl};known.update(['companies','users'])
for r in sorted(guards,key=lambda r: 0 if 'PRIMARY KEY' in r['definition'] else 1):
 if r['kind']=='constraint':
  # Keep catalog checks, PKs and all catalog/auth FKs. Unrelated historical FKs remain on the actual application tables in production.
  if 'FOREIGN KEY' in r['definition'] and not any('REFERENCES '+t+'(' in r['definition'] for t in known):continue
  s+='alter table public.'+r['relation']+' add constraint '+r['name']+' '+r['definition']+';\n'
s+='alter table private.agent_read_domains add primary key(domain);\n'
s+='alter table private.agent_read_domain_revisions add primary key(company_id,domain);\n'
seen=set()
for r in helpers:s+=r['definition']+';\n'
for r in guards:
 if r['kind']=='trigger':
  trig,fn=r['definition'].split('\n',1)
  if fn not in seen:s+=fn+';\n';seen.add(fn)
  s+=trig+';\n'
Path('tests/sql/catalog-authoring-live-schema.sql').write_text('\n'.join(line.rstrip() for line in s.splitlines()).rstrip()+'\n')
