# Data Comparison Plugin

Compare aggregated Salesforce record data across two authenticated orgs without copying full datasets. The `compare:data` command dynamically builds safe SOQL, executes aggregate queries (COUNT/SUM/AVG/MIN/MAX), optionally samples matching rows, and exports reconciliation reports.

## Overview

- Validate that key business metrics stay in sync between production and sandboxes or between environments.
- Build aggregate queries on demand by discovering object metadata at runtime.
- Export results as terminal tables, JSON payloads, CSV files, or lightweight PDFs for auditors.
- Cache describe metadata locally to reduce repeated API calls.

## Installation

Install the plugin into the Salesforce CLI (`sf`):

```bash
sf plugins install @salesforce/plugin-data-comparison
```

To upgrade to the latest published version:

```bash
sf plugins update @salesforce/plugin-data-comparison
```

Verify the installation:

```bash
sf plugins | grep data-comparison
```

## Usage

### Compare SObject Metrics

Run `sf compare:data` with the source and target org aliases, the object API name, and any metrics you want to reconcile.

```bash
sf compare:data \
  --source-org prod \
  --target-org staging \
  --object Opportunity \
  --metrics count --metrics sum:Amount --metrics avg:Amount \
  --where "StageName = 'Closed Won'" \
  --sample-size 5
```

Key flags:

| Flag                           | Description                                                                                                                                                                                                                                                                                                         |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--source-org`, `--target-org` | Aliases/usernames of the baseline and comparison orgs (required).                                                                                                                                                                                                                                                   |
| `--object`                     | API name of the SObject to compare (required).                                                                                                                                                                                                                                                                      |
| `--metrics`                    | Metrics to compute (defaults to `count`). Supported values: `count`, `count-distinct:<field>`, `sum:<field>`, `avg:<field>`, `min:<field>`, `max:<field>`, `median:<field>`, `stddev:<field>`, `variance:<field>`, `ratio:sum:<numerator>/sum:<denominator>`, `count-if:<condition>`, `sum-if:<field>:<condition>`. |
| `--where`                      | Optional filter applied to both org queries (omit the `WHERE` keyword).                                                                                                                                                                                                                                             |
| `--sample-size`                | Number of raw rows to fetch for spot checks. Set to `0` to skip.                                                                                                                                                                                                                                                    |
| `--metadata-cache`             | Minutes to reuse cached describe metadata (default `10`, `0` disables caching).                                                                                                                                                                                                                                     |
| `--format`                     | Output format: `table` (default), `json`, `csv`, or `pdf`.                                                                                                                                                                                                                                                          |
| `--output-file`                | Destination path for CSV/PDF exports (required when `--format` is `csv` or `pdf`).                                                                                                                                                                                                                                  |
| `--report-title`               | Optional custom title for PDF output.                                                                                                                                                                                                                                                                               |
| `--timeout`                    | Query timeout in minutes (defaults to `10`).                                                                                                                                                                                                                                                                        |

### Export CSV

```bash
sf compare:data \
  --source-org prod \
  --target-org staging \
  --object Account \
  --metrics count --metrics sum:AnnualRevenue \
  --format csv \
  --output-file ./reports/account-compare.csv
```

### Export PDF

```bash
sf compare:data \
  --source-org prod \
  --target-org staging \
  --object Account \
  --metrics count --metrics sum:AnnualRevenue \
  --format pdf \
  --output-file ./reports/account-compare.pdf \
  --report-title "Account Reconciliation"
```

### JSON for Automation

```bash
sf compare:data \
  --source-org prod \
  --target-org staging \
  --object Account \
  --metrics count --metrics max:LastModifiedDate \
  --format json > comparison.json
```

See the [quickstart](docs/quickstart.md) for an end-to-end walkthrough, including metadata discovery and caching tips.

## Known Limitations

- Aggregate metrics respect Salesforce rules (for example, `SUM` ignores null values and currency handling mirrors the org configuration).
- Sampling is best-effort and limited to records returned by synchronous SOQL; bulk sampling is not yet available.
- The PDF exporter uses a minimal embedded Helvetica font; advanced formatting and localization are not supported yet.
- Multi-currency comparisons require metrics to use fields that share the same currency or rely on converted values provided by the org.

## License Notices

All direct dependencies are distributed under the Apache-2.0 license. Review individual packages in `package.json` if your compliance process requires additional disclosure.

## Contributing and Support

Please report issues and feature requests at https://github.com/forcedotcom/cli/issues. Contribution guidelines and tooling instructions are unchanged from the template; see [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md) and the repository wiki for more details.
