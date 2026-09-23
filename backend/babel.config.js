// Used only by Jest to strip TypeScript for tests — the real build still goes
// through tsc (see tsconfig.build.json). Keeping test transpilation on Babel
// rather than ts-jest means it has no dependency on the installed TypeScript
// compiler version, which this repo pins aggressively (^6.0.3).
module.exports = {
  presets: [
    ['@babel/preset-env', { targets: { node: 'current' } }],
    '@babel/preset-typescript',
  ],
};
