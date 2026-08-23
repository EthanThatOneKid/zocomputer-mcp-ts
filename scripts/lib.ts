// Codegen support library for scripts/generate.ts.
//
// JSON Schema → TypeScript conversion is delegated to the canonical
// json-schema-to-typescript package (bcherny) rather than a hand-rolled
// walker, so the full spec ($ref, allOf/oneOf, patternProperties, ...) is
// handled by battle-tested code. sanitizeMethodName() maps MCP tool names
// (typically snake_case) to camelCase method identifiers.

import { compile, type JSONSchema } from 'json-schema-to-typescript';

const COMPILE_OPTIONS = {
  bannerComment: '',
  additionalProperties: false,
};

/**
 * Compiles a tool's `inputSchema` into a named TypeScript interface
 * declaration (Prettier-formatted, no banner), e.g.
 * `export interface WebSearchArgs { query: string; }`.
 */
export function compileArgsInterface(schema: unknown, interfaceName: string): Promise<string> {
  return compile((stripTitles(schema) ?? {}) as JSONSchema, interfaceName, COMPILE_OPTIONS);
}

// json-schema-to-typescript turns a nested schema's `title` into a named type
// *reference* without ever emitting its definition, leaving dangling names.
// Titles are meaningless for our anonymous arg interfaces, so drop them all.
function stripTitles(schema: unknown): unknown {
  if (Array.isArray(schema)) return schema.map(stripTitles);
  if (schema && typeof schema === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(schema as Record<string, unknown>)) {
      if (key !== 'title') out[key] = stripTitles(value);
    }
    return out;
  }
  return schema;
}

/** Maps an MCP tool name (typically snake_case) to a valid camelCase method identifier. */
export function sanitizeMethodName(name: string): string {
  const words = name
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .flatMap(splitCamelWords)
    .map((word) => (isAcronym(word) ? word.toLowerCase() : word));

  if (words.length === 0) return '_';

  let out = words[0].toLowerCase();
  for (const word of words.slice(1)) out += word[0].toUpperCase() + word.slice(1);

  if (/^[0-9]/.test(out)) out = '_' + out;
  return out;
}

/** Maps a sanitized method name to its PascalCase args interface name. */
export function argsInterfaceName(methodName: string): string {
  const pascal = methodName
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((part) => part[0].toUpperCase() + part.slice(1))
    .join('');
  if (!pascal) return '_Args';
  // Preserve a digit-guard underscore from sanitizeMethodName().
  const guard = methodName.startsWith('_') && !pascal.startsWith('_') ? '_' : '';
  return guard + pascal + 'Args';
}

function splitCamelWords(segment: string): string[] {
  return segment.match(/[A-Z]?[a-z0-9]+|[A-Z]+(?![a-z])/g) ?? [];
}

function isAcronym(word: string): boolean {
  return word.length > 1 && word === word.toUpperCase() && /[A-Z]/.test(word);
}
