/**
 * Dumps every route Express actually has registered, by walking the router
 * stack. Used to check test coverage against the real surface rather than
 * against a hand-maintained list.
 */
process.env.NODE_ENV = 'development';
process.env.MONGODB_URI = 'mongodb://127.0.0.1:27017/manisha_routes_dump';
process.env.JWT_ACCESS_SECRET = 'routes-dump-access-secret-value-0123456789';
process.env.JWT_REFRESH_SECRET = 'routes-dump-refresh-secret-value-0123456789';

interface Layer {
  route?: { path: string; methods: Record<string, boolean> };
  name?: string;
  handle?: { stack?: Layer[] };
  regexp?: RegExp;
}

function mountPath(layer: Layer): string {
  if (!layer.regexp) return '';
  const source = layer.regexp.source;
  const match = source.match(/^\^\\\/((?:[\w\-]|\\.)*)/);
  if (!match) return '';
  return `/${match[1].replace(/\\(.)/g, '$1')}`;
}

function walk(stack: Layer[], prefix: string, out: string[]): void {
  for (const layer of stack) {
    if (layer.route) {
      const methods = Object.keys(layer.route.methods)
        .filter((m) => layer.route!.methods[m])
        .map((m) => m.toUpperCase());
      for (const method of methods) {
        out.push(`${method} ${prefix}${layer.route.path === '/' ? '' : layer.route.path}`);
      }
    } else if (layer.name === 'router' && layer.handle?.stack) {
      walk(layer.handle.stack, prefix + mountPath(layer), out);
    }
  }
}

async function main(): Promise<void> {
  const { createApp } = await import('../app');
  const app = createApp();
  const out: string[] = [];
  walk(((app as never as { _router: { stack: Layer[] } })._router).stack, '', out);
  out.sort().forEach((route) => console.log(route));
  console.log(`\nTOTAL: ${out.length} routes`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
