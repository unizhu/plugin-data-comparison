/*
 * Copyright 2025, Salesforce, Inc.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { promises as fs } from 'node:fs';
import { dirname, resolve } from 'node:path';

import type { CompareDataResult } from '../commands/compare/data.js';

const csvValue = (value: unknown): string => {
  if (value === null || value === undefined) {
    return '';
  }

  const stringValue = String(value);
  if (stringValue.includes('"')) {
    return `"${stringValue.replace(/"/g, '""')}"`;
  }

  if (stringValue.includes(',') || stringValue.includes('\n')) {
    return `"${stringValue}"`;
  }

  return stringValue;
};

const csvRow = (columns: readonly unknown[]): string => columns.map(csvValue).join(',');

const formatMetricLabel = (comparison: CompareDataResult['metrics'][number]): string => {
  const metric = comparison.metric;
  if (metric.kind === 'count') {
    return 'COUNT()';
  }

  return `${metric.kind.toUpperCase()}(${metric.field})`;
};

const collectSampleColumns = (samples: Array<Record<string, unknown>>): string[] => {
  const columnSet = new Set<string>();
  for (const row of samples) {
    Object.keys(row).forEach((key) => columnSet.add(key));
  }

  const columns = Array.from(columnSet);
  columns.sort();

  if (columns.includes('Id')) {
    columns.splice(columns.indexOf('Id'), 1);
    columns.unshift('Id');
  }

  return columns;
};

const writeSampleSection = (lines: string[], label: string, samples: Array<Record<string, unknown>>): void => {
  if (samples.length === 0) {
    return;
  }

  lines.push('');
  lines.push(csvRow([label]));

  const columns = collectSampleColumns(samples);
  if (columns.length === 0) {
    return;
  }

  lines.push(csvRow(columns));

  for (const record of samples) {
    const values = columns.map((column) => record[column] ?? '');
    lines.push(csvRow(values));
  }
};

export const exportComparisonToCsv = async (result: CompareDataResult, outputFile: string): Promise<string> => {
  const now = new Date().toISOString();
  const metricsSummary = result.metrics.map((metric) => formatMetricLabel(metric)).join(' | ');

  const lines: string[] = [];
  lines.push(csvRow(['Report Title', result.reportTitle ?? 'Salesforce Data Comparison']));
  lines.push(csvRow(['Generated At', now]));
  lines.push(csvRow(['Source Org', `${result.source.aliasOrUsername} (${result.source.orgId})`]));
  lines.push(csvRow(['Target Org', `${result.target.aliasOrUsername} (${result.target.orgId})`]));
  lines.push(csvRow(['Object', result.object]));
  lines.push(csvRow(['Metrics', metricsSummary]));
  lines.push(csvRow(['Filter', result.filters.where ?? '']));
  lines.push(csvRow(['Sample Size', result.filters.sampleSize]));
  lines.push('');

  lines.push(csvRow(['Metric', 'Source', 'Target', 'Difference']));
  for (const comparison of result.metrics) {
    const formattedDifference = comparison.difference ?? '';
    lines.push(
      csvRow([formatMetricLabel(comparison), comparison.sourceValue, comparison.targetValue, formattedDifference])
    );
  }

  writeSampleSection(lines, 'Sample Records - Source', result.samples.source);
  writeSampleSection(lines, 'Sample Records - Target', result.samples.target);

  const resolvedPath = resolve(outputFile);
  await fs.mkdir(dirname(resolvedPath), { recursive: true });
  await fs.writeFile(resolvedPath, `${lines.join('\n')}\n`, 'utf8');

  return resolvedPath;
};

export type CsvExporter = typeof exportComparisonToCsv;
