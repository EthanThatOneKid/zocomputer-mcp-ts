import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeMethodName } from '@scripts/lib.js';

describe('sanitizeMethodName', () => {
  it('converts snake_case to camelCase', () => {
    assert.equal(sanitizeMethodName('set_active_persona'), 'setActivePersona');
    assert.equal(sanitizeMethodName('get_space_route_history'), 'getSpaceRouteHistory');
  });

  it('leaves single words and already-camelCase names alone', () => {
    assert.equal(sanitizeMethodName('bash'), 'bash');
    assert.equal(sanitizeMethodName('webSearch'), 'webSearch');
  });

  it('lowercases each segment', () => {
    assert.equal(sanitizeMethodName('get_URL_data'), 'getUrlData');
  });

  it('splits on any non-alphanumeric run', () => {
    assert.equal(sanitizeMethodName('foo--bar!baz'), 'fooBarBaz');
  });

  it('prefixes an underscore when the result starts with a digit', () => {
    assert.equal(sanitizeMethodName('3d_render'), '_3dRender');
  });

  it('returns a placeholder when nothing survives sanitization', () => {
    assert.equal(sanitizeMethodName('---'), '_');
    assert.equal(sanitizeMethodName(''), '_');
  });
});
