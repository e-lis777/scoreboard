import { cp, mkdir, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const output = resolve(root, '.cf-dist');

await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
await cp(resolve(root, 'legion.html'), resolve(output, 'legion.html'));
await cp(resolve(root, 'src'), resolve(output, 'src'), { recursive: true });
await cp(resolve(root, 'data'), resolve(output, 'data'), { recursive: true });
await cp(resolve(root, 'worker', 'pages-gateway.js'), resolve(output, '_worker.js'));
// A Pages Function is server-side code, not a public asset of the Worker.
await writeFile(resolve(output, '.assetsignore'), '_worker.js\n');
