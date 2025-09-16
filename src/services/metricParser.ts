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

export type MetricValueType = 'number' | 'date';

export type SimpleAggregateFunction = 'sum' | 'avg' | 'min' | 'max' | 'median' | 'stddev' | 'variance';

export type ParsedSimpleAggregate = {
  fn: SimpleAggregateFunction;
  field: string;
};

export type ParsedMetric =
  | { kind: 'count' }
  | { kind: 'fieldAggregate'; aggregate: ParsedSimpleAggregate }
  | { kind: 'countDistinct'; field: string }
  | { kind: 'ratio'; numerator: ParsedSimpleAggregate; denominator: ParsedSimpleAggregate; label?: string }
  | { kind: 'countIf'; condition: string }
  | { kind: 'sumIf'; field: string; condition: string };

export type ResolvedFieldAggregateMetric = {
  kind: 'fieldAggregate';
  fn: SimpleAggregateFunction;
  field: string;
  fieldType: string;
  label?: string;
  valueType: MetricValueType;
};

export type ResolvedMetric =
  | { kind: 'count'; valueType: MetricValueType }
  | ResolvedFieldAggregateMetric
  | { kind: 'countDistinct'; field: string; fieldType: string; label?: string; valueType: MetricValueType }
  | {
      kind: 'ratio';
      label: string;
      numerator: ResolvedFieldAggregateMetric;
      denominator: ResolvedFieldAggregateMetric;
      valueType: MetricValueType;
    }
  | { kind: 'countIf'; condition: string; valueType: MetricValueType }
  | { kind: 'sumIf'; field: string; fieldType: string; condition: string; label?: string; valueType: MetricValueType };

const SIMPLE_AGGREGATES: SimpleAggregateFunction[] = ['sum', 'avg', 'min', 'max', 'median', 'stddev', 'variance'];
const NUMERIC_TYPES = new Set(['double', 'currency', 'percent', 'int', 'integer', 'long']);
const DATE_TYPES = new Set(['date', 'datetime', 'time']);

const normalize = (value: string): string => value.trim();

const parseSimpleAggregateToken = (token: string): ParsedSimpleAggregate => {
  const separatorIndex = token.indexOf(':');
  if (separatorIndex === -1) {
    throw new SfError(`Aggregate metric "${token}" must specify a field.`, 'InvalidMetric');
  }

  const fn = token.slice(0, separatorIndex).toLowerCase() as SimpleAggregateFunction;
  if (!SIMPLE_AGGREGATES.includes(fn)) {
    throw new SfError(`Unsupported aggregate function "${token.slice(0, separatorIndex)}".`, 'InvalidMetric');
  }

  const field = normalize(token.slice(separatorIndex + 1));
  if (!field) {
    throw new SfError(`Aggregate metric "${token}" must specify a non-empty field.`, 'InvalidMetric');
  }

  return { fn, field } satisfies ParsedSimpleAggregate;
};

export const parseMetricTokens = (tokens: string[] | undefined): ParsedMetric[] => {
  const input =
    tokens
      ?.flatMap((token) => token.split(','))
      .map((token) => token.trim())
      .filter((token) => token.length > 0) ?? [];

  if (input.length === 0) {
    return [{ kind: 'count' }];
  }

  return input.map((token) => parseMetricToken(token));
};

const parseMetricToken = (token: string): ParsedMetric => {
  const lower = token.toLowerCase();

  if (lower === 'count') {
    return { kind: 'count' };
  }

  if (lower.startsWith('count-distinct:')) {
    const field = normalize(token.slice('count-distinct:'.length));
    if (!field) {
      throw new SfError('count-distinct metric requires a field name.', 'InvalidMetric');
    }
    return { kind: 'countDistinct', field } satisfies ParsedMetric;
  }

  if (lower.startsWith('ratio:')) {
    const body = token.slice('ratio:'.length);
    const slashIndex = body.indexOf('/');
    if (slashIndex === -1) {
      throw new SfError(`ratio metric "${token}" must provide numerator and denominator.`, 'InvalidMetric');
    }

    const numeratorToken = normalize(body.slice(0, slashIndex));
    const denominatorToken = normalize(body.slice(slashIndex + 1));

    const numerator = parseSimpleAggregateToken(numeratorToken);
    const denominator = parseSimpleAggregateToken(denominatorToken);

    return { kind: 'ratio', numerator, denominator } satisfies ParsedMetric;
  }

  if (lower.startsWith('count-if:')) {
    const condition = normalize(token.slice('count-if:'.length));
    if (!condition) {
      throw new SfError('count-if metric requires a condition expression.', 'InvalidMetric');
    }
    return { kind: 'countIf', condition } satisfies ParsedMetric;
  }

  if (lower.startsWith('sum-if:')) {
    const body = token.slice('sum-if:'.length);
    const separatorIndex = body.indexOf(':');
    if (separatorIndex === -1) {
      throw new SfError('sum-if metric must follow sum-if:<field>:<condition>.', 'InvalidMetric');
    }

    const field = normalize(body.slice(0, separatorIndex));
    const condition = normalize(body.slice(separatorIndex + 1));
    if (!field || !condition) {
      throw new SfError('sum-if metric requires both field and condition.', 'InvalidMetric');
    }

    return { kind: 'sumIf', field, condition } satisfies ParsedMetric;
  }

  return { kind: 'fieldAggregate', aggregate: parseSimpleAggregateToken(token) } satisfies ParsedMetric;
};

