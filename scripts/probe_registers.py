"""Probe 2: inspect the usable sources in detail (formats, columns, sizes)."""
import json, os, re, io, zipfile, urllib.request
os.makedirs('reports/probe', exist_ok=True)
UA = {'User-Agent': 'Mozilla/5.0 (finjob.eu register indexer)'}
def get(u, n=60_000_000):
    with urllib.request.urlopen(urllib.request.Request(u, headers=UA), timeout=120) as r:
        return r.read(n), r.headers.get('content-type', ''), r.geturl()
out = {}
def safe(k, f):
    try: out[k] = f()
    except Exception as e: out[k] = {'error': repr(e)[:400]}
def ecb_zip(u):
    b, ct, fu = get(u)
    z = zipfile.ZipFile(io.BytesIO(b)); res = {'bytes': len(b), 'files': []}
    for n in z.namelist()[:10]:
        data = z.read(n); txt = data[:3000].decode('utf-8', 'replace')
        res['files'].append({'name': n, 'size': len(data), 'lines': data.count(b'\n'), 'head': txt[:1500]})
    return res
safe('ecb_ic', lambda: ecb_zip('https://www.ecb.europa.eu/stats/pdf/money/ic/ecb.icd_overview.en.zip'))
safe('ecb_pf', lambda: ecb_zip('https://www.ecb.europa.eu/stats/pdf/money/pf/ecb.pfd_overview.en.zip'))
def portal():
    b, ct, fu = get('https://data.ecb.europa.eu/data/data-categories/financial-corporations/list-financial-institutions/data', 3_000_000)
    t = b.decode('utf-8', 'replace'); open('reports/probe/ecb_portal.html', 'w').write(t[:300_000])
    return {'final': fu, 'links': sorted(set(re.findall(r'(?:href|src)=["\']([^"\']*(?:csv|download|mfi|MFI|zip)[^"\']*)', t)))[:80]}
safe('ecb_portal', portal)
for cand in ['https://www.ecb.europa.eu/stats/financial_corporations/list_of_financial_institutions/html/elegass.en.html']:
    def f(c=cand):
        b, ct, fu = get(c, 3_000_000); t = b.decode('utf-8', 'replace'); open('reports/probe/ecb_elegass.html', 'w').write(t[:300_000])
        return {'final': fu, 'links': sorted(set(re.findall(r'(?:href|action|src)=["\']([^"\']+)', t)))[:120]}
    safe('ecb_elegass', f)
def solr(params):
    b, ct, fu = get('https://registers.esma.europa.eu/solr/esma_registers_upreg/select?' + params, 5_000_000)
    return json.loads(b)
safe('esma_facets', lambda: solr('q=*:*&rows=0&wt=json&facet=true&facet.field=entity_type&facet.field=type_s&facet.limit=50')['facet_counts'])
def sample_types():
    fac = solr('q=*:*&rows=0&wt=json&facet=true&facet.field=entity_type&facet.limit=50')['facet_counts']['facet_fields']['entity_type']
    res = {}
    for t in fac[0::2]:
        d = solr(f'q=entity_type:{t}&rows=1&wt=json')['response']
        res[t] = {'n': d['numFound'], 'doc': d['docs'][0] if d['docs'] else None}
    return res
safe('esma_samples', sample_types)
def ssm():
    b, ct, fu = get('https://www.bankingsupervision.europa.eu/ecb/pub/pdf/ssm.listofsupervisedentities202608.en.xlsx')
    return {'bytes': len(b), 'ctype': ct}
safe('ssm', ssm)
json.dump(out, open('reports/probe2.json', 'w'), indent=1, default=str)
print('ok')
