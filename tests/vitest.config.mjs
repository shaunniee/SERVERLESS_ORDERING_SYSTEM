import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const nm = (pkg) => path.resolve(__dirname, 'node_modules', pkg);

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['unit/**/*.test.mjs'],
    setupFiles: ['./setup.mjs'],
  },
  resolve: {
    alias: [
      // Lambda Layer path aliases — specific before generic
      { find: '/opt/nodejs/lib/response.mjs', replacement: path.resolve(__dirname, '../backend/layers/shared-deps/nodejs/lib/response.mjs') },
      { find: /^\/opt\/nodejs\/lib\/(.+)\.mjs$/, replacement: path.resolve(__dirname, 'mocks/$1.mjs') },
      // Force ALL scoped packages to resolve from tests/node_modules
      { find: /^(@aws-sdk\/.*)$/, replacement: nm('$1') },
      { find: /^(@aws-lambda-powertools\/.*)$/, replacement: nm('$1') },
      { find: /^(@middy\/.*)$/, replacement: nm('$1') },
      { find: /^(@smithy\/.*)$/, replacement: nm('$1') },
    ],
  },
});
