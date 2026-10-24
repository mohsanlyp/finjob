"""Build the European finance company directory from official registers.
Sources: ESMA investment-services register, ECB list of MFIs (banks, money-market funds),
ECB lists of insurance corporations and pension funds, ECB list of significant supervised banks.
Output: data/companies/<CC>.json per country + data/companies/index.json, and reports/companies_build.json."""
import csv, io, json, os, re, sys, time, zipfile, urllib.request, urllib.parse
from collections import defaultdict
UA = {'User-Agent': 'Mozilla/5.0 (finjob.eu register indexer; +https://finjob.eu)'}
REPORT = {'started': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()), 'sources': {}}

def get(url, limit=200_000_000, tries=6):
    for i in range(tries):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=180) as r:
                return r.read(limit), r.headers.get('content-type', ''), r.geturl()
        except Exception as e:
            if i == tries - 1: raise
            time.sleep(15 * (i + 1))

COUNTRIES = {'AUSTRIA':'AT','BELGIUM':'BE','BULGARIA':'BG','CROATIA':'HR','CYPRUS':'CY','CZECHIA':'CZ','CZECH REPUBLIC':'CZ','DENMARK':'DK','ESTONIA':'EE','FINLAND':'FI','FRANCE':'FR','GERMANY':'DE','GREECE':'GR','HUNGARY':'HU','ICELAND':'IS','IRELAND':'IE','ITALY':'IT','LATVIA':'LV','LIECHTENSTEIN':'LI','LITHUANIA':'LT','LUXEMBOURG':'LU','MALTA':'MT','NETHERLANDS':'NL','NORWAY':'NO','POLAND':'PL','PORTUGAL':'PT','ROMANIA':'RO','SLOVAKIA':'SK','SLOVENIA':'SI','SPAIN':'ES','SWEDEN':'SE','UNITED KINGDOM':'GB','SWITZERLAND':'CH'}
NAMES = {v: k.title() for k, v in COUNTRIES.items()}; NAMES.update({'CZ': 'Czechia', 'GB': 'United Kingdom', 'EL': 'Greece'})
def cc(x):
    x = (x or '').strip().upper()
    if len(x) == 2: return 'GR' if x == 'EL' else x
    return COUNTRIES.get(x, '')

firms = {}  # key -> record
def key_of(name, country, lei):
    return lei.upper() if lei else (re.sub(r'[^a-z0-9]', '', name.lower()) + '|' + country)
KEEP_UPPER = {'AG','SA','SPA','SRL','BV','NV','GMBH','KG','PLC','LTD','AB','AS','ASA','OY','OYJ','SE','SAS','SL','SGR','SIM','BCC','EG','EGT','AIF','UCITS','UK','EU','II','III','IV','DZ','KBC','ING','ABN','AMRO','BNP','HSBC','UBS','BPER','BNL','CDP','LGT','VP','UBI','MPS','KFW','NRW','LBBW','SEB','DNB','OTP','PKO','BPI','BCP','CGD','ESG','PSA','RCI','VW','BMW','ICCREA','IBL','GE'}
def tidy(name):
    name = re.sub(r'\s+', ' ', (name or '')).strip().strip('"\'\u2018\u2019\u201c\u201d ').strip()
    letters = [ch for ch in name if ch.isalpha()]
    if letters and sum(ch.isupper() for ch in letters) / len(letters) > 0.85:
        def fix(w):
            core = re.sub(r'[^A-Za-zÀ-ÿ]', '', w)
            if core.upper() in KEEP_UPPER or (len(core) <= 3 and core.upper() not in {'DI','DEL','DE','LA','LE','DES','DER','DIE','VON','UND','ET','DA','DO','DOS','DAS','EN','THE','OF','AND','PER'}): return w
            return w[:1].upper() + w[1:].lower() if w[:1].isalpha() else w[:2].upper() + w[2:].lower() if len(w) > 1 else w
        name = ' '.join('-'.join(fix(x) for x in w.split('-')) for w in name.split(' '))
        name = re.sub(r"\b(Di|Del|Della|Dei|De|La|Le|Des|Der|Die|Von|Und|Et|Da|Do|Dos|Das|En|The|Of|And|Per)\b", lambda m: m.group(1).lower(), name)
        name = name[:1].upper() + name[1:]
    return name
def add(name, country, ftype, source, lei='', city='', web='', services=None, extra=None):
    name = tidy(name)
    if not name or not country: return
    k = key_of(name, country, lei)
    r = firms.get(k)
    if not r:
        r = firms[k] = {'n': name, 'c': country, 't': set(), 's': set(), 'lei': lei or '', 'city': city or '', 'web': web or '', 'svc': set()}
    r['t'].add(ftype); r['s'].add(source)
    if city and not r['city']: r['city'] = city.title() if city.isupper() else city
    if web and not r['web']: r['web'] = web
    if lei and not r['lei']: r['lei'] = lei
    for s in services or []: r['svc'].add(s)
    if extra: r.update(extra)

