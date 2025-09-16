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

import { SfError } from '@salesforce/core';

type SimpleDescribeField = {
  name: string;
  label?: string;
  type: string;
  aggregatable?: boolean;
};

type SimpleDescribeSObjectResult = {
  name: string;
  fields: SimpleDescribeField[];
};

export type MetricKind = 'count' | 'sum' | 'avg' | 'min' | 'max';

export type ParsedMetric = {
  kind: MetricKind;
  field?: string;
};

export type MetricValueType = 'number' | 'date';

export type ResolvedMetric =
  | {
      kind: 'count';
      valueType: MetricValueType;
    }
  | {
      kind: Exclude<MetricKind, 'count'>;
      field: string;
      fieldType: string;
      label?: string;
      valueType: MetricValueType;
    };

const METRIC_PATTERN = /^(count|sum|avg|min|max)(?::(.+))?$/i;
const NUMERIC_TYPES = new Set(['double', 'currency', 'percent', 'int', 'integer', 'long']);
const DATE_TYPES = new Set(['date', 'datetime', 'time']);

const normalize = (value: string): string => value.trim();

export const parseMetricTokens = (tokens: string[] | undefined): ParsedMetric[] => {
  const input =
    tokens
      ?.flatMap((token) => token.split(','))
      .map((token) => token.trim())
      .filter((token) => token.length > 0) ?? [];

  if (input.length === 0) {
    return [{ kind: 'count' }];
  }

  return input.map((token) => {
    const match = METRIC_PATTERN.exec(token);
    if (!match) {
      throw new SfError(`Unsupported metric token "${token}".`, 'InvalidMetric');
    }

    const kind = match[1].toLowerCase() as MetricKind;
    const field = match[2]?.trim();

    if (kind === 'count' && field) {
      throw new SfError('COUNT metric must not specify a field.', 'InvalidMetric');
    }

    if (kind !== 'count' && (!field || field.length === 0)) {
      throw new SfError(`${kind.toUpperCase()} metric requires a field name.`, 'InvalidMetric');
    }

    return field ? ({ kind, field } satisfies ParsedMetric) : ({ kind } satisfies ParsedMetric);
  });
};

type DescribeField = SimpleDescribeSObjectResult['fields'][number];

const findField = (describe: SimpleDescribeSObjectResult, fieldName: string): DescribeField | undefined => {
  const lower = fieldName.toLowerCase();
  return describe.fields.find((field) => field.name.toLowerCase() === lower);
};

const ensureAggregatableField = (metric: ParsedMetric, field: DescribeField, orgLabel: string): void => {
  if (!field.aggregatable) {
    throw new SfError(
      `Field "${field.name}" in ${orgLabel} is not aggregatable for ${metric.kind.toUpperCase()} metric.`,
      'NonAggregatableField'
    );
  }

  if ((metric.kind === 'sum' || metric.kind === 'avg') && !NUMERIC_TYPES.has(field.type)) {
    throw new SfError(
      `Field "${field.name}" in ${orgLabel} must be numeric for ${metric.kind.toUpperCase()} metric.`,
      'UnsupportedFieldType'
    );
  }

  if (
    (metric.kind === 'min' || metric.kind === 'max') &&
    !(NUMERIC_TYPES.has(field.type) || DATE_TYPES.has(field.type))
  ) {
    throw new SfError(
      `Field "${field.name}" in ${orgLabel} must be numeric or date/time for ${metric.kind.toUpperCase()} metric.`,
      'UnsupportedFieldType'
    );
  }
};

const resolveValueType = (metricKind: MetricKind, fieldType?: string): MetricValueType => {
  if (metricKind === 'count' || metricKind === 'sum' || metricKind === 'avg') {
    return 'number';
  }

  if (!fieldType) {
    return 'number';
  }

  if (NUMERIC_TYPES.has(fieldType)) {
    return 'number';
  }

  if (DATE_TYPES.has(fieldType)) {
    return 'date';
  }

  return 'number';
};

export const validateMetricsAgainstDescribe = (
  metrics: ParsedMetric[],
  describe: SimpleDescribeSObjectResult,
  orgLabel: string
): ResolvedMetric[] => {
  const resolved: ResolvedMetric[] = [];

  for (const metric of metrics) {
    if (metric.kind === 'count') {
      resolved.push({
        kind: 'count',
        valueType: resolveValueType('count'),
      });
      continue;
    }

    const fieldName = normalize(metric.field ?? '');
    const field = findField(describe, fieldName);

    if (!field) {
      throw new SfError(`Field "${fieldName}" not found on object ${describe.name} in ${orgLabel}.`, 'FieldNotFound');
    }

    ensureAggregatableField(metric, field, orgLabel);

    resolved.push({
      kind: metric.kind,
      field: field.name,
      fieldType: field.type,
      label: field.label ?? field.name,
      valueType: resolveValueType(metric.kind, field.type),
    });
  }

  return resolved;
};
