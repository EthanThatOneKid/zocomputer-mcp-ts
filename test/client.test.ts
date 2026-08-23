// Offline integration tests: drives McpClientBase against a stub MCP server
// over the SDK's in-memory transport pair (no network, no API key).

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  PingRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { McpClientBase } from '../src/client.js';

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
