// Builds data/authors.json: where each kitabxana.az author was born and died, from Wikidata.
//
// Input: data/kitabxana-authors.json (the site's published authors, see README) and
// data/overrides.json (hand corrections). Authors without a Wikidata id are looked up by name on
// Azerbaijani Wikipedia and kept only when the item is a person whose dates or century agree.
//
//   node scripts/build.mjs
import { readFile, writeFile } from 'node:fs/promises';

const UA = 'azadbilik-xerite/0.1 (https://github.com/azadbilik/xerite)';
const root = new URL('../data/', import.meta.url);
const authors = JSON.parse(await readFile(new URL('kitabxana-authors.json', root)));
const overrides = JSON.parse(await readFile(new URL('overrides.json', root)).catch(() => '{}'));

const get = async (url, tries = 4) => {
  for (let i = 0; ; i++) {
    const r = await fetch(url, { headers: { 'user-agent': UA, accept: 'application/json' } });
    if (r.ok) return r.json();
    if (i >= tries) throw new Error(`${r.status} ${url.slice(0, 120)}`);
    await new Promise((res) => setTimeout(res, 2000 * (i + 1)));
  }
};
const chunks = (xs, n) => Array.from({ length: Math.ceil(xs.length / n) }, (_, i) => xs.slice(i * n, i * n + n));

// 1. Wikipedia titles → Wikidata ids, for authors the site has no id for
async function qidsForTitles(wiki, titles) {
  const out = new Map();
  for (const part of chunks([...new Set(titles)], 50)) {
    const u = `https://${wiki}.wikipedia.org/w/api.php?action=query&format=json&redirects=1&prop=pageprops&ppprop=wikibase_item&titles=${encodeURIComponent(part.join('|'))}`;
    const j = await get(u);
    const back = new Map();
    for (const n of j.query?.normalized ?? []) back.set(n.to, n.from);
    for (const r of j.query?.redirects ?? []) back.set(r.to, back.get(r.from) ?? r.from);
    for (const p of Object.values(j.query?.pages ?? {})) {
      const q = p.pageprops?.wikibase_item;
      if (q) out.set(back.get(p.title) ?? p.title, q);
    }
  }
  return out;
}

const candidates = new Map(); // slug → { qid, how }
const byTitle = { az: [], en: [] };
for (const a of authors) {
  if (overrides[a.slug]?.wikidataId) candidates.set(a.slug, { qid: overrides[a.slug].wikidataId, how: 'override' });
  else if (a.wikidataId) candidates.set(a.slug, { qid: a.wikidataId, how: 'site' });
  else {
    for (const [, s] of Object.entries(a.bioSources ?? {})) byTitle[s.wiki]?.push([a.slug, s.title, 'bio']);
    byTitle.az.push([a.slug, a.nameAz, 'name']);
  }
}
for (const wiki of ['az', 'en']) {
  const map = await qidsForTitles(wiki, byTitle[wiki].map(([, t]) => t));
  for (const [slug, title, how] of byTitle[wiki]) {
    const q = map.get(title);
    if (q && !candidates.has(slug)) candidates.set(slug, { qid: q, how: how === 'bio' ? 'bio' : 'name' });
  }
}

// 2. Wikidata: person?, birth/death years, places with coordinates
const facts = new Map();
for (const part of chunks([...new Set([...candidates.values()].map((c) => c.qid))], 120)) {
  const q = `SELECT ?item ?human ?born ?bornP ?died ?diedP ?bp ?bpAz ?bpEn ?bpRu ?bpC ?dp ?dpAz ?dpEn ?dpRu ?dpC WHERE {
    VALUES ?item { ${part.map((x) => 'wd:' + x).join(' ')} }
    BIND(EXISTS { ?item wdt:P31 wd:Q5 } AS ?human)
    OPTIONAL { ?item p:P569/psv:P569 [ wikibase:timeValue ?born; wikibase:timePrecision ?bornP ] }
    OPTIONAL { ?item p:P570/psv:P570 [ wikibase:timeValue ?died; wikibase:timePrecision ?diedP ] }
    OPTIONAL { ?item wdt:P19 ?bp . ?bp wdt:P625 ?bpC .
      OPTIONAL { ?bp rdfs:label ?bpAz FILTER(lang(?bpAz) = "az") }
      OPTIONAL { ?bp rdfs:label ?bpEn FILTER(lang(?bpEn) = "en") }
      OPTIONAL { ?bp rdfs:label ?bpRu FILTER(lang(?bpRu) = "ru") } }
    OPTIONAL { ?item wdt:P20 ?dp . ?dp wdt:P625 ?dpC .
      OPTIONAL { ?dp rdfs:label ?dpAz FILTER(lang(?dpAz) = "az") }
      OPTIONAL { ?dp rdfs:label ?dpEn FILTER(lang(?dpEn) = "en") }
      OPTIONAL { ?dp rdfs:label ?dpRu FILTER(lang(?dpRu) = "ru") } }
  }`;
  const j = await get('https://query.wikidata.org/sparql?format=json&query=' + encodeURIComponent(q));
  for (const b of j.results.bindings) {
    const id = b.item.value.split('/').pop();
    const f = facts.get(id) ?? { human: b.human?.value === 'true', born: null, died: null, birth: null, death: null };
    // a year only when Wikidata knows it to the year: "XX century" is stored as 2000 at precision 7
    const year = (v, p) => (v && +p?.value >= 9 ? parseInt(v.value.replace(/^\+?(-?\d+).*/, '$1'), 10) : null);
    f.born ??= year(b.born, b.bornP);
    f.died ??= year(b.died, b.diedP);
    const place = (p) => {
      if (!b[p]) return null;
      const [lng, lat] = b[p + 'C'].value.replace(/Point\(|\)/g, '').split(' ').map(Number);
      return { id: b[p].value.split('/').pop(), az: b[p + 'Az']?.value, en: b[p + 'En']?.value, ru: b[p + 'Ru']?.value, lat: +lat.toFixed(4), lng: +lng.toFixed(4) };
    };
    f.birth ??= place('bp');
    f.death ??= place('dp');
    facts.set(id, f);
  }
}