# ---------- 1. ESMA investment services register (Solr) ----------
def esma():
    base = 'https://registers.esma.europa.eu/solr/esma_registers_upreg/select?'
    def q(params): return json.loads(get(base + urllib.parse.urlencode(params))[0])
    roots, n, start = {}, 0, 0
    fl = 'id,ae_entityName,ae_commercialName,ae_lei,ae_homeMemberState,ae_headOfficeAddress,ae_website,ae_status,ae_entityTypeLabel,ae_officeType,ae_hostMemberState'
    while True:
        d = q({'q': 'entity_type:ae', 'rows': 2000, 'start': start, 'wt': 'json', 'fl': fl})['response']
        for doc in d['docs']:
            roots[doc['id']] = doc
        start += 2000
        if start >= d['numFound']: break
    svc = defaultdict(set); start = 0
    while True:
        d = q({'q': 'entity_type:aeActivity', 'rows': 5000, 'start': start, 'wt': 'json', 'fl': '_root_,ac_serviceName,ac_status'})['response']
        for doc in d['docs']:
            if (doc.get('ac_status') or '').lower() == 'active' and doc.get('ac_serviceName'):
                svc[doc['_root_']].add(doc['ac_serviceName'].strip())
        start += 5000
        if start >= d['numFound']: break
    kept = 0
    for rid, doc in roots.items():
        if (doc.get('ae_status') or '').lower() != 'active': continue
        if (doc.get('ae_officeType') or '').lower().startswith('branch'): continue
        country = cc(doc.get('ae_homeMemberState'))
        addr = doc.get('ae_headOfficeAddress') or ''
        m = re.search(r'\b\d{4,5}\s+([A-Za-zÀ-ÿ .\'-]+)$', addr.strip())
        city = m.group(1).strip() if m else ''
        label = doc.get('ae_entityTypeLabel') or 'Investment firm'
        web = (doc.get('ae_website') or '').strip()
        if web and not web.startswith('http'): web = 'https://' + web
        add(doc.get('ae_entityName'), country, label, 'ESMA', doc.get('ae_lei', ''), city, web, sorted(svc.get(rid, [])))
        kept += 1
    return {'entities': len(roots), 'kept_active_head_offices': kept}

# ---------- helpers for tables ----------
def find_col(header, *needles):
    h = [str(x or '').strip().lower() for x in header]
    for nd in needles:
        for i, x in enumerate(h):
            if nd in x: return i
    return None
def xlsx_rows(data):
    import openpyxl
    wb = openpyxl.load_workbook(io.BytesIO(data), read_only=True, data_only=True)
    out = []
    for ws in wb.worksheets:
        rows = [list(r) for r in ws.iter_rows(values_only=True)]
        out.append((ws.title, rows))
    return out
def header_index(rows, *must):
    for i, r in enumerate(rows[:40]):
        low = ' | '.join(str(x or '').lower() for x in r)
        if all(m in low for m in must): return i
    return None

# ---------- 2. ECB list of MFIs (daily) ----------
def ecb_mfi():
    page = 'https://www.ecb.europa.eu/stats/financial_corporations/list_of_financial_institutions/html/daily_list-MID.en.html'
    html = get(page)[0].decode('utf-8', 'replace')
    links = sorted(set(re.findall(r'href=["\']([^"\']+\.(?:csv|zip|txt)[^"\']*)', html, re.I)))
    info = {'links': links[:30]}
    if not links: return info
    url = urllib.parse.urljoin(page, links[0])
    data = get(url)[0]
    if data[:2] == b'PK':
        z = zipfile.ZipFile(io.BytesIO(data)); name = sorted(z.namelist())[-1]; data = z.read(name); info['zip_member'] = name
    text = data.decode('utf-8', 'replace') if not data.startswith(b'\xff\xfe') else data.decode('utf-16')
    rows = list(csv.reader(io.StringIO(text), delimiter='\t'))
    hi = header_index(rows, 'name') or 0
    head = rows[hi]; info['header'] = head
    ci = find_col(head, 'country_of_registration', 'country'); ni = find_col(head, 'name')
    bi = find_col(head, 'category'); li = find_col(head, 'lei'); ti = find_col(head, 'city', 'town')
    n = 0; types = defaultdict(int)
    for r in rows[hi + 1:]:
        if not r or ni is None or ni >= len(r): continue
        box = (r[bi] if bi is not None and bi < len(r) else '').strip()
        types[box] += 1
        bl = box.lower()
        ftype = ('Money market fund' if ('money market' in bl or 'mmf' in bl) else 'Central bank' if 'central bank' in bl
                 else 'Bank' if ('credit' in bl or 'bank' in bl or not bl) else 'Financial institution')
        if ftype == 'Money market fund': continue  # funds are products, not employers
        add(r[ni], cc(r[ci] if ci is not None and ci < len(r) else ''), ftype, 'ECB', r[li] if li is not None and li < len(r) else '', r[ti] if ti is not None and ti < len(r) else '')
        n += 1
    info.update({'rows': len(rows) - hi - 1, 'kept': n, 'box_values': dict(sorted(types.items(), key=lambda x: -x[1])[:15])})
    return info

