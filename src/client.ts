// Hand-written base client for Zo's streamable HTTP MCP endpoint.
//
// Transport, JSON-RPC framing, session management and SSE parsing are
// delegated to the official Model Context Protocol TypeScript SDK
// (https://github.com/modelcontextprotocol/typescript-sdk). This module only
// adds Zo-specific defaults (base URL, bearer auth) and a normalized
// McpToolResult shape on top.
//
// Generated per-tool methods live in src/tools.gen.ts
// (ZoComputerClient extends this class); regenerate with scripts/generate.ts.

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { StreamableHTTPClientTransportOptions } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { OAuthClientProvider } from '@modelcontextprotocol/sdk/client/auth.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';

export const DEFAULT_BASE_URL = 'https://api.zo.computer/mcp';

export interface McpClientConfig {
  /** Bearer token from Settings → Advanced (ZO_API_KEY or ZO_CLIENT_IDENTITY_TOKEN). */
  auth?: string;
  /**
   * OAuth 2.1 provider (e.g. PKCE in the browser) supplying tokens for the
   * streamable HTTP transport. Mutually exclusive with `auth` — providing both
   * throws at construction.
   */
  authProvider?: OAuthClientProvider;
  /** Default https://api.zo.computer/mcp */
  baseUrl?: string;
  /** Identifies this client to the server during initialization. */
  clientInfo?: { name?: string; version?: string };
  /** Extra options merged into transport requests (custom headers, signal, ...). */
  requestInit?: RequestInit;
  /** Inject a custom transport instead of building a StreamableHTTP one (tests use InMemoryTransport). */
  transport?: Transport;
}

/** A single content block inside a tool result (`{ type: 'text', text }` et al). */
export type McpContentBlock = { type: string } & Record<string, unknown>;

export interface McpToolResult<TStructured = unknown> {
  /** true when the tool executed but signaled failure. */
  isError: boolean;
  /** Concatenated text of all text blocks. */
  text: string;
  /** All returned content blocks. */
  content: McpContentBlock[];
  /**
   * Structured output (`structuredContent`) when the server provides it.
   * Typed automatically for tools that declare an `outputSchema`; `unknown`
   * otherwise (schemaless tools deliver their payload via `text`).
   *
   * Trust boundary: the type reflects the schema captured at generation time.
   * If the server's live behavior drifts from that schema, `structured` may
   * not match its type at runtime — validate before relying on it for
   * security-sensitive decisions.
   */
  structured?: TStructured;
  /** The raw CallToolResult for advanced access. */
  raw: unknown;
}

export class McpClientBase {
  private readonly baseUrl: string;
  private readonly streamableOptions: StreamableHTTPClientTransportOptions;
  private readonly clientInfo: { name: string; version: string };
  private readonly injectedTransport?: Transport;
  private _client?: Client;

  constructor(config: McpClientConfig = {}) {
    this.baseUrl = (config.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, '');
    // Resolving here also validates credential exclusivity before any I/O.
    this.streamableOptions = resolveTransportOptions(config);
    this.clientInfo = {
      name: config.clientInfo?.name ?? 'zocomputer-mcp-ts',
      version: config.clientInfo?.version ?? '0.1.0',
    };
    this.injectedTransport = config.transport;
  }

  get isConnected(): boolean {
    return this._client !== undefined;
  }

  /** Info reported by the server during initialize(). */
  get serverInfo(): ReturnType<Client['getServerVersion']> {
    return this._client?.getServerVersion();
  }

  /** Capabilities reported by the server during initialize(). */
  get serverCapabilities(): ReturnType<Client['getServerCapabilities']> {
    return this._client?.getServerCapabilities();
  }

  /** Optional usage instructions reported by the server during initialize(). */
  get serverInstructions(): ReturnType<Client['getInstructions']> {
    return this._client?.getInstructions();
  }

  /**
   * Connects and performs the MCP initialize handshake (the SDK emits
   * notifications/initialized afterwards per spec).
   */
  async connect(): Promise<void> {
    if (this._client) throw new Error('McpClientBase is already connected');
    const client = new Client(this.clientInfo, { capabilities: {} });
    const transport =
      this.injectedTransport ??
      new StreamableHTTPClientTransport(new URL(this.baseUrl), this.streamableOptions);
    await client.connect(transport);
    this._client = client;
  }

  /** Standard `ping` — resolves if the server is alive. */
  async ping(): Promise<void> {
    await this.requireClient().ping();
  }

  /** Lists tools, following cursor pagination until exhausted. */
  async listTools(): Promise<Awaited<ReturnType<Client['listTools']>>['tools']> {
    const tools: Awaited<ReturnType<Client['listTools']>>['tools'] = [];
    let cursor: string | undefined;
    do {
      const page = await this.requireClient().listTools(cursor ? { cursor } : undefined);
      tools.push(...page.tools);
      cursor = page.nextCursor;
    } while (cursor);
    return tools;
  }

  /** Low-level tool call; generated methods wrap this for type safety. */
  async callTool<TStructured = unknown>(
    name: string,
    args: object = {},
  ): Promise<McpToolResult<TStructured>> {
    const result = await this.requireClient().callTool({ name, arguments: args as Record<string, unknown> });
    const content = (Array.isArray(result.content) ? result.content : []) as McpContentBlock[];
    const text = content
      .filter((block) => block.type === 'text')
      .map((block) => (typeof block.text === 'string' ? block.text : ''))
      .join('\n');
    return {
      isError: result.isError === true,
      content,
      text,
      structured: result.structuredContent as TStructured | undefined,
      raw: result,
    };
  }

  /** Closes the underlying transport/session. Safe to call more than once. */
  async close(): Promise<void> {
    await this._client?.close();
    this._client = undefined;
  }

  private requireClient(): Client {
    if (!this._client) throw new Error('not connected — call connect() first');
    return this._client;
  }
}

/**
 * Builds streamable HTTP transport options from credential config. Exported
 * for tests; the entry point does not re-export it.
 *
 * Throws when both `auth` and `authProvider` are set — silent precedence
 * between credential styles would hide misconfiguration.
 */
export function resolveTransportOptions(
  config: Pick<McpClientConfig, 'auth' | 'authProvider' | 'requestInit'>,
): StreamableHTTPClientTransportOptions {
  if (config.auth && config.authProvider) {
    throw new Error('Provide either auth or authProvider, not both');
  }
  const headers: Record<string, string> = {
    ...((config.requestInit?.headers as Record<string, string> | undefined) ?? {}),
    ...(config.auth ? { authorization: `Bearer ${config.auth}` } : {}),
  };
  return { requestInit: { ...config.requestInit, headers }, authProvider: config.authProvider };
}
