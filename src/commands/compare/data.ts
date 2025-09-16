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

import { Messages, Org, SfError } from '@salesforce/core';
import { SfCommand, Flags } from '@salesforce/sf-plugins-core';
import type { Interfaces } from '@oclif/core';

import { MetadataDiscoveryService } from '../../services/metadataDiscoveryService.js';
import { AggregateQueryBuilder } from '../../services/aggregateQueryBuilder.js';
import { compareData, type MetricComparisonRow, type SampleData } from '../../services/dataComparisonService.js';
import { exportComparisonToCsv } from '../../services/csvExporter.js';
import { exportComparisonToPdf } from '../../services/pdfExporter.js';
import { parseMetricTokens, validateMetricsAgainstDescribe, type ResolvedMetric } from '../../services/metricParser.js';

Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages('@salesforce/plugin-data-comparison', 'compare.data');

type FormatOption = 'table' | 'json' | 'csv' | 'pdf';

type OrgMetadata = {
  aliasOrUsername: string;
  orgId: string;
  apiVersion: string;
};

export type CompareDataResult = {
  object: string;
  metrics: MetricComparisonRow[];
  filters: {
    where?: string;
    sampleSize: number;
  };
  format: FormatOption;
  outputFile?: string;
  reportTitle?: string;
  metadataCacheMinutes: number;
  source: OrgMetadata;
  target: OrgMetadata;
  queries: {
    aggregate: string;
    sample?: string;
  };
  samples: SampleData;
};

export default class CompareData extends SfCommand<CompareDataResult> {
  public static readonly summary = messages.getMessage('summary');
  public static readonly description = messages.getMessage('description');
  public static readonly examples = messages.getMessages('examples');

  public static readonly flags = {
    'source-org': Flags.string({
      char: 's',
      summary: messages.getMessage('flags.source-org.summary'),
      required: true,
    }),
    'target-org': Flags.string({
      char: 't',
      summary: messages.getMessage('flags.target-org.summary'),
      required: true,
    }),
    object: Flags.string({
      summary: messages.getMessage('flags.object.summary'),
      required: true,
    }),
    metrics: Flags.string({
      char: 'm',
      summary: messages.getMessage('flags.metrics.summary'),
      multiple: true,
    }),
    where: Flags.string({
      summary: messages.getMessage('flags.where.summary'),
    }),
    'sample-size': Flags.integer({
      summary: messages.getMessage('flags.sample-size.summary'),
      default: 0,
      min: 0,
    }),
    'metadata-cache': Flags.integer({
      summary: messages.getMessage('flags.metadata-cache.summary'),
      default: 10,
      min: 0,
    }),
    format: Flags.string({
      summary: messages.getMessage('flags.format.summary'),
      options: ['table', 'json', 'csv', 'pdf'],
      default: 'table',
    }),
    'output-file': Flags.string({
      summary: messages.getMessage('flags.output-file.summary'),
    }),
    'report-title': Flags.string({
      summary: messages.getMessage('flags.report-title.summary'),
    }),
    timeout: Flags.integer({
      summary: messages.getMessage('flags.timeout.summary'),
      default: 10,
      min: 1,
    }),
    'api-version': Flags.string({
      summary: messages.getMessage('flags.api-version.summary'),
    }),
  } as const;

