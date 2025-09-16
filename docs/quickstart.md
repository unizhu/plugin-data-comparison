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
