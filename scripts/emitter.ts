// Emits src/tools.gen.ts: one camelCase method per MCP tool on a generated
// ZoComputerClient subclass, plus named Args interfaces whose bodies come
// from json-schema-to-typescript (see scripts/lib.ts). Structure is assembled
// and formatted by ts-morph so output is deterministic.

import { Project, VariableDeclarationKind } from 'ts-morph';
import { compileArgsInterface, sanitizeMethodName, argsInterfaceName } from './lib.js';

export interface ToolDefinition {
  name: string;
  description?: string;
  inputSchema: Record<string, unknown>;
  /** When declared, compiled into a `<Name>Result` interface and the method's return type. */
  outputSchema?: Record<string, unknown>;
}

/** Deterministically unique names handed out in tool-sorted order. */
interface Names {
  methodName: string;
  interfaceName: string;
  /** Present only when the tool declares an outputSchema. */
  resultInterfaceName?: string;
}

/** JSON Schema booleans are not valid MCP output schemas — treat them as absent. */
function hasOutputSchema(tool: ToolDefinition): boolean {
  return typeof tool.outputSchema === 'object' && tool.outputSchema !== null;
}

/** Deterministic tool ordering shared by naming, compilation, and emission. */
function sortedTools(tools: ToolDefinition[]): ToolDefinition[] {
  return [...tools].sort((a, b) => a.name.localeCompare(b.name));
}

function assignNames(tools: ToolDefinition[]): Map<string, Names> {
  const byMethod = new Map<string, number>();
  const byInterface = new Map<string, number>();
  const assigned = new Map<string, Names>();

  for (const tool of sortedTools(tools)) {
    const baseMethod = sanitizeMethodName(tool.name);
    const methodCount = byMethod.get(baseMethod) ?? 0;
    byMethod.set(baseMethod, methodCount + 1);

    const baseInterface = argsInterfaceName(methodCount === 0 ? baseMethod : `${baseMethod}_${methodCount + 1}`);
    const interfaceCount = byInterface.get(baseInterface) ?? 0;
    byInterface.set(baseInterface, interfaceCount + 1);

    const suffix = (count: number) => (count === 0 ? '' : `_${count + 1}`);
    const names: Names = {
      methodName: baseMethod + suffix(methodCount),
      interfaceName: baseInterface + suffix(interfaceCount),
    };

    if (hasOutputSchema(tool)) {
      // Result names live in their own namespace (…Args vs …Result never collide).
      const baseResult = names.interfaceName.replace(/Args$/, 'Result');
      const resultCount = byInterface.get(baseResult) ?? 0;
      byInterface.set(baseResult, resultCount + 1);
      names.resultInterfaceName = baseResult + suffix(resultCount);
    }

    assigned.set(tool.name, names);
  }
  return assigned;
}

/**
 * Builds the full contents of src/tools.gen.ts from a tool inventory.
 * Returns a Prettier-free but consistently formatted TypeScript module.
 */
export async function emitToolsModule(tools: ToolDefinition[], headerComment: string): Promise<string> {
  const names = assignNames(tools);

  // Compile every schema first; failures abort generation loudly.
  const interfaceSources = new Map<string, string>();
  for (const tool of sortedTools(tools)) {
    const { interfaceName, resultInterfaceName } = names.get(tool.name)!;
    interfaceSources.set(
      interfaceName,
      await compileArgsInterface(tool.inputSchema ?? {}, interfaceName),
    );
    if (hasOutputSchema(tool)) {
      interfaceSources.set(
        resultInterfaceName!,
        await compileArgsInterface(tool.outputSchema, resultInterfaceName!),
      );
    }
  }

  const project = new Project({ useInMemoryFileSystem: true });
  const source = project.createSourceFile('tools.gen.ts');

  // Imports (the header comment is prepended afterwards so it stays line 1).
  source.addImportDeclaration({
    moduleSpecifier: './client.js',
    namedImports: ['McpClientBase'],
  });
  source.addImportDeclaration({
    isTypeOnly: true,
    moduleSpecifier: './client.js',
    namedImports: ['McpToolResult'],
  });

  // Named Args interfaces, bodies transplanted from json-schema-to-typescript.
  let scratch = 0;
  for (const [, text] of interfaceSources) {
    const parsed = project.createSourceFile(`__compiled_${scratch++}.ts`, text);
    const iface = parsed.getInterfaceOrThrow(parsed.getInterfaces()[0]?.getName() ?? '');
    source.addInterface(iface.getStructure());
    parsed.delete();
  }

  // Runtime tool-name registry (mirrors the PR-era MCP_TOOLS spirit).
  source.addVariableStatement({
    declarationKind: VariableDeclarationKind.Const,
    declarations: [
      {
        name: 'TOOL_NAMES',
        initializer: `[${tools
          .map((tool) => JSON.stringify(tool.name))
          .sort()
          .join(', ')}] as const`,
      },
    ],
    isExported: true,
  });

  // Generated client subclass with one method per tool.
  const klass = source.addClass({
    name: 'ZoComputerClient',
    isExported: true,
    extends: 'McpClientBase',
    docs: [
      'Typed convenience methods for every tool Zo Computer exposes over MCP.\nGenerated by scripts/generate.ts — do not edit by hand.',
    ],
  });

  for (const tool of sortedTools(tools)) {
    const { methodName, interfaceName, resultInterfaceName } = names.get(tool.name)!;
    klass.addMethod({
      name: methodName,
      parameters: [{ name: 'args', type: interfaceName }],
      returnType: resultInterfaceName
        ? `Promise<McpToolResult<${resultInterfaceName}>>`
        : 'Promise<McpToolResult>',
      statements: resultInterfaceName
        ? `return this.callTool<${resultInterfaceName}>(${JSON.stringify(tool.name)}, args);`
        : `return this.callTool(${JSON.stringify(tool.name)}, args);`,
      ...(tool.description ? { docs: [tool.description] } : {}),
    });
  }

  return headerComment.trimEnd() + '\n\n' + source.getFullText();
}
