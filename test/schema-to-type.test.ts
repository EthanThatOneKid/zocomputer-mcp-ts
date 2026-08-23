import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { compileArgsInterface, argsInterfaceName } from '../scripts/lib.js';

// Each compile() call runs a Prettier pass, so assertions here are semantic
// (substring/regex based). Exact byte-level output is locked by the golden
// fixture in test/generate.test.ts.

describe('compileArgsInterface', () => {
  it('emits a named interface with required and optional members', async () => {
    const src = await compileArgsInterface(
      {
        type: 'object',
        properties: { query: { type: 'string' }, limit: { type: 'integer' } },
        required: ['query'],
        additionalProperties: false,
      },
      'GrepSearchArgs',
    );
    assert.match(src, /export interface GrepSearchArgs/);
    assert.match(src, /query: string;/);
    assert.match(src, /limit\?: number;/);
  });

  it('maps enums to literal unions', async () => {
    const src = await compileArgsInterface(
      {
        type: 'object',
        properties: {
          orientation: { type: 'string', enum: ['landscape', 'portrait'] },
        },
        additionalProperties: false,
      },
      'GenerateVideoArgs',
    );
    assert.match(src, /orientation\?: ("landscape" \| "portrait"|"portrait" \| "landscape")/);
  });

  it('maps arrays of primitives', async () => {
    const src = await compileArgsInterface(
      {
        type: 'object',
        properties: { tags: { type: 'array', items: { type: 'string' } } },
        required: ['tags'],
        additionalProperties: false,
      },
      'TagArgs',
    );
    assert.match(src, /tags: string\[\];/);
  });

  it('inlines nested objects', async () => {
    const src = await compileArgsInterface(
      {
        type: 'object',
        properties: {
          filter: {
            type: 'object',
            properties: { tags: { type: 'array', items: { type: 'string' } } },
            required: ['tags'],
          },
        },
        required: ['filter'],
        additionalProperties: false,
      },
      'FilterArgs',
    );
    assert.match(src, /filter:\s*\{/);
    assert.match(src, /tags: string\[\]/);
  });

  it('maps anyOf branches into a union member type', async () => {
    const src = await compileArgsInterface(
      {
        type: 'object',
        properties: {
          target: { anyOf: [{ type: 'string' }, { type: 'integer' }] },
        },
        required: ['target'],
        additionalProperties: false,
      },
      'TargetArgs',
    );
    assert.match(src, /target: string \| number|target:\s*\n?\s*\|\s*number|string \| number/);
  });

  it('produces an empty interface for a property-less schema', async () => {
    const src = await compileArgsInterface(
      { type: 'object', properties: {}, additionalProperties: false },
      'ConnectTelegramArgs',
    );
    assert.match(src, /export interface ConnectTelegramArgs/);
  });

  it('tolerates a missing schema by emitting an empty interface', async () => {
    const src = await compileArgsInterface(undefined, 'LooseArgs');
    assert.match(src, /export interface LooseArgs/);
  });

  it('strips nested titles instead of emitting dangling named types', async () => {
    const src = await compileArgsInterface(
      {
        type: 'object',
        properties: {
          output_schema: {
            title: 'FlatOutputSchema',
            type: 'object',
            properties: { type: { const: 'object', title: 'Type', type: 'string' } },
            required: ['type'],
          },
        },
        additionalProperties: false,
      },
      'UseWebpageArgs',
    );
    assert.doesNotMatch(src, /FlatOutputSchema/);
    assert.match(src, /output_schema\?: \{/);
  });
});

describe('argsInterfaceName', () => {
  it('converts camelCase method names to PascalCase Args names', () => {
    assert.equal(argsInterfaceName('webSearch'), 'WebSearchArgs');
    assert.equal(argsInterfaceName('_3dRender'), '_3dRenderArgs');
  });

  it('falls back to _Args when nothing survives', () => {
    assert.equal(argsInterfaceName('_'), '_Args');
  });
});
