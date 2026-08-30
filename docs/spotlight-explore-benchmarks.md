# Spotlight Explore query benchmarks

Benchmark scope: evidence `2`, partition `1`, 231,820
`macos.spotlight.item` objects. Measurements were taken against a disposable
copy of the relevant `artifact_objects` rows on 2026-08-20; the evidence
database was opened read-only and was not changed.

| Operation | Existing indexes | V5 derived indexes |
| --- | ---: | ---: |
| Updated-time page (50 rows) | 6.57 s | < 0.01 s |
| Content-type facet | 9.15 s | 0.02–0.06 s |
| Kind facet | 9.06 s | 0.02 s |
| Path-root facet | 8.56 s | 0.02 s |
| Name/path substring count (`safari`, 124 hits) | 2.67 s | 0.04 s |
| Name/path page (`safari`, 50 rows) | not interactive | 0.01 s |
| Filtered page at offset 50,000 | not measured | 0.01 s |

The seven partial expression indexes took approximately 10 seconds to build.
They fixed sorting and facets, but a true `%substring%` name/path search still
took 1.53 seconds. That result met the plan's threshold for adding FTS5: a
trigram search index took approximately 2.4 seconds to populate and preserves
substring semantics.

The final search query uses an FTS row-id subquery rather than a direct join:

```sql
ao.id IN (
  SELECT rowid
  FROM spotlight_explore_fts
  WHERE spotlight_explore_fts MATCH ?
    AND evidence_id = ? AND partition_id = ?
)
```

`EXPLAIN QUERY PLAN` then combines the materialized FTS row IDs with
`idx_spotlight_explore_updated` (or the selected facet/sort expression index).
A direct FTS join caused SQLite to scan the 231,820-row updated index as the
outer loop and took roughly 0.8 seconds, so that query shape is intentionally
not used.

All V5 queries remain evidence/partition scoped. Full JSON is selected only for
the current page (maximum 250 rows), and file-path resolution is one indexed
`system_files.absolute_path IN (...)` lookup over that page.
