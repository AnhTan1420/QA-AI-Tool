import nextVitals from 'eslint-config-next/core-web-vitals.js';
import nextTypescript from 'eslint-config-next/typescript.js';

const eslintConfig = [
  { ignores: ['.next/**', 'node_modules/**', 'next-env.d.ts'] },
  ...nextVitals,
  ...nextTypescript,
];

export default eslintConfig;