# ---------- 3/4. ECB insurance corporations & pension funds ----------
def ecb_zip_list(url, ftype):
    data = get(url)[0]
    z = zipfile.ZipFile(io.BytesIO(data))
    members = sorted(n for n in z.namelist() if n.lower().endswith(('.xlsx',)))
    name = members[-1]
    info = {'member': name}
    for title, rows in xlsx_rows(z.read(name)):
        hi = header_index(rows, 'name')
        if hi is None: continue
        head = rows[hi]; info.setdefault('headers', {})[title] = [str(x) for x in head][:20]
        ni = find_col(head, 'name'); ci = find_col(head, 'country'); li = find_col(head, 'lei'); ti = find_col(head, 'city', 'town', 'postal')
        n = 0
        for r in rows[hi + 1:]:
            if ni is None or ni >= len(r) or not r[ni]: continue
            add(str(r[ni]), cc(str(r[ci]) if ci is not None and ci < len(r) and r[ci] else ''), ftype, 'ECB',
                str(r[li]) if li is not None and li < len(r) and r[li] else '', str(r[ti]) if ti is not None and ti < len(r) and r[ti] else '')
            n += 1
        info.setdefault('kept', {})[title] = n
    return info

# ---------- 5. ECB significant supervised banks ----------
def ssm():
    page = 'https://www.bankingsupervision.europa.eu/framework/supervised-banks/html/index.en.html'
    html = get(page)[0].decode('utf-8', 'replace')
    links = [l for l in re.findall(r'href=["\']([^"\']+listofsupervisedentities[^"\']+\.xlsx)', html) if 'annex' not in l]
    if not links: return {'error': 'no xlsx link'}
    data = get(urllib.parse.urljoin(page, links[0]))[0]
    names = 0
    for title, rows in xlsx_rows(data):
        hi = header_index(rows, 'name')
        if hi is None: continue
        head = rows[hi]; ni = find_col(head, 'name'); ci = find_col(head, 'country'); li = find_col(head, 'lei')
        for r in rows[hi + 1:]:
            if ni is None or ni >= len(r) or not r[ni]: continue
            add(str(r[ni]), cc(str(r[ci]) if ci is not None and ci < len(r) and r[ci] else ''), 'Bank', 'ECB-SSM',
                str(r[li]) if li is not None and li < len(r) and r[li] else '', extra={'sig': 1})
            names += 1
    return {'link': links[0], 'rows': names}

for name, fn in [('esma', esma), ('ecb_mfi', ecb_mfi),
                 ('ecb_insurers', lambda: ecb_zip_list('https://www.ecb.europa.eu/stats/pdf/money/ic/ecb.icd_overview.en.zip', 'Insurer')),
                 ('ecb_pension', lambda: ecb_zip_list('https://www.ecb.europa.eu/stats/pdf/money/pf/ecb.pfd_overview.en.zip', 'Pension fund')),
                 ('ecb_ssm', ssm)]:
    try:
        REPORT['sources'][name] = fn()
    except Exception as e:
        REPORT['sources'][name] = {'error': repr(e)[:500]}
    print(name, json.dumps(REPORT['sources'][name], default=str)[:600], flush=True)

failed = [k for k, v in REPORT['sources'].items() if isinstance(v, dict) and v.get('error')]
if failed:
    os.makedirs('reports', exist_ok=True)
    REPORT['aborted'] = f'Sources failed: {failed}. Kept the previous directory unchanged.'
    json.dump(REPORT, open('reports/companies_build.json', 'w'), indent=1, default=str)
    sys.exit(REPORT['aborted'])
# ---------- write per-country files ----------
by = defaultdict(list)
for r in firms.values():
    if not r['c']: continue
    rec = {'n': r['n'], 't': sorted(r['t']), 's': sorted(r['s'])}
    for f in ('lei', 'city', 'web'):
        if r[f]: rec[f] = r[f]
    if r['svc']: rec['svc'] = sorted(r['svc'])
    if r.get('sig'): rec['sig'] = 1
    by[r['c']].append(rec)
os.makedirs('data/companies', exist_ok=True)
for f in os.listdir('data/companies'):
    os.remove(os.path.join('data/companies', f))
index = []
for c, rows in sorted(by.items()):
    rows.sort(key=lambda x: (-x.get('sig', 0), x['n'].lower()))
    json.dump(rows, open(f'data/companies/{c}.json', 'w'), ensure_ascii=False, separators=(',', ':'))
    types = defaultdict(int)
    for x in rows:
        for t in x['t']: types[t] += 1
    index.append({'c': c, 'name': NAMES.get(c, c), 'count': len(rows), 'types': dict(types)})
json.dump({'updated_at': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()), 'countries': index}, open('data/companies/index.json', 'w'), ensure_ascii=False, indent=0)
REPORT['total'] = sum(x['count'] for x in index); REPORT['countries'] = len(index)
REPORT['no_country'] = sum(1 for r in firms.values() if not r['c'])
os.makedirs('reports', exist_ok=True)
json.dump(REPORT, open('reports/companies_build.json', 'w'), indent=1, default=str)
print('TOTAL', REPORT['total'], 'countries', REPORT['countries'])
if REPORT['total'] < 1000: sys.exit('Too few companies; refusing to publish')