  public async run(): Promise<CompareDataResult> {
    const parsed = await this.parse(CompareData);
    const flags = parsed.flags as Interfaces.InferredFlags<typeof CompareData.flags>;
    const format = (flags.format ?? 'table') as FormatOption;
    const sourceAlias = flags['source-org'];
    const targetAlias = flags['target-org'];
    const outputFile = flags['output-file'];
    const reportTitle = flags['report-title'];
    const sampleSize = flags['sample-size'];
    const metadataCache = flags['metadata-cache'];
    const apiVersion = flags['api-version'];

    validateOutputConfiguration(format, outputFile);

    const [sourceOrg, targetOrg] = await Promise.all([
      Org.create({ aliasOrUsername: sourceAlias }),
      Org.create({ aliasOrUsername: targetAlias }),
    ]);

    const parsedMetrics = parseMetricTokens(flags.metrics);
    if (parsedMetrics.length === 0) {
      throw new SfError(`No metrics could be determined for object ${flags.object}.`, 'MissingMetrics');
    }

    const metadataServiceFor = (org: Org): MetadataDiscoveryService =>
      new MetadataDiscoveryService({ org, apiVersion, metadataCacheTtlMinutes: metadataCache });

    const [sourceDescribe, targetDescribe] = await Promise.all([
      metadataServiceFor(sourceOrg).describeSObject(flags.object),
      metadataServiceFor(targetOrg).describeSObject(flags.object),
    ]);

    const metrics = reconcileMetrics(
      validateMetricsAgainstDescribe(parsedMetrics, sourceDescribe, 'source org'),
      validateMetricsAgainstDescribe(parsedMetrics, targetDescribe, 'target org')
    );

    const queryPlan = new AggregateQueryBuilder({
      objectName: sourceDescribe.name,
      metrics,
      where: flags.where,
    }).build();

    const sampleQuery = buildSampleQuery(queryPlan, sampleSize);

    const [sourceOrgId, targetOrgId, sourceApiVersion, targetApiVersion, comparison] = await Promise.all([
      sourceOrg.getOrgId(),
      targetOrg.getOrgId(),
      resolveApiVersion(sourceOrg, apiVersion),
      resolveApiVersion(targetOrg, apiVersion),
      compareData({
        sourceOrg,
        targetOrg,
        plan: queryPlan,
        apiVersionOverride: apiVersion,
        sampleQuery,
      }),
    ]);

    this.log(`Validated ${metrics.length.toString()} metric(s) for object ${flags.object}.`);

    this.renderSummaryTable(comparison.metrics);

    if (sampleQuery) {
      this.log(
        `Fetched ${comparison.samples.source.length.toString()} sample record(s) from source org and ${comparison.samples.target.length.toString()} from target org.`
      );
    }

    const payload: CompareDataResult = {
      object: sourceDescribe.name,
      metrics: comparison.metrics,
      filters: {
        where: flags.where,
        sampleSize,
      },
      format,
      outputFile,
      reportTitle,
      metadataCacheMinutes: metadataCache,
      source: {
        aliasOrUsername: sourceAlias,
        orgId: sourceOrgId,
        apiVersion: sourceApiVersion,
      },
      target: {
        aliasOrUsername: targetAlias,
        orgId: targetOrgId,
        apiVersion: targetApiVersion,
      },
      queries: {
        aggregate: queryPlan.aggregateQuery,
        sample: sampleQuery,
      },
      samples: comparison.samples,
    } satisfies CompareDataResult;

    if (outputFile) {
      if (format === 'csv') {
        const csvPath = await exportComparisonToCsv(payload, outputFile);
        payload.outputFile = csvPath;
        this.logSuccess(`CSV report written to ${csvPath}`);
      } else if (format === 'pdf') {
        const pdfPath = await exportComparisonToPdf(payload, outputFile);
        payload.outputFile = pdfPath;
        this.logSuccess(`PDF report written to ${pdfPath}`);
      }
    }

    return payload;
  }

  private renderSummaryTable(rows: MetricComparisonRow[]): void {
    const formatter = new Intl.NumberFormat('en-US');

    const tableRows = rows.map((row) => ({
      metric: formatMetricLabel(row.metric),
      source: formatMetricValue(row.metric, row.sourceValue, formatter),
      target: formatMetricValue(row.metric, row.targetValue, formatter),
      difference: row.difference === null ? '—' : formatter.format(row.difference),
    }));

    this.table({
      data: tableRows,
      columns: [
        { key: 'metric', name: 'Metric' },
        { key: 'source', name: 'Source' },
        { key: 'target', name: 'Target' },
        { key: 'difference', name: 'Target - Source' },
      ],
    });
  }
}

const formatMetricLabel = (metric: ResolvedMetric): string => {
  switch (metric.kind) {
    case 'count':
      return 'COUNT(Id)';
    case 'fieldAggregate':
      return `${metric.fn.toUpperCase()}(${metric.field})`;
    case 'countDistinct':
      return `COUNT_DISTINCT(${metric.field})`;
    case 'ratio':
      return metric.label;
    case 'countIf':
      return `COUNT_IF(${metric.condition})`;
    case 'sumIf':
      return `SUM_IF(${metric.field}|${metric.condition})`;
  }
  const exhaustiveCheck: never = metric;
  return exhaustiveCheck;
};

const formatMetricValue = (
  metric: ResolvedMetric,
  value: number | string | null,
  formatter: Intl.NumberFormat
): string => {
  if (value === null) {
    return '—';
  }

  if (metric.valueType === 'number' && typeof value === 'number') {
    return formatter.format(value);
  }

  return String(value);
};

const validateOutputConfiguration = (format: FormatOption, outputFile?: string): void => {
  if ((format === 'csv' || format === 'pdf') && !outputFile) {
    throw new SfError('The --output-file flag is required when format is csv or pdf.', 'OutputFileRequired');
  }
};

