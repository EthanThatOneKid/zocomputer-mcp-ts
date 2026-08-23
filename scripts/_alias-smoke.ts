import { readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const proj = join(process.env.TEMP ?? '/tmp', 'opencode', 'alias-install-test');
await rm(proj, { recursive: true, force: true });
await import('node:fs/promises').then((fs) => fs.mkdir(proj, { recursive: true }));
await writeFile(
  join(proj, 'package.json'),
  JSON.stringify({ name: 'smoke', type: 'module' }, null, 2),
);

const { execSync } = await import('node:child_process');
execSync('npm install zocomputer-mcp-ts@github:EthanThatOneKid/zocomputer-mcp-ts#refactor/alias-imports --no-audit --no-fund', {
  cwd: proj,
  stdio: 'inherit',
});

// Prove the aliased-source package resolves at runtime through its rewritten dist.
const check = `
import { ZoComputerClient, TOOL_NAMES } from 'zocomputer-mcp-ts';
const zo = new ZoComputerClient({ auth: 'dummy' });
console.log('runtime ok:', typeof zo.bash === 'function', '| tools:', TOOL_NAMES.length);
`;
await writeFile(join(proj, 'verify.mjs'), check);
execSync('node verify.mjs', { cwd: proj, stdio: 'inherit' });

// And confirm dist internals carry no alias specifiers.
const indexJs = await readFile(join(proj, 'node_modules', 'zocomputer-mcp-ts', 'dist', 'index.js'), 'utf8');
console.log('consumer dist alias-free:', !indexJs.includes('@/') && !indexJs.includes('@scripts/'));
