"""One-off probe: check which official register sources can be downloaded from GitHub Actions.
Writes reports/probe.json and small HTML samples so the right parsers can be written."""
import json, os, re, urllib.request, ssl
os.makedirs('reports/probe', exist_ok=True)
UA = {'User-Agent': 'Mozilla/5.0 (finjob.eu register indexer)'}
targets = {
  'ecb_lists_page': 'https://www.ecb.europa.eu/stats/financial_corporations/list_of_financial_institutions/html/index.en.html',
  'ecb_ssm_list': 'https://www.bankingsupervision.europa.eu/banking/list/who/html/index.en.html',
  'eba_cir': 'https://euclid.eba.europa.eu/register/cir/disclaimer',
  'eba_cir_search': 'https://euclid.eba.europa.eu/register/cir/search',
  'esma_solr_mifid': 'https://registers.esma.europa.eu/solr/esma_registers_mifid_entities/select?q=*:*&rows=2&wt=json',
  'esma_solr_upreg': 'https://registers.esma.europa.eu/solr/esma_registers_upreg/select?q=*:*&rows=2&wt=json',
  'esma_registers_home': 'https://registers.esma.europa.eu/publication/',
  'esma_isr': 'https://www.esma.europa.eu/publications-and-data/databases-and-registers',
  'eiopa_ins': 'https://register.eiopa.europa.eu/registers/register-of-insurance-undertakings',
  'gleif_api': 'https://api.gleif.org/api/v1/lei-records?page[size]=1',
}
out = {}
for k, u in targets.items():
    try:
        req = urllib.request.Request(u, headers=UA)
        with urllib.request.urlopen(req, timeout=60) as r:
            body = r.read(3_000_000)
            ct = r.headers.get('content-type', '')
            out[k] = {'url': u, 'status': r.status, 'ctype': ct, 'bytes': len(body), 'final_url': r.geturl()}
            text = body.decode('utf-8', 'replace')
            if 'html' in ct or text.lstrip().startswith('<'):
                links = sorted(set(re.findall(r'href=["\']([^"\']+\.(?:csv|zip|xlsx?|xml|json)[^"\']*)', text, re.I)))
                out[k]['data_links'] = links[:80]
                open(f'reports/probe/{k}.html', 'w').write(text[:200_000])
            else:
                out[k]['sample'] = text[:1500]
    except Exception as e:
        out[k] = {'url': u, 'error': repr(e)[:400]}
json.dump(out, open('reports/probe.json', 'w'), indent=1)
print(json.dumps({k: (v.get('status'), v.get('error'), len(v.get('data_links', []))) for k, v in out.items()}, indent=1))
