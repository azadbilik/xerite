# Ədəbiyyat Xəritəsi · Literary Map

**[azadbilik.org/xerite](https://azadbilik.org/xerite/)**: where the authors on [kitabxana.az](https://kitabxana.az) were born and died, by century.

Part of [Azad Bilik](https://github.com/azadbilik), open knowledge about Azerbaijani culture and history.

## Data

| File | What it is |
|---|---|
| `data/kitabxana-authors.json` | The published authors on kitabxana.az: names, dates, period, Wikidata id, number of works |
| `data/overrides.json` | Hand corrections, keyed by author slug: `{ "wikidataId": "Q…" }`; `birth` / `death` as `{ "az", "en", "lat", "lng" }`; or `{ "from": "Q…", "basis": "name" \| "mumtaz" }` for where a folk poet came from (below) |
| `data/authors.json` | The output: each placed author with `birth` and `death` places and coordinates |

`node scripts/build.mjs` (Node 22+) rebuilds `data/authors.json` from Wikidata. Authors with a Wikidata id on kitabxana.az use it. The rest are looked up by name on Azerbaijani Wikipedia, and a match is kept only when the item is a person whose dates (±3 years) or century agree with the site's. `match` in the output says which way each author was placed.

Years are taken from Wikidata only when it knows them to the year; a date recorded as "19th century" is not read as 1900.

**Origins.** Many folk poets in Salman Mümtaz's «El şairləri» (1927–28) have no recorded birthplace, but their name or Mümtaz's note says where they came from: Şəkili Hatim is "Hatim of Shaki", and Mümtaz writes that Molla Məhəmməd Hidəci was born in Hidəc near Zanjan. Those are set by hand in `overrides.json` with `basis` `name` or `mumtaz`, come out as `birth` with a `from` field and `match: "origin"`, and the map labels them so. Only unambiguous towns and villages are used: tribe names (Bayatlı, Əfşarlı), regions (Qarabağlı, Şirvanlı) and village names shared by several places (Kəbirli, Sarıcalı) are left out.

Link to one author with `?author=<slug>` (kitabxana's slug): the map opens on their place with their name marked. kitabxana.az links its author pages this way.

Of 471 authors, 303 have a place (41 of them by origin). Most of the rest are folk poets known by a single name, with no dates or known place.

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
