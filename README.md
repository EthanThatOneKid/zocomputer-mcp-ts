# zocomputer-mcp-ts

Unofficial TypeScript client for programmatic usage of [Zo Computer](https://zo.computer)'s tools over [Model Context Protocol](https://modelcontextprotocol.io) (streamable HTTP transport).

While the main [`zocomputer`](https://github.com/EthanThatOneKid/zocomputer-ts) package covers Zo Computer's public OpenAPI surface (`/zo/ask`, model catalog, personas), this package speaks JSON-RPC 2.0 to `https://api.zo.computer/mcp` so you can drive Zo's tools (bash, file I/O, image/video generation, messaging, services, space routes, etc.) from TypeScript with full type safety.

> Originally contributed by [@srikanthlogic](https://github.com/srikanthlogic) in [EthanThatOneKid/zocomputer-ts#3](https://github.com/EthanThatOneKid/zocomputer-ts/pull/3).

## Install

```sh
npm install zocomputer-mcp-ts
```

## Usage

```ts
import { ZoComputerClient } from 'zocomputer-mcp-ts';

const zo = new ZoComputerClient({ auth: process.env.ZO_API_KEY });

await zo.connect();
console.log(zo.serverInfo);

const tools = await zo.listTools();

const result = await zo.bash({ cmd: 'echo hello' });
console.log(result.text);
```

Get an API key from Zo Computer's Settings → Advanced (`ZO_API_KEY` or `ZO_CLIENT_IDENTITY_TOKEN`).

## Tool inventory

The tool inventory is snapshotted into `openapi/mcp-tools.json` and compiled by
[`json-schema-to-typescript`](https://github.com/bcherny/json-schema-to-typescript) +
ts-morph into `src/tools.gen.ts`, giving `ZoComputerClient` one camelCase method per tool with fully typed arguments. Refresh it with:

```sh
ZO_API_KEY=... npm run sync:mcp   # live fetch; falls back to the checked-in snapshot without a token
```

## Development

```sh
npm install
npm test        # offline unit tests via node:test + tsx
npm run build   # tsc → dist/
npm run check   # sync:mcp + build
```

## License

[MIT](./LICENSE)