const reconcileMetrics = (source: ResolvedMetric[], target: ResolvedMetric[]): ResolvedMetric[] => {
  if (source.length !== target.length) {
    throw new SfError(
      'Metric validation returned inconsistent results between source and target orgs.',
      'MetricValidationMismatch'
    );
  }

  return source.map((metric, index) => validateMetricPair(metric, target[index]));
};

const validateMetricPair = (metric: ResolvedMetric, targetMetric: ResolvedMetric): ResolvedMetric => {
  if (metric.kind !== targetMetric.kind) {
    throw new SfError('Metric kinds differ between org validations.', 'MetricValidationMismatch');
  }

  switch (metric.kind) {
    case 'count':
      return metric;
    case 'fieldAggregate':
      return validateFieldAggregate(metric, targetMetric);
    case 'countDistinct':
      return validateCountDistinct(metric, targetMetric);
    case 'ratio':
      return validateRatio(metric, targetMetric);
    case 'countIf':
      return validateConditional(metric, targetMetric);
    case 'sumIf':
      return validateConditional(metric, targetMetric);
    default: {
      const exhaustiveCheck: never = metric;
      return exhaustiveCheck;
    }
  }
};

const validateFieldAggregate = (
  metric: Extract<ResolvedMetric, { kind: 'fieldAggregate' }>,
  targetMetric: ResolvedMetric
): ResolvedMetric => {
  if (targetMetric.kind !== 'fieldAggregate' || metric.field !== targetMetric.field || metric.fn !== targetMetric.fn) {
    throw new SfError('Metric field validation differs between source and target orgs.', 'MetricValidationMismatch');
  }

  return metric;
};

const validateCountDistinct = (
  metric: Extract<ResolvedMetric, { kind: 'countDistinct' }>,
  targetMetric: ResolvedMetric
): ResolvedMetric => {
  if (targetMetric.kind !== 'countDistinct' || metric.field !== targetMetric.field) {
    throw new SfError('Metric field validation differs between source and target orgs.', 'MetricValidationMismatch');
  }

  return metric;
};

const validateRatio = (
  metric: Extract<ResolvedMetric, { kind: 'ratio' }>,
  targetMetric: ResolvedMetric
): ResolvedMetric => {
  if (targetMetric.kind !== 'ratio') {
    throw new SfError('Metric field validation differs between source and target orgs.', 'MetricValidationMismatch');
  }

  const numeratorMatches =
    metric.numerator.field === targetMetric.numerator.field && metric.numerator.fn === targetMetric.numerator.fn;
  const denominatorMatches =
    metric.denominator.field === targetMetric.denominator.field &&
    metric.denominator.fn === targetMetric.denominator.fn;

  if (!numeratorMatches || !denominatorMatches) {
    throw new SfError('Ratio metric validation differs between source and target orgs.', 'MetricValidationMismatch');
  }

  return metric;
};

const validateConditional = (
  metric: Extract<ResolvedMetric, { kind: 'countIf' | 'sumIf' }>,
  targetMetric: ResolvedMetric
): ResolvedMetric => {
  if (metric.kind === 'sumIf') {
    if (
      targetMetric.kind !== 'sumIf' ||
      metric.field !== targetMetric.field ||
      metric.condition !== targetMetric.condition
    ) {
      throw new SfError(
        'Conditional metric validation differs between source and target orgs.',
        'MetricValidationMismatch'
      );
    }
    return metric;
  }

  if (targetMetric.kind !== 'countIf' || metric.condition !== targetMetric.condition) {
    throw new SfError(
      'Conditional metric validation differs between source and target orgs.',
      'MetricValidationMismatch'
    );
  }

  return metric;
};

const buildSampleQuery = (plan: ReturnType<AggregateQueryBuilder['build']>, sampleSize: number): string | undefined => {
  if (sampleSize <= 0) {
    return undefined;
  }

  const fields = ['Id', ...plan.sampleFields];
  const uniqueFields = Array.from(new Set(fields));
  const whereClause = plan.whereClause ? ` WHERE ${plan.whereClause}` : '';
  return `SELECT ${uniqueFields.join(', ')} FROM ${plan.objectName}${whereClause} ORDER BY Id LIMIT ${sampleSize}`;
};

const resolveApiVersion = async (org: Org, override?: string): Promise<string> => {
  if (override) {
    return override;
  }

  const connection = await Promise.resolve(org.getConnection(override));
  return connection.getApiVersion();
};
