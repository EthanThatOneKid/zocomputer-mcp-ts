// Offline integration tests: drives McpClientBase against a stub MCP server
// over the SDK's in-memory transport pair (no network, no API key).

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  PingRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { OAuthClientProvider } from '@modelcontextprotocol/sdk/client/auth.js';
import { McpClientBase, resolveTransportOptions } from '@/client.js';

const STUB_TOOLS = [
  {
    name: 'echo_greeting',
    description: 'Echoes the greeting back.',
    inputSchema: {
      type: 'object' as const,
      properties: { greeting: { type: 'string' } },
      required: ['greeting'],
    },
  },
  {
    name: 'fail_always',
    description: 'Always signals a tool error.',
    inputSchema: { type: 'object' as const, properties: {} },
  },
];

function makeStubServer(): Server {
  const server = new Server({ name: 'stub-zo', version: '9.9.9' }, { capabilities: { tools: {} } });
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: STUB_TOOLS }));
  server.setRequestHandler(PingRequestSchema, async () => ({}));
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    if (request.params.name === 'echo_greeting') {
      const args = request.params.arguments as Record<string, unknown>;
      return { content: [{ type: 'text', text: `hi ${args.greeting}` }] };
    }
    return { content: [{ type: 'text', text: 'boom' }], isError: true };
  });
  return server;
}

async function withClient(run: (client: McpClientBase) => Promise<void>): Promise<void> {
  const server = makeStubServer();
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new McpClientBase({ transport: clientTransport });
  await server.connect(serverTransport);
  await client.connect();
  try {
    await run(client);
  } finally {
    await client.close();
  }
}

describe('McpClientBase lifecycle', () => {
  it('connects and captures serverInfo', async () => {
    await withClient(async (client) => {
      assert.equal(client.isConnected, true);
      assert.equal(client.serverInfo?.name, 'stub-zo');
      assert.equal(client.serverInfo?.version, '9.9.9');
    });
  });

  it('refuses callTool before connect()', async () => {
    const client = new McpClientBase({});
    await assert.rejects(() => client.callTool('bash'), /not connected/);
  });

  it('refuses a second connect()', async () => {
    await withClient(async (client) => {
      await assert.rejects(() => client.connect(), /already connected/);
    });
  });

  it('close() disconnects and stays safe when repeated', async () => {
    const server = makeStubServer();
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new McpClientBase({ transport: clientTransport });
    await server.connect(serverTransport);
    await client.connect();
    await client.close();
    assert.equal(client.isConnected, false);
    await client.close();
    assert.equal(client.isConnected, false);
  });
});

describe('McpClientBase tool calls', () => {
  it('pings the server', async () => {
    await withClient((client) => client.ping());
  });

  it('lists tools with pagination shape', async () => {
    await withClient(async (client) => {
      const tools = await client.listTools();
      assert.deepEqual(
        tools.map((tool) => tool.name),
        ['echo_greeting', 'fail_always'],
      );
      assert.equal(tools[0].description, 'Echoes the greeting back.');
    });
  });

  it('returns text content on success', async () => {
    await withClient(async (client) => {
      const result = await client.callTool<{ content: unknown[] }>('echo_greeting', { greeting: 'zo' });
      assert.equal(result.isError, false);
      assert.equal(result.text, 'hi zo');
      assert.equal(result.content.length, 1);
      assert.equal(result.content[0].type, 'text');
      assert.ok(result.raw);
    });
  });

  it('propagates isError without throwing', async () => {
    await withClient(async (client) => {
      const result = await client.callTool('fail_always');
      assert.equal(result.isError, true);
      assert.equal(result.text, 'boom');
    });
  });
});

// -- OAuth provider passthrough (#3) ------------------------------

function makeStubOAuthProvider(accessToken = 'stub-token'): OAuthClientProvider {
  return {
    get redirectUrl(): string {
      return 'http://localhost/callback';
    },
    get clientMetadata() {
      return {
        client_name: 'stub',
        redirect_uris: ['http://localhost/callback'],
        grant_types: ['authorization_code', 'refresh_token'],
        response_types: ['code'],
        token_endpoint_auth_method: 'none',
      };
    },
    clientInformation() {
      return { client_id: 'stub-client-id' };
    },
    tokens() {
      return { access_token: accessToken, token_type: 'Bearer' } as never;
    },
  };
}

describe('resolveTransportOptions', () => {
  it('adds a bearer header when auth is set', () => {
    const options = resolveTransportOptions({ auth: 'zo_sk_test' });
    assert.deepEqual(options.requestInit?.headers, { authorization: 'Bearer zo_sk_test' });
  });

  it('passes authProvider through untouched', () => {
    const provider = makeStubOAuthProvider();
    const options = resolveTransportOptions({ authProvider: provider });
    assert.equal(options.authProvider, provider);
    assert.deepEqual(options.requestInit?.headers, {});
  });

  it('merges caller requestInit.headers with the bearer header', () => {
    const options = resolveTransportOptions({
      auth: 'zo_sk_test',
      requestInit: { headers: { 'x-custom': 'yes' } },
    });
    assert.deepEqual(options.requestInit?.headers, { 'x-custom': 'yes', authorization: 'Bearer zo_sk_test' });
  });

  it('throws when both credential styles are provided', () => {
    assert.throws(
      () => resolveTransportOptions({ auth: 'a', authProvider: makeStubOAuthProvider() }),
      /either auth or authProvider/,
    );
  });
});

describe('McpClientBase OAuth wiring', () => {
  it('rejects conflicting credentials at construction', () => {
    assert.throws(() => new McpClientBase({ auth: 'a', authProvider: makeStubOAuthProvider() }), /either auth or authProvider/);
  });

  it('sends the provider access token over a real streamable HTTP handshake', async () => {
    const seen: (string | undefined)[] = [];
    const server = createServer((req, res) => {
      seen.push(req.headers.authorization);
      let body = '';
      req.on('data', (chunk) => (body += chunk));
      req.on('end', () => {
        res.writeHead(200, { 'content-type': 'application/json' });
        if (body.includes('"method":"initialize"')) {
          const requestId = (JSON.parse(body) as { id: number }).id;
          res.end(
            JSON.stringify({
              jsonrpc: '2.0',
              id: requestId,
              result: {
                protocolVersion: '2025-06-18',
                capabilities: {},
                serverInfo: { name: 'oauth-stub', version: '1.0.0' },
              },
            }),
          );
        } else {
          res.end('{}');
        }
      });
    });

    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address() as { port: number };

    try {
      const client = new McpClientBase({
        baseUrl: `http://127.0.0.1:${address.port}/mcp`,
        authProvider: makeStubOAuthProvider(),
      });
      await client.connect();
      assert.equal(client.serverInfo?.name, 'oauth-stub');
      await client.close();
      assert.ok(seen.length > 0, 'no requests reached the stub server');
      for (const header of seen) {
        assert.match(header ?? '', /^Bearer stub-token$/);
      }
    } finally {
      server.close();
    }
  });
});