// 3. Accept a name match only when the dates (±3 years) or the century agree
const roman = { I: 1, V: 5, X: 10 };
const fromRoman = (s) => [...s].reduce((n, c, i, a) => (roman[c] < (roman[a[i + 1]] ?? 0) ? n - roman[c] : n + roman[c]), 0);
const centuries = (period) => (period?.match(/\b[IVX]+\b/g) ?? []).map(fromRoman);
const centuryOf = (y) => (y > 0 ? Math.floor((y - 1) / 100) + 1 : null);
function agrees(a, f) {
  if (!f.human) return false;
  const near = (x, y) => x != null && y != null && Math.abs(x - y) <= 3;
  if (near(a.bornYear, f.born) || near(a.diedYear, f.died)) return true;
  if (a.bornYear != null || a.diedYear != null) return false;
  const cs = centuries(a.period);
  return cs.length > 0 && [f.born, f.died].some((y) => y != null && cs.includes(centuryOf(y)));
}

// 4. Where a folk poet came from, for those with no birthplace on record: the place in their name
// ("Şəkili", "Dərbəndli") or in Salman Mümtaz's note on them. Set by hand in overrides.json as
// { "from": <Wikidata place>, "basis": "name" | "mumtaz" | "source" (a biography: "əslən … kəndindən") }; shown as an origin, not a birthplace.
const origins = new Map();
const fromIds = [...new Set(Object.values(overrides).map((o) => o.from).filter(Boolean))];
if (fromIds.length) {
  const q = `SELECT ?p ?c ?az ?en ?ru WHERE { VALUES ?p { ${fromIds.map((x) => 'wd:' + x).join(' ')} } ?p wdt:P625 ?c .
    OPTIONAL { ?p rdfs:label ?az FILTER(lang(?az) = "az") } OPTIONAL { ?p rdfs:label ?en FILTER(lang(?en) = "en") }
    OPTIONAL { ?p rdfs:label ?ru FILTER(lang(?ru) = "ru") } }`;
  const j = await get('https://query.wikidata.org/sparql?format=json&query=' + encodeURIComponent(q));
  for (const b of j.results.bindings) {
    const id = b.p.value.split('/').pop();
    if (origins.has(id)) continue;
    const [lng, lat] = b.c.value.replace(/Point\(|\)/g, '').split(' ').map(Number);
    origins.set(id, { id, az: b.az?.value, en: b.en?.value, ru: b.ru?.value, lat: +lat.toFixed(4), lng: +lng.toFixed(4) });
  }
  const lost = fromIds.filter((id) => !origins.has(id));
  if (lost.length) throw new Error(`no coordinates on Wikidata for ${lost.join(', ')}`);
}

const out = [];
let rejected = 0;
for (const a of authors) {
  const c = candidates.get(a.slug);
  const f = c && facts.get(c.qid);
  const ok = f && (c.how !== 'name' || agrees(a, f));
  if (c && !ok) rejected++;
  const o = overrides[a.slug] ?? {};
  let birth = o.birth ?? (ok ? f.birth : null);
  const death = o.death ?? (ok ? f.death : null);
  if (!birth && o.from) birth = { ...origins.get(o.from), from: o.basis };
  if (!birth && !death) continue;
  out.push({
    slug: a.slug, az: a.nameAz, en: a.nameEn, ru: a.nameRu,
    born: a.bornYear ?? (ok ? f.born : null), died: a.diedYear ?? (ok ? f.died : null),
    period: a.period, type: a.type, works: a.works,
    wikidata: ok ? c.qid : null, match: o.birth || o.death ? 'override' : birth?.from ? 'origin' : c.how,
    birth, death,
  });
}
await writeFile(new URL('authors.json', root), JSON.stringify(out, null, 1) + '\n');
const count = (k) => out.filter((x) => x[k]).length;
console.log(`${authors.length} authors · ${candidates.size} with a Wikidata candidate · ${rejected} name matches rejected`);
console.log(`${out.length} placed · ${count('birth')} with a birthplace · ${count('death')} with a place of death`);
console.log('by match:', Object.entries(Object.groupBy(out, (x) => x.match)).map(([k, v]) => `${k} ${v.length}`).join(', '));
