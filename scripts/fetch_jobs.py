"""Fetch finance jobs across Europe from the Adzuna API (free keys) and keep the last 30 days.
Needs repository secrets ADZUNA_APP_ID and ADZUNA_APP_KEY. Output: data/jobs/<cc>.json + data/jobs/index.json."""
import json, os, re, sys, time, urllib.parse, urllib.request
from datetime import datetime, timedelta, timezone
APP_ID, APP_KEY = os.environ.get('ADZUNA_APP_ID', '').strip(), os.environ.get('ADZUNA_APP_KEY', '').strip()
os.makedirs('data/jobs', exist_ok=True)
NOW = datetime.now(timezone.utc)
STATUS = {'updated_at': NOW.strftime('%Y-%m-%dT%H:%M:%SZ'), 'countries': [], 'calls': 0, 'errors': []}
if not APP_ID or not APP_KEY:
    STATUS['note'] = 'Adzuna keys not set yet'
    old = {}
    try: old = json.load(open('data/jobs/index.json'))
    except Exception: pass
    if not old.get('countries'):
        json.dump(STATUS, open('data/jobs/index.json', 'w'), indent=0)
    print('No Adzuna keys; skipping'); sys.exit(0)

COUNTRIES = {'gb': 'United Kingdom', 'de': 'Germany', 'fr': 'France', 'it': 'Italy', 'es': 'Spain', 'nl': 'Netherlands',
             'be': 'Belgium', 'at': 'Austria', 'ch': 'Switzerland', 'pl': 'Poland'}
EN = ['financial analyst', 'risk analyst', 'FP&A', 'investment analyst', 'portfolio analyst', 'equity research',
      'credit analyst', 'financial controller', 'finance graduate', 'finance intern']
LOCAL = {'it': ['analista finanziario', 'controller', 'stage finanza', 'risk management'],
         'de': ['Finanzanalyst', 'Controller', 'Praktikum Finance', 'Risikomanagement'],
         'fr': ['analyste financier', 'contrôleur de gestion', 'stage finance', 'analyste risques'],
         'es': ['analista financiero', 'controller financiero', 'prácticas finanzas', 'analista de riesgos'],
         'nl': ['financieel analist', 'controller', 'stage finance', 'risk analist'],
         'be': ['analyste financier', 'financieel analist', 'controller'],
         'at': ['Finanzanalyst', 'Controller', 'Praktikum Finance'],
         'ch': ['Finanzanalyst', 'analyste financier', 'Controller'],
         'pl': ['analityk finansowy', 'kontroler finansowy', 'praktyki finanse']}

def call(cc, what, page=1):
    q = {'app_id': APP_ID, 'app_key': APP_KEY, 'what': what, 'results_per_page': 50, 'max_days_old': 7,
         'sort_by': 'date', 'content-type': 'application/json'}
    url = f'https://api.adzuna.com/v1/api/jobs/{cc}/search/{page}?' + urllib.parse.urlencode(q)
    STATUS['calls'] += 1
    with urllib.request.urlopen(urllib.request.Request(url, headers={'User-Agent': 'finjob.eu'}), timeout=60) as r:
        return json.loads(r.read())

def strip_html(s): return re.sub(r'\s+', ' ', re.sub(r'<[^>]+>', ' ', s or '')).strip()
GROUPS = [('Equity research', r'equity research|research analyst|sell.side|buy.side'),
          ('Risk', r'\brisk|risiko|risque|riesgo|rischio|credit analyst|kredit|compliance|aml\b|kyc'),
          ('FP&A / Controlling', r'fp&a|controll|planning|pianificazione|budget|cost analyst|contrôl'),
          ('Portfolio / Investment', r'portfolio|investment|invest|asset manag|wealth|private equity|fund|m&a|corporate finance|investor rel'),
          ('Audit / Accounting', r'audit|account|bookkeep|contab|comptab|revisor|tax\b|steuer'),
          ('Financial analysis', r'financ|finanz|analyst|analista|analyste')]
def group(t):
    t = t.lower()
    for g, rx in GROUPS:
        if re.search(rx, t): return g
    return None
def level(t):
    t = t.lower()
    if re.search(r'intern|stage|stagiaire|praktik|tirocin|prácticas|praktyk|werkstudent|trainee', t): return 'Internship'
    if re.search(r'graduate|junior|entry|neolaureat|débutant|absolvent|\bjr\b', t): return 'Junior / Graduate'
    if re.search(r'senior|head of|director|lead|manager|principal|\bvp\b|chief|\bsr\b', t): return 'Senior'
    return 'Mid'

for cc, cname in COUNTRIES.items():
    path = f'data/jobs/{cc}.json'
    try: old = json.load(open(path))
    except Exception: old = []
    seen = {j['id']: j for j in old}
    keys = {(j['title'].lower(), j['company'].lower()) for j in old}
    added = 0
    for what in EN + LOCAL.get(cc, []):
        try:
            res = call(cc, what).get('results', [])
        except Exception as e:
            STATUS['errors'].append(f'{cc}/{what}: {repr(e)[:160]}'); time.sleep(3); continue
        time.sleep(2.6)  # stay under 25 calls/minute
        for r in res:
            title = strip_html(r.get('title')); comp = strip_html((r.get('company') or {}).get('display_name', ''))
            g = group(title)
            if not g or not title: continue
            jid = f"az_{cc}_{r.get('id')}"
            if jid in seen or (title.lower(), comp.lower()) in keys: continue
            seen[jid] = {'id': jid, 'title': title, 'company': comp or 'Not stated',
                         'city': strip_html((r.get('location') or {}).get('display_name', '')),
                         'country': cc.upper(), 'posted': (r.get('created') or '')[:10], 'link': r.get('redirect_url', ''),
                         'desc': strip_html(r.get('description'))[:600], 'group': g, 'level': level(title),
                         'contract': r.get('contract_time') or r.get('contract_type') or '',
                         'salary_min': r.get('salary_min'), 'salary_max': r.get('salary_max'),
                         'first_seen': NOW.strftime('%Y-%m-%d')}
            keys.add((title.lower(), comp.lower())); added += 1
    cutoff = (NOW - timedelta(days=30)).strftime('%Y-%m-%d')
    jobs = sorted((j for j in seen.values() if (j.get('posted') or j['first_seen']) >= cutoff), key=lambda j: j.get('posted', ''), reverse=True)
    json.dump(jobs, open(path, 'w'), ensure_ascii=False, separators=(',', ':'))
    STATUS['countries'].append({'c': cc.upper(), 'name': cname, 'count': len(jobs), 'new': added})
    print(cc, len(jobs), 'new', added, flush=True)
json.dump(STATUS, open('data/jobs/index.json', 'w'), ensure_ascii=False, indent=0)