export const validateMetricsAgainstDescribe = (
  metrics: ParsedMetric[],
  describe: SimpleDescribeSObjectResult,
  orgLabel: string
): ResolvedMetric[] => metrics.map((metric) => resolveMetric(metric, describe, orgLabel));

const resolveMetric = (
  metric: ParsedMetric,
  describe: SimpleDescribeSObjectResult,
  orgLabel: string
): ResolvedMetric => {
  switch (metric.kind) {
    case 'count':
      return { kind: 'count', valueType: 'number' } satisfies ResolvedMetric;
    case 'countDistinct': {
      const field = ensureField(describe, metric.field, orgLabel);
      ensureAggregatableField({ fn: 'sum', field: field.name }, field, orgLabel);
      return {
        kind: 'countDistinct',
        field: field.name,
        fieldType: field.type,
        label: field.label ?? field.name,
        valueType: 'number',
      } satisfies ResolvedMetric;
    }
    case 'fieldAggregate':
      return resolveSimpleAggregate(metric.aggregate, describe, orgLabel);
    case 'ratio': {
      const numerator = resolveSimpleAggregate(metric.numerator, describe, orgLabel);
      const denominator = resolveSimpleAggregate(metric.denominator, describe, orgLabel);

      return {
        kind: 'ratio',
        label: `${metric.numerator.fn.toUpperCase()}(${numerator.field})/${metric.denominator.fn.toUpperCase()}(${
          denominator.field
        })`,
        numerator,
        denominator,
        valueType: 'number',
      } satisfies ResolvedMetric;
    }
    case 'countIf': {
      if (!metric.condition) {
        throw new SfError('count-if requires a condition expression.', 'InvalidMetric');
      }
      return { kind: 'countIf', condition: metric.condition, valueType: 'number' } satisfies ResolvedMetric;
    }
    case 'sumIf': {
      const field = ensureField(describe, metric.field, orgLabel);
      if (!NUMERIC_TYPES.has(field.type)) {
        throw new SfError(
          `Field "${field.name}" in ${orgLabel} must be numeric for SUM-IF metric.`,
          'UnsupportedFieldType'
        );
      }
      return {
        kind: 'sumIf',
        field: field.name,
        fieldType: field.type,
        condition: metric.condition,
        label: field.label ?? field.name,
        valueType: 'number',
      } satisfies ResolvedMetric;
    }
    default:
      throw new SfError('Unsupported metric definition.', 'InvalidMetric');
  }
};

const resolveSimpleAggregate = (
  aggregate: ParsedSimpleAggregate,
  describe: SimpleDescribeSObjectResult,
  orgLabel: string
): ResolvedFieldAggregateMetric => {
  const field = ensureField(describe, aggregate.field, orgLabel);
  ensureAggregatableField(aggregate, field, orgLabel);

  return {
    kind: 'fieldAggregate',
    fn: aggregate.fn,
    field: field.name,
    fieldType: field.type,
    label: field.label ?? field.name,
    valueType: resolveValueType(aggregate.fn, field.type),
  } satisfies ResolvedFieldAggregateMetric;
};

const ensureField = (
  describe: SimpleDescribeSObjectResult,
  fieldName: string,
  orgLabel: string
): SimpleDescribeField => {
  const normalized = normalize(fieldName);
  const field = describe.fields.find((candidate) => candidate.name.toLowerCase() === normalized.toLowerCase());
  if (!field) {
    throw new SfError(`Field "${fieldName}" not found on object ${describe.name} in ${orgLabel}.`, 'FieldNotFound');
  }
  return field;
};

const ensureAggregatableField = (metric: ParsedSimpleAggregate, field: SimpleDescribeField, orgLabel: string): void => {
  if (!field.aggregatable) {
    throw new SfError(
      `Field "${field.name}" in ${orgLabel} is not aggregatable for ${metric.fn.toUpperCase()} metric.`,
      'NonAggregatableField'
    );
  }

  if (
    (metric.fn === 'sum' ||
      metric.fn === 'avg' ||
      metric.fn === 'median' ||
      metric.fn === 'stddev' ||
      metric.fn === 'variance') &&
    !NUMERIC_TYPES.has(field.type)
  ) {
    throw new SfError(
      `Field "${field.name}" in ${orgLabel} must be numeric for ${metric.fn.toUpperCase()} metric.`,
      'UnsupportedFieldType'
    );
  }

  if ((metric.fn === 'min' || metric.fn === 'max') && !(NUMERIC_TYPES.has(field.type) || DATE_TYPES.has(field.type))) {
    throw new SfError(
      `Field "${field.name}" in ${orgLabel} must be numeric or date/time for ${metric.fn.toUpperCase()} metric.`,
      'UnsupportedFieldType'
    );
  }
};

const resolveValueType = (fn: SimpleAggregateFunction, fieldType: string): MetricValueType => {
  if (fn === 'min' || fn === 'max') {
    if (DATE_TYPES.has(fieldType)) {
      return 'date';
    }
  }

  return 'number';
};
