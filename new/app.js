/* FinJob: jobs, companies and a rule-based CV tailor. No server; CV data stays in localStorage. */
(() => {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (_) { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (_) { return false; } },
  };
  const getJSON = (u) => fetch(u, { cache: 'no-cache' }).then((r) => { if (!r.ok) throw new Error(r.status); return r.json(); });
  const safeUrl = (u) => (typeof u === 'string' && /^https:\/\//.test(u) ? u : null);
  const fmtDay = (iso) => {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || ''); if (!m) return '';
    const d = new Date(+m[1], +m[2] - 1, +m[3]); const t = new Date(); t.setHours(0, 0, 0, 0);
    const a = Math.round((t - d) / 86400000);
    return a <= 0 ? 'Today' : a === 1 ? 'Yesterday' : a < 31 ? `${a} days ago` : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
  };
  const ageDays = (iso) => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || ''); if (!m) return 999; const t = new Date(); t.setHours(0, 0, 0, 0); return Math.round((t - new Date(+m[1], +m[2] - 1, +m[3])) / 86400000); };
  const guessCountry = () => { const l = (navigator.language || '').toUpperCase(); const m = /-([A-Z]{2})$/.exec(l); return m ? m[1] : ''; };

  // ---------------- Tabs ----------------
  const pages = Array.from(document.querySelectorAll('[data-page]'));
  function show(tab) {
    if (!pages.some((p) => p.id === tab)) tab = 'jobs';
    pages.forEach((p) => { p.hidden = p.id !== tab; });
    document.querySelectorAll('nav a').forEach((a) => a.setAttribute('aria-current', a.dataset.tab === tab ? 'page' : 'false'));
    if (tab === 'companies') Companies.init();
    if (tab === 'cv') CV.render();
    window.scrollTo(0, 0);
  }
  window.addEventListener('hashchange', () => show(location.hash.slice(1)));

  // ---------------- Jobs ----------------
  const Jobs = (() => {
    const st = { all: [], countries: [], country: '', level: '', win: '7', q: '', group: '', shown: 50 };
    const GROUPS = ['Financial analysis', 'FP&A / Controlling', 'Risk', 'Portfolio / Investment', 'Equity research', 'Audit / Accounting'];
    async function init() {
      let idx;
      try { idx = await getJSON('/data/jobs/index.json'); } catch (_) { idx = { countries: [] }; }
      st.countries = idx.countries || [];
      const sel = $('jCountry');
      sel.replaceChildren(new Option('All countries', ''), ...st.countries.slice().sort((a, b) => a.name.localeCompare(b.name)).map((c) => new Option(`${c.name} (${c.count})`, c.c)));
      const g = guessCountry(); if (st.countries.some((c) => c.c === g)) st.country = g;
      sel.value = st.country;
      if (!st.countries.length) {
        $('jobsNotice').hidden = false;
        $('jobsNotice').textContent = 'The Europe-wide job feed is being connected and will appear here soon. Meanwhile, browse finance companies and prepare your CV.';
        $('jList').replaceChildren(el('div', 'empty', 'No jobs loaded yet.'));
        $('jCount').textContent = '';
        return;
      }
      if (idx.updated_at) $('jobsSub').textContent = `Analyst, risk, FP&A, investment and audit roles in ${st.countries.length} countries. Updated ${new Date(idx.updated_at).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}.`;
      await load();
    }
    async function load() {
      const list = st.country ? [st.country] : st.countries.map((c) => c.c);
      $('jList').replaceChildren(el('div', 'empty', 'Loading jobs…'));
      const parts = await Promise.all(list.map((c) => getJSON(`/data/jobs/${c.toLowerCase()}.json`).catch(() => [])));
      st.all = parts.flat();
      render();
    }
    function filtered() {
      const q = st.q.toLowerCase();
      return st.all.filter((j) => ageDays(j.posted || j.first_seen) <= +st.win)
        .filter((j) => !st.level || j.level === st.level)
        .filter((j) => !st.group || j.group === st.group)
        .filter((j) => !q || `${j.title} ${j.company} ${j.city}`.toLowerCase().includes(q))
        .sort((a, b) => String(b.posted).localeCompare(String(a.posted)));
    }
    function render() {
      const base = st.all.filter((j) => ageDays(j.posted || j.first_seen) <= +st.win);
      const chips = $('jGroups'); chips.replaceChildren();
      [['', 'All roles', base.length], ...GROUPS.map((g) => [g, g, base.filter((j) => j.group === g).length])].forEach(([v, label, n]) => {
        const b = el('button', 'chip', label); b.type = 'button'; b.setAttribute('aria-pressed', String(st.group === v));
        const s = el('span', 'n', String(n)); b.append(s);
        b.addEventListener('click', () => { st.group = v; st.shown = 50; render(); });
        chips.append(b);
      });
      const rows = filtered();
      $('jCount').textContent = `${rows.length} role${rows.length === 1 ? '' : 's'}`;
      const L = $('jList'); L.replaceChildren();
      if (!rows.length) { L.append(el('div', 'empty', 'No roles match. Try a longer time window or another country.')); $('jMore').hidden = true; return; }
      rows.slice(0, st.shown).forEach((j) => L.append(card(j)));
      $('jMore').hidden = rows.length <= st.shown;
    }
    function card(j) {
      const c = el('article', 'card');
      const row = el('div', 'row'); const left = el('div');
      const href = safeUrl(j.link);
      const t = el(href ? 'a' : 'span', 'title', j.title); if (href) { t.href = href; t.target = '_blank'; t.rel = 'noopener nofollow'; }
      left.append(t, el('div', 'meta', [j.company, j.city, fmtDay(j.posted)].filter(Boolean).join(' · ')));
      row.append(left, el('span', 'tag', j.level || ''));
      c.append(row);
      if (j.desc) c.append(el('p', 'desc', j.desc.length > 260 ? j.desc.slice(0, 260) + '…' : j.desc));
      const a = el('div', 'actions');
      const tailor = el('button', 'btn primary', 'Tailor my CV'); tailor.type = 'button';
      tailor.addEventListener('click', () => { CV.setTarget(j); location.hash = 'cv'; });
      a.append(tailor);
      if (href) { const o = el('a', 'btn ghost', 'Open job'); o.href = href; o.target = '_blank'; o.rel = 'noopener nofollow'; a.append(o); }
      a.append(el('span', 'tag', j.group || ''));
      c.append(a);
      return c;
    }
    $('jCountry').addEventListener('change', (e) => { st.country = e.target.value; st.shown = 50; load(); });
    $('jLevel').addEventListener('change', (e) => { st.level = e.target.value; st.shown = 50; render(); });
    $('jWindow').addEventListener('change', (e) => { st.win = e.target.value; st.shown = 50; render(); });
    $('jQ').addEventListener('input', (e) => { st.q = e.target.value.trim(); st.shown = 50; render(); });
    $('jMore').addEventListener('click', () => { st.shown += 50; render(); });
    return { init, search(q) { st.q = q; $('jQ').value = q; st.win = '30'; $('jWindow').value = '30'; render(); } };
  })();

  // ---------------- Companies ----------------
  const Companies = (() => {
    const st = { started: false, index: [], country: '', rows: [], type: '', q: '', sig: false, shown: 100 };
    async function init() {
      if (st.started) return; st.started = true;
      try { st.index = (await getJSON('/data/companies/index.json')).countries || []; } catch (_) { st.index = []; }
      const total = st.index.reduce((s, c) => s + c.count, 0);
      if (total) $('coSub').textContent = `${total.toLocaleString('en-GB')} firms in ${st.index.length} countries from the official EU registers: banks, investment firms, fund managers, insurers and pension funds.`;
      const sel = $('cCountry');
      sel.replaceChildren(new Option('Choose a country', ''), ...st.index.slice().sort((a, b) => a.name.localeCompare(b.name)).map((c) => new Option(`${c.name} (${c.count.toLocaleString('en-GB')})`, c.c)));
      const g = guessCountry(); st.country = st.index.some((c) => c.c === g) ? g : (st.index.some((c) => c.c === 'IT') ? 'IT' : '');
      sel.value = st.country;
      if (st.country) load();
    }
    async function load() {
      $('cList').replaceChildren(el('div', 'empty', 'Loading companies…'));
      try { st.rows = await getJSON(`/data/companies/${st.country}.json`); } catch (_) { st.rows = []; }
      st.type = ''; st.shown = 100; render();
    }
    function render() {
      const q = st.q.toLowerCase();
      const base = st.rows.filter((r) => !st.sig || r.sig);
      const counts = {}; base.forEach((r) => r.t.forEach((t) => { counts[t] = (counts[t] || 0) + 1; }));
      const top = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 9);
      const chips = $('cTypes'); chips.replaceChildren();
      [['', 'All types', base.length], ...top.map(([t, n]) => [t, t, n])].forEach(([v, label, n]) => {
        const b = el('button', 'chip', label); b.type = 'button'; b.setAttribute('aria-pressed', String(st.type === v));
        b.append(el('span', 'n', n.toLocaleString('en-GB')));
        b.addEventListener('click', () => { st.type = v; st.shown = 100; render(); });
        chips.append(b);
      });
      const rows = base.filter((r) => !st.type || r.t.includes(st.type)).filter((r) => !q || `${r.n} ${r.city || ''}`.toLowerCase().includes(q));
      $('cCount').textContent = `${rows.length.toLocaleString('en-GB')} compan${rows.length === 1 ? 'y' : 'ies'}`;
      const L = $('cList'); L.replaceChildren();
      if (!st.country) { L.append(el('div', 'empty', 'Choose a country to see its finance companies.')); $('cMore').hidden = true; return; }
      if (!rows.length) { L.append(el('div', 'empty', 'No companies match.')); $('cMore').hidden = true; return; }
      rows.slice(0, st.shown).forEach((r) => L.append(card(r)));
      $('cMore').hidden = rows.length <= st.shown;
    }
    function card(r) {
      const c = el('article', 'card');
      const row = el('div', 'row'); const left = el('div');
      left.append(el('div', 'title', r.n), el('div', 'meta', [r.t.join(', '), r.city].filter(Boolean).join(' · ')));
      row.append(left);
      if (r.sig) row.append(el('span', 'tag sig', 'ECB-supervised group'));
      c.append(row);
      if (r.svc && r.svc.length) c.append(el('div', 'svc', 'Services: ' + r.svc.slice(0, 6).join(', ') + (r.svc.length > 6 ? '…' : '')));
      const a = el('div', 'actions');
      const web = safeUrl(r.web);
      if (web) { const w = el('a', 'btn ghost', 'Website'); w.href = web; w.target = '_blank'; w.rel = 'noopener nofollow'; a.append(w); }
      const s = el('a', 'btn ghost', 'Find careers page'); s.href = 'https://www.google.com/search?q=' + encodeURIComponent(`${r.n} careers jobs`); s.target = '_blank'; s.rel = 'noopener nofollow'; a.append(s);
      const j = el('button', 'btn ghost', 'Jobs at this company'); j.type = 'button';
      j.addEventListener('click', () => { location.hash = 'jobs'; Jobs.search(r.n.split(/\s+/).slice(0, 2).join(' ')); });
      a.append(j);
      c.append(a);
      return c;
    }
    $('cCountry').addEventListener('change', (e) => { st.country = e.target.value; if (st.country) load(); else { st.rows = []; render(); } });
    $('cQ').addEventListener('input', (e) => { st.q = e.target.value.trim(); st.shown = 100; render(); });
    $('cSig').addEventListener('change', (e) => { st.sig = e.target.checked; st.shown = 100; render(); });
    $('cMore').addEventListener('click', () => { st.shown += 100; render(); });
    return { init };
  })();

  // ---------------- CV builder + tailor ----------------
  const CV = (() => {
    const KEY = 'finjob_cv_v1';
    const blank = { name: '', headline: '', city: '', status: '', email: '', phone: '', link: '', summary: '', skills: '', certs: '', langs: '', lang: 'en', exp: [], edu: [] };
    let data = Object.assign({}, blank, store.get(KEY, {}));
    let target = store.get('finjob_target', null);
    const H = {
      en: { profile: 'Profile', exp: 'Professional experience', edu: 'Education', skills: 'Skills', key: 'Key skills for this role', certs: 'Certifications', langs: 'Languages' },
      it: { profile: 'Profilo', exp: 'Esperienza professionale', edu: 'Formazione', skills: 'Competenze', key: 'Competenze chiave per il ruolo', certs: 'Certificazioni', langs: 'Lingue' },
      de: { profile: 'Profil', exp: 'Berufserfahrung', edu: 'Ausbildung', skills: 'Kenntnisse', key: 'Relevante Kenntnisse für die Stelle', certs: 'Zertifikate', langs: 'Sprachen' },
      fr: { profile: 'Profil', exp: 'Expérience professionnelle', edu: 'Formation', skills: 'Compétences', key: 'Compétences clés pour le poste', certs: 'Certifications', langs: 'Langues' },
      es: { profile: 'Perfil', exp: 'Experiencia profesional', edu: 'Formación', skills: 'Competencias', key: 'Competencias clave para el puesto', certs: 'Certificaciones', langs: 'Idiomas' },
    };
    // Finance synonyms: a job word on the left also matches CV words on the right.
    const SYN = {
      'fp&a': ['planning', 'budget', 'budgeting', 'forecast', 'forecasting', 'variance', 'kpi', 'reporting'],
      controller: ['controlling', 'budget', 'variance', 'reporting', 'kpi', 'month-end', 'closing'], controlling: ['controller', 'budget', 'variance', 'kpi'],
      risk: ['var', 'stress', 'basel', 'credit', 'market', 'liquidity', 'compliance', 'aml', 'kyc', 'tail'],
      credit: ['risk', 'rating', 'lending', 'financial statement', 'covenant'],
      investment: ['valuation', 'dcf', 'portfolio', 'modelling', 'modeling', 'due diligence', 'asset'],
      portfolio: ['asset allocation', 'investment', 'performance', 'risk', 'optimization', 'optimisation'],
      equity: ['valuation', 'dcf', 'research', 'stocks', 'financial statement'],
      analyst: ['analysis', 'excel', 'modelling', 'modeling', 'reporting'],
      audit: ['ifrs', 'gaap', 'controls', 'accounting', 'reconciliation'], accounting: ['ifrs', 'gaap', 'reconciliation', 'bookkeeping'],
      data: ['sql', 'python', 'power bi', 'tableau', 'excel'], excel: ['vba', 'pivot', 'modelling'],
    };
    const norm = (s) => (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
    function jobTerms(j) {
      if (!j) return [];
      const text = norm(`${j.title} ${j.title} ${j.desc || ''} ${j.group || ''}`);
      const words = new Set(text.match(/[a-z&+#.]{2,}/g) || []);
      const terms = new Set();
      words.forEach((w) => { w = w.replace(/^[.]+|[.]+$/g, ''); if (w.length > 2 && !STOP.has(w)) terms.add(w); });
      Object.entries(SYN).forEach(([k, arr]) => { if (text.includes(k)) arr.forEach((x) => terms.add(x)); });
      ['power bi', 'financial statement', 'due diligence', 'asset allocation', 'month-end'].forEach((p) => { if (text.includes(p)) terms.add(p); });
      return Array.from(terms);
    }
    const STOP = new Set('the and for with you our are will your this that from have has who what all can job role team work working within based about more other per their they them into new also must able any etc des les une pour avec der die das und mit für den dei del per con una nel nella las los para por que como sie wir ihr'.split(' '));
    const score = (text, terms) => { const t = norm(text); let s = 0; terms.forEach((x) => { if (x.length > 2 && new RegExp(`(^|[^a-z])${x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`).test(t)) s++; }); return s; };
    function tailored() {
      const terms = jobTerms(target);
      const skills = data.skills.split(/[,;\n]/).map((s) => s.trim()).filter(Boolean);
      const sk = skills.map((s, i) => ({ s, i, sc: score(s, terms) })).sort((a, b) => b.sc - a.sc || a.i - b.i);
      const exp = (data.exp || []).map((e) => {
        const bullets = (e.bullets || '').split('\n').map((b) => b.replace(/^[•\-–]\s*/, '').trim()).filter(Boolean);
        return Object.assign({}, e, { bullets: bullets.map((b, i) => ({ b, i, sc: score(b, terms) })).sort((x, y) => y.sc - x.sc || x.i - y.i).map((x) => x.b) });
      });
      return {
        headline: target ? target.title.replace(/\s*\((m|f|w|d|x|nb)[\/|\w\s]*\)\s*/gi, ' ').trim() : data.headline,
        skills: sk.map((x) => x.s), key: sk.filter((x) => x.sc > 0).slice(0, 8).map((x) => x.s), exp, terms,
      };
    }
    function highlight(parent, text, terms) {
      if (!terms.length) { parent.append(document.createTextNode(text)); return; }
      const rx = new RegExp(`(${terms.filter((t) => t.length > 2).map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`, 'gi');
      let last = 0; const n = norm(text); let m;
      rx.lastIndex = 0;
      while ((m = rx.exec(n))) {
        if (m.index > last) parent.append(document.createTextNode(text.slice(last, m.index)));
        parent.append(el('mark', null, text.slice(m.index, m.index + m[0].length)));
        last = m.index + m[0].length; if (m[0].length === 0) rx.lastIndex++;
      }
      if (last < text.length) parent.append(document.createTextNode(text.slice(last)));
    }
    function render() {
      fillForm();
      const box = $('cvTarget');
      if (target) {
        box.hidden = false; box.replaceChildren();
        box.append(document.createTextNode('Tailoring for: '), el('b', null, `${target.title} – ${target.company}`), document.createTextNode(' '));
        const x = el('button', 'btn ghost', 'Clear job'); x.type = 'button'; x.style.marginLeft = '8px';
        x.addEventListener('click', () => { setTarget(null); render(); }); box.append(x);
      } else box.hidden = true;
      preview();
    }
    function preview() {
      const t = tailored(); const h = H[data.lang] || H.en; const P = $('preview'); P.replaceChildren();
      if (!data.name && !data.summary && !(data.exp || []).length) { P.append(el('p', 'meta', 'Your CV preview appears here as you fill in the form.')); return; }
      P.append(el('h3', null, (data.name || 'Your name').toUpperCase()));
      if (t.headline) P.append(el('div', 'p-head', t.headline));
      const contact = [data.city, data.phone, data.email, data.link].filter(Boolean).join('  |  ');
      if (contact) P.append(el('div', 'p-head', contact));
      if (data.status) { const s = el('div', 'p-head'); s.append(el('b', null, data.status)); P.append(s); }
      const sec = (title) => P.append(el('div', 'p-sec', title.toUpperCase()));
      if (data.summary) { sec(h.profile); const p = el('div'); highlight(p, data.summary, t.terms); P.append(p); }
      if (t.exp.length) {
        sec(h.exp);
        t.exp.forEach((e) => {
          const r = el('div', 'p-row'); r.append(el('b', null, [e.company, e.city].filter(Boolean).join(', ')), el('span', null, [e.from, e.to].filter(Boolean).join(' – '))); P.append(r);
          if (e.title) P.append(el('i', null, e.title));
          const ul = el('ul'); e.bullets.forEach((b) => { const li = el('li'); highlight(li, b, t.terms); ul.append(li); }); P.append(ul);
        });
      }
      if ((data.edu || []).length) {
        sec(h.edu);
        data.edu.forEach((e) => {
          const r = el('div', 'p-row'); r.append(el('b', null, [e.school, e.city].filter(Boolean).join(', ')), el('span', null, e.year || '')); P.append(r);
          if (e.degree) P.append(el('i', null, e.degree));
          if (e.note) { const d = el('div'); highlight(d, e.note, t.terms); P.append(d); }
        });
      }
      if (t.skills.length) {
        sec(h.skills);
        if (target && t.key.length) { const k = el('div'); k.append(el('b', null, h.key + ': '), el('mark', null, t.key.join(', '))); P.append(k); }
        P.append(el('div', null, t.skills.join(', ')));
      }
      const certs = data.certs.split('\n').map((s) => s.trim()).filter(Boolean);
      if (certs.length) { sec(h.certs); const ul = el('ul'); certs.forEach((c) => ul.append(el('li', null, c))); P.append(ul); }
      if (data.langs) { sec(h.langs); P.append(el('div', null, data.langs)); }
    }
    // ----- form -----
    const form = $('cvForm');
    function fillForm() {
      ['name', 'headline', 'city', 'status', 'email', 'phone', 'link', 'summary', 'skills', 'certs', 'langs', 'lang'].forEach((k) => {
        const f = form.elements[k]; if (f && f !== document.activeElement) f.value = data[k] || (k === 'lang' ? 'en' : '');
      });
      entries('exp', $('expList'), [['company', 'Company'], ['title', 'Job title'], ['city', 'City'], ['from', 'From'], ['to', 'To'], ['bullets', 'What you did (one point per line)', true]]);
      entries('edu', $('eduList'), [['school', 'School / university'], ['degree', 'Degree'], ['city', 'City'], ['year', 'Year'], ['note', 'Thesis or note', true]]);
    }
    function entries(kind, box, fields) {
      if (box.contains(document.activeElement)) return;
      box.replaceChildren();
      (data[kind] || []).forEach((e, i) => {
        const wrap = el('div', 'entry');
        const head = el('div', 'entry-head'); head.append(el('span', 'lbl', `${kind === 'exp' ? 'JOB' : 'EDUCATION'} ${i + 1}`));
        const del = el('button', 'x', 'Remove'); del.type = 'button'; del.addEventListener('click', () => { data[kind].splice(i, 1); save(); render(); });
        head.append(del); wrap.append(head);
        const grid = el('div', 'two');
        fields.forEach(([k, label, long]) => {
          const f = el('div', 'field'); const id = `f_${kind}_${i}_${k}`;
          const l = el('label', null, label); l.htmlFor = id;
          const inp = el(long ? 'textarea' : 'input'); inp.id = id; inp.value = e[k] || '';
          inp.addEventListener('input', () => { data[kind][i][k] = inp.value; save(); preview(); });
          f.append(l, inp);
          if (long) wrap.append(f); else grid.append(f);
        });
        wrap.insertBefore(grid, wrap.children[1]);
        box.append(wrap);
      });
    }
    document.querySelectorAll('[data-add]').forEach((b) => b.addEventListener('click', () => { const k = b.dataset.add; data[k] = data[k] || []; data[k].push({}); save(); render(); }));
    form.addEventListener('input', (e) => { const n = e.target.name; if (n) { data[n] = e.target.value; save(); preview(); } });
    form.addEventListener('submit', (e) => e.preventDefault());
    function save() { $('saveState').textContent = store.set(KEY, data) ? 'Saved in this browser.' : 'Couldn’t save in this browser. Use Export data to keep a copy.'; }
    function setTarget(j) { target = j ? { title: j.title, company: j.company, desc: j.desc || '', group: j.group || '' } : null; store.set('finjob_target', target); }
    $('exportBtn').addEventListener('click', () => {
      const blob = new Blob([JSON.stringify(data, null, 1)], { type: 'application/json' });
      const a = el('a'); a.href = URL.createObjectURL(blob); a.download = 'finjob-cv.json'; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    });
    $('importFile').addEventListener('change', async (e) => {
      const f = e.target.files[0]; if (!f) return;
      try { const d = JSON.parse(await f.text()); data = Object.assign({}, blank, d); save(); render(); } catch (_) { $('saveState').textContent = 'That file isn’t a FinJob CV export.'; }
      e.target.value = '';
    });
    let clearArmed = false;
    $('clearBtn').addEventListener('click', () => {
      if (!clearArmed) { clearArmed = true; $('clearBtn').textContent = 'Tap again to clear'; setTimeout(() => { clearArmed = false; $('clearBtn').textContent = 'Clear'; }, 4000); return; }
      data = Object.assign({}, blank); save(); render(); clearArmed = false; $('clearBtn').textContent = 'Clear';
    });
    // ----- PDF -----
    let fontsReady = null;
    const b64 = (buf) => { let s = ''; const u = new Uint8Array(buf); for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000)); return btoa(s); };
    async function fonts(doc) {
      if (!fontsReady) fontsReady = Promise.all(['/fonts/DejaVuSans.ttf', '/fonts/DejaVuSans-Bold.ttf'].map((u) => fetch(u).then((r) => r.arrayBuffer()).then(b64)));
      const [reg, bold] = await fontsReady;
      doc.addFileToVFS('DV.ttf', reg); doc.addFont('DV.ttf', 'DV', 'normal');
      doc.addFileToVFS('DVB.ttf', bold); doc.addFont('DVB.ttf', 'DV', 'bold');
    }
    $('pdfBtn').addEventListener('click', async () => {
      const btn = $('pdfBtn');
      if (!window.jspdf) { btn.textContent = 'PDF tool didn’t load'; return; }
      btn.disabled = true; btn.textContent = 'Making PDF…';
      try {
        const { jsPDF } = window.jspdf; const doc = new jsPDF({ unit: 'mm', format: 'a4' });
        await fonts(doc);
        const t = tailored(); const h = H[data.lang] || H.en;
        const W = 210, M = 16, CW = W - 2 * M; let y = 16;
        const navy = [31, 58, 95];
        const need = (hgt) => { if (y + hgt > 285) { doc.addPage(); y = 16; } };
        const text = (s, size, opts = {}) => {
          doc.setFont('DV', opts.bold ? 'bold' : 'normal'); doc.setFontSize(size); doc.setTextColor(...(opts.color || [23, 32, 43]));
          const lines = doc.splitTextToSize(s, opts.width || CW - (opts.indent || 0));
          lines.forEach((ln) => { need(size * 0.42); doc.text(ln, opts.center ? W / 2 : M + (opts.indent || 0), y, { align: opts.center ? 'center' : 'left' }); y += size * 0.42; });
        };
        const sec = (title) => { y += 2.5; need(8); text(title.toUpperCase(), 10, { bold: true, color: navy }); doc.setDrawColor(190); doc.line(M, y - 2.6, W - M, y - 2.6); y += 1.2; };
        const lr = (l, r) => { need(5); doc.setFont('DV', 'bold'); doc.setFontSize(9.5); doc.setTextColor(23, 32, 43); doc.text(doc.splitTextToSize(l, CW - 45)[0], M, y); doc.setFont('DV', 'normal'); doc.text(r || '', W - M, y, { align: 'right' }); y += 4.2; };
        text((data.name || '').toUpperCase(), 17, { bold: true, center: true, color: navy }); y += 1;
        if (t.headline) text(t.headline, 10.5, { center: true, color: [85, 85, 85] });
        const contact = [data.city, data.phone, data.email, data.link].filter(Boolean).join('  |  ');
        if (contact) text(contact, 8.8, { center: true });
        if (data.status) text(data.status, 8.8, { center: true, bold: true });
        y += 1; doc.setDrawColor(...navy); doc.setLineWidth(0.5); doc.line(M, y, W - M, y); doc.setLineWidth(0.2); y += 3;
        if (data.summary) { sec(h.profile); text(data.summary, 9.2); }
        if (t.exp.length) { sec(h.exp); t.exp.forEach((e) => { lr([e.company, e.city].filter(Boolean).join(', '), [e.from, e.to].filter(Boolean).join(' – ')); if (e.title) text(e.title, 9.2, { color: [70, 70, 70] }); e.bullets.forEach((b) => { need(4); doc.setFontSize(9.2); doc.text('•', M + 1.5, y); text(b, 9.2, { indent: 5 }); }); y += 1.5; }); }
        if ((data.edu || []).length) { sec(h.edu); data.edu.forEach((e) => { lr([e.school, e.city].filter(Boolean).join(', '), e.year || ''); if (e.degree) text(e.degree, 9.2, { color: [70, 70, 70] }); if (e.note) text(e.note, 9, { indent: 5 }); y += 1.5; }); }
        if (t.skills.length) { sec(h.skills); if (target && t.key.length) text(`${h.key}: ${t.key.join(', ')}`, 9.2, { bold: true }); text(t.skills.join(', '), 9.2); }
        const certs = data.certs.split('\n').map((s) => s.trim()).filter(Boolean);
        if (certs.length) { sec(h.certs); certs.forEach((c) => { need(4); doc.text('•', M + 1.5, y); text(c, 9.2, { indent: 5 }); }); }
        if (data.langs) { sec(h.langs); text(data.langs, 9.2); }
        const slug = (s) => (s || '').replace(/[^A-Za-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 40);
        doc.save(`CV_${slug(data.name) || 'FinJob'}${target ? '_' + slug(target.company) : ''}.pdf`);
        btn.textContent = 'Download PDF';
      } catch (e) { btn.textContent = 'Couldn’t make the PDF. Try again.'; }
      finally { btn.disabled = false; setTimeout(() => { btn.textContent = 'Download PDF'; }, 4000); }
    });
    return { render, setTarget };
  })();

  // ---------------- boot ----------------
  show(location.hash.slice(1) || 'jobs');
  Jobs.init();
})();
