# Ədəbiyyat Xəritəsi · Literary Map

**[azadbilik.org/xerite](https://azadbilik.org/xerite/)**: where the authors on [kitabxana.az](https://kitabxana.az) were born and died, by century.

Part of [Azad Bilik](https://github.com/azadbilik), open knowledge about Azerbaijani culture and history.

## Data

| File | What it is |
|---|---|
| `data/kitabxana-authors.json` | The published authors on kitabxana.az: names, dates, period, Wikidata id, number of works |
| `data/overrides.json` | Hand corrections, keyed by author slug: `{ "wikidataId": "Q…" }`, or `birth` / `death` as `{ "az", "en", "lat", "lng" }` |
| `data/authors.json` | The output: each placed author with `birth` and `death` places and coordinates |

`node scripts/build.mjs` (Node 22+) rebuilds `data/authors.json` from Wikidata. Authors with a Wikidata id on kitabxana.az use it. The rest are looked up by name on Azerbaijani Wikipedia, and a match is kept only when the item is a person whose dates (±3 years) or century agree with the site's. `match` in the output says which way each author was placed.

Of 472 authors, 259 have a place. Most of the rest are folk poets known by a single name, with no dates or recorded place.

To refresh the author list, export it from the kitabxana database:

```sql
select json_agg(row_to_json(t) order by t.slug) from (
  select a.slug, a."nameAz", a."nameEn", a."nameRu", a."bornYear", a."bornYearApprox", a."diedYear", a."diedYearApprox",
         a.type, a.period, a."wikidataId", a."bioSources",
         (select count(*) from "Work" w where w."authorId" = a.id and w.status = 'PUBLISHED') as works
  from "Author" a where a.status = 'PUBLISHED') t;
```

## Corrections

A wrong or missing place? [Open an issue](https://github.com/azadbilik/xerite/issues), or better, fix it on Wikidata (the birthplace is P19, the place of death P20) and it comes through on the next build.

## Licence

Code: MIT. Data: CC0, like the Wikidata it comes from. Base map © OpenStreetMap contributors, tiles by OpenFreeMap.
