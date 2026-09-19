/**
 * Promotes an email address to admin — the bootstrap for when no admin exists
 * yet, or when the in-app "Customer & staff accounts" screen is unreachable
 * because nobody can sign in as admin to open it.
 *
 * For the admin role specifically, prefer ADMIN_EMAILS in .env: that list is
 * re-applied on every sign-in, so it survives a restored backup. This script
 * still earns its place for `--role staff`, which the list does not cover,
 * and for promoting an account on a database whose env you cannot edit.
 *
 * Once one admin exists, prefer the in-app screen: Account → Customer & staff
 * accounts → Change role. This script is for the first one.
 *
 * Writes to whatever MONGODB_URI is set in backend/.env — which may be your
 * production database. It prints the target and the change it made.
 *
 *   npm run make-admin -- owner@example.com
 *   npm run make-admin -- owner@example.com --name "Store Owner"
 *   npm run make-admin -- staff@example.com --role staff
 */
import 'dotenv/config';

type Role = 'retail' | 'wholesale' | 'staff' | 'admin';
const ASSIGNABLE: Role[] = ['retail', 'wholesale', 'staff', 'admin'];

interface Args {
  email: string;
  name?: string;
  role: Role;
}

function parseArgs(argv: string[]): Args {
  const positional: string[] = [];
  let name: string | undefined;
  let role: Role = 'admin';

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--name') {
      name = argv[i + 1];
      i += 1;
    } else if (arg === '--role') {
      const next = argv[i + 1] as Role;
      if (!ASSIGNABLE.includes(next)) {
        throw new Error(`--role must be one of: ${ASSIGNABLE.join(', ')}`);
      }
      role = next;
      i += 1;
    } else {
      positional.push(arg);
    }
  }

  const raw = positional[0];
  if (!raw) {
    throw new Error(
      'Usage: npm run make-admin -- <email> [--name "Full Name"] [--role admin|staff]',
    );
  }

  // Lowercased to match how the auth service stores and looks up addresses.
  const email = raw.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error(`"${raw}" is not a valid email address.`);
  }

  return { email, name, role };
}

async function main(): Promise<void> {
  const { email, name, role } = parseArgs(process.argv.slice(2));

  const { env } = await import('../config/env');
  const { connectDatabase, disconnectDatabase } = await import('../config/database');
  const { User } = await import('../models/user.model');

  // Show which database is being touched — this is the guard against
  // accidentally promoting someone in production.
  const target = env.MONGODB_URI.replace(/\/\/[^@]*@/, '//***@');
  console.log(`\nDatabase : ${target}`);
  console.log(`Email    : ${email}`);
  console.log(`Role     : ${role}\n`);

  await connectDatabase();

  try {
    const existing = await User.findOne({ email });

    if (existing) {
      const previous = existing.accountType;
      if (previous === role) {
        console.log(`No change — ${email} is already ${role}.`);
        return;
      }
      existing.accountType = role;
      // A wholesale applicant promoted to staff/admin keeps no pending review.
      if (role === 'staff' || role === 'admin') existing.wholesaleStatus = 'none';
      if (name) existing.name = name;
      existing.isActive = true;
      await existing.save();
      console.log(`Updated: ${email} ${previous} → ${role}`);
    } else {
      // Created without a password: the account still needs one set through
      // "Forgot password", or a Google sign-in on the same address.
      await User.create({
        email,
        name,
        accountType: role,
        wholesaleStatus: 'none',
        authProviders: [],
        isActive: true,
      });
      console.log(`Created: ${email} as ${role}`);
    }

    console.log(
      '\nSign in with this address on the app. A newly created account has no\n' +
        'password yet — use "Forgot password" to set one, or sign in with Google.\n',
    );
    if (role === 'admin') {
      console.log(
        'Note: ADMIN_EMAILS is re-applied on every sign-in. If this address is\n' +
          'not on that list, it will be demoted again at next login.\n',
      );
    }
  } finally {
    await disconnectDatabase();
  }
}

main().catch((error) => {
  console.error(`\n${(error as Error).message}\n`);
  process.exit(1);
});
