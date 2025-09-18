# Quickstart: Compare Salesforce Data Between Orgs

This guide walks through using the Data Comparison plugin to reconcile metrics across two orgs. It assumes you already authenticated with the Salesforce CLI (`sf org login ...`) and assigned aliases for the orgs you want to compare.

## 1. Confirm Metadata Access

1. List available metadata types in each org to make sure the target object is accessible:
   ```bash
   sf org list metadata-types --target-org prod
   sf org list metadata-types --target-org staging
   ```
2. Describe the object to understand available fields and their aggregate support:
   ```bash
   sf org list metadata --metadata-type CustomObject --target-org prod | grep Account
   ```

The plugin performs these describes automatically, but running them once helps validate permissions. Results are cached under `~/.sfdata/sf-data-comparison/` and reused for 10 minutes by default.

## 2. Run an Initial Comparison

```bash
sf compare:data \
  --source-org prod \
  --target-org staging \
  --object Account \
  --metrics count --metrics sum:AnnualRevenue --metrics max:LastModifiedDate
```

The command prints a table of aggregate deltas and returns JSON when you add `--json`.

## 3. Filter and Sample Records

Add a filter and include sample rows to inspect outliers:

```bash
sf compare:data \
  --source-org prod \
  --target-org staging \
  --object Opportunity \
  --metrics count --metrics sum:Amount \
  --where "StageName = 'Closed Won'" \
  --sample-size 5
```

Sampled records are sorted by `Id` to make diffing easier.

## 4. Export Reports

- CSV export:
  ```bash
  sf compare:data ... --format csv --output-file ./reports/opportunity.csv
  ```
- PDF export:
  ```bash
  sf compare:data ... --format pdf --report-title "Quarter Close" --output-file ./reports/opportunity.pdf
  ```

## 5. Refresh Metadata Cache

Pass `--metadata-cache 0` to bypass the cache, or delete the cache file:

```bash
rm ~/.sfdata/sf-data-comparison/metadata-cache.json
sf compare:data --metadata-cache 0 ...
```

## 6. Automate

The JSON output is designed for pipelines. Example: fail a CI step when the COUNT difference exceeds a threshold.

```bash
result=$(sf compare:data --format json ...)
count_diff=$(echo "$result" | jq '.metrics[] | select(.metric.kind=="count") | .difference')
if [ "${count_diff#-}" -gt 5 ]; then
  echo "Opportunity counts diverge by more than 5."
  exit 1
fi
```

That’s it. See `sf compare:data --help` for the full flag list and explore the repository for implementation details.

## 7. Example Scenarios

### Opportunity Pipeline Health

```bash
sf compare data --source-org sfai \
  --target-org agentforce \
  --object Opportunity \
  --metrics 'count,sum:Amount,ratio:sum:Amount/avg:Amount,min:CloseDate,max:CloseDate' \
  --where "FiscalYear = 2024"
```

```
Validated 5 metric(s) for object Opportunity.
┌─────────────────────────┬────────────┬────────────┬─────────────────┐
│ Metric                  │ Source     │ Target     │ Target - Source │
├─────────────────────────┼────────────┼────────────┼─────────────────┤
│ COUNT(Id)               │ 15         │ 15         │ 0               │
│ SUM(Amount)             │ 826,964.26 │ 826,964.26 │ 0               │
│ SUM(Amount)/AVG(Amount) │ 15         │ 15         │ -0              │
│ MIN(CloseDate)          │ 2024-01-01 │ 2024-01-01 │ —               │
│ MAX(CloseDate)          │ 2024-12-06 │ 2024-12-06 │ —               │
└─────────────────────────┴────────────┴────────────┴─────────────────┘
```

### High-Priority Case SLA Snapshot

```bash
sf compare data --source-org sfai \
  --target-org agentforce \
  --object Case \
  --metrics 'count,count-distinct:OwnerId' \
  --metrics 'sum-if:TimeToClose__c:Status="Closed"' \
  --where "Priority = 'High'" \
  --format csv --output-file reports/high-priority-cases.csv \
  --metadata-cache=0
```

```
Validated 3 metric(s) for object Case.
┌──────────────────────────────────────────┬────────┬────────┬─────────────────┐
│ Metric                                   │ Source │ Target │ Target - Source │
├──────────────────────────────────────────┼────────┼────────┼─────────────────┤
│ COUNT(Id)                                │ 38     │ 6      │ -32             │
│ COUNT_DISTINCT(OwnerId)                  │ 2      │ 1      │ -1              │
│ SUM_IF(TimeToClose__c|Status = 'Closed') │ -2,484 │ -2,484 │ 0               │
└──────────────────────────────────────────┴────────┴────────┴─────────────────┘
CSV report written to /Users/unizhu/Downloads/test/sfai/reports/high-priority-cases.csv
```

## 8. Advanced Metrics

- Distinct counts: `--metrics count-distinct:Id`
- Ratios: `--metrics ratio:sum:Amount/avg:Amount`
- Conditional aggregations: `--metrics count-if:StageName = 'Closed Won'` or `--metrics sum-if:Amount:StageName = 'Closed Won'`
- Future: statistical aggregates (median, stddev, variance) once supported by SOQL or via CRM Analytics integration
