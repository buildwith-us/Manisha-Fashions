/**
 * Static scan for hardcoded phone numbers, API keys and other secret-shaped
 * string literals across backend/src and mobile/src.
 *
 * `src/scripts/**` and `__tests__/**` are excluded from the scan itself: the
 * scripts here (smoke.ts, coverage.ts, audit.ts, routes.ts, dev-memory.ts)
 * are self-contained dev harnesses that boot their own in-memory Mongo and
 * throwaway JWT secrets, in the same spirit as a test fixture, even though
 * they don't live under __tests__/.
 *
 * Runnable standalone:  npm run scan-secrets   (from backend/)
 * Also imported by:     src/__tests__/security/hardcoded-credentials.test.ts,
 * which is what actually gates the build on this — this file only holds the
 * scanning logic so it can be run either way.
 */
import fs from 'fs';
import path from 'path';

export interface Finding {
  /** Relative to the repo root, so failure output reads the same on any machine. */
  file: string;
  line: number;
  snippet: string;
  matched: string;
  pattern: string;
}

interface ScanRoot {
  dir: string;
  skipDirs: string[];
}

function scanRoots(repoRoot: string): ScanRoot[] {
  return [
    { dir: path.join(repoRoot, 'backend', 'src'), skipDirs: ['scripts', '__tests__', 'node_modules'] },
    { dir: path.join(repoRoot, 'mobile', 'src'), skipDirs: ['__tests__', 'node_modules'] },
  ];
}

const PATTERNS: Array<{ name: string; regex: RegExp }> = [
  // A quoted string that is itself an E.164-shaped phone number — not a regex
  // pattern describing one (those aren't inside quotes), not a placeholder
  // full of X's or digits-as-a-different-kind-of-id.
  { name: 'phone-literal', regex: /(['"])(\+91[6-9]\d{9}|\+\d{10,14})\1/g },
  {
    name: 'provider-key-prefix',
    regex:
      /\b(sk_live_[A-Za-z0-9]+|sk_test_[A-Za-z0-9]+|AKIA[0-9A-Z]{4,}|gh[pousr]_[A-Za-z0-9]{10,}|AIza[0-9A-Za-z_-]{10,})/g,
  },
  {
    // e.g. `apiSecret = "..."`, `PRIVATE_KEY: '...'` — deliberately broad on
    // the identifier side (SECRET / API_KEY / PRIVATE_KEY / PASSWORD in any
    // casing/separator) and narrow on the value side (8+ chars, not an
    // obvious placeholder) to keep noise down.
    name: 'secret-assignment',
    regex: /\b\w*(?:SECRET|API[_-]?KEY|PRIVATE[_-]?KEY|PASSWORD)\w*\s*[:=]\s*(['"`])((?:(?!\1).){8,})\1/gi,
  },
];

const PLACEHOLDER_VALUE = /^(change-me|your-|xxx|placeholder|\$\{|<)/i;

function listSourceFiles(dir: string, skipDirs: string[]): string[] {
  if (!fs.existsSync(dir)) return [];
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (skipDirs.includes(entry.name)) continue;
      out.push(...listSourceFiles(path.join(dir, entry.name), skipDirs));
    } else if (/\.(ts|tsx)$/.test(entry.name)) {
      out.push(path.join(dir, entry.name));
    }
  }
  return out;
}

export function scanForHardcodedSecrets(repoRoot: string): Finding[] {
  const findings: Finding[] = [];

  for (const root of scanRoots(repoRoot)) {
    for (const file of listSourceFiles(root.dir, root.skipDirs)) {
      const relative = path.relative(repoRoot, file).split(path.sep).join('/');
      const lines = fs.readFileSync(file, 'utf8').split('\n');

      lines.forEach((lineText, index) => {
        for (const pattern of PATTERNS) {
          // Fresh RegExp per line: a global regex is stateful (lastIndex),
          // and reusing one across lines/files would silently skip matches.
          const regex = new RegExp(pattern.regex.source, pattern.regex.flags);
          let match: RegExpExecArray | null;
          while ((match = regex.exec(lineText))) {
            if (pattern.name === 'secret-assignment') {
              const value = match[2] ?? '';
              if (PLACEHOLDER_VALUE.test(value) || value.trim().length === 0) continue;
            }
            findings.push({
              file: relative,
              line: index + 1,
              snippet: lineText.trim(),
              matched: match[0],
              pattern: pattern.name,
            });
          }
        }
      });
    }
  }

  return findings;
}

if (require.main === module) {
  const repoRoot = path.resolve(__dirname, '../../..');
  const findings = scanForHardcodedSecrets(repoRoot);
  if (findings.length === 0) {
    console.log('scan-secrets: no hardcoded phone/secret literals found outside scripts/ and __tests__/.');
  } else {
    console.log(`scan-secrets: ${findings.length} finding(s):`);
    for (const finding of findings) {
      console.log(`  ${finding.file}:${finding.line} [${finding.pattern}] ${finding.snippet}`);
    }
    process.exitCode = 1;
  }
}
