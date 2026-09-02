/**
 * Promotes a phone number to admin — the bootstrap for when no admin exists
 * yet, or when the in-app "Customer & staff accounts" screen is unreachable
 * because nobody can sign in as admin to open it.
 *
 * Once one admin exists, prefer the in-app screen: Account → Customer & staff
 * accounts → Change role. This script is for the first one.
 *
 * Writes to whatever MONGODB_URI is set in backend/.env — which may be your
 * production database. It prints the target and the change it made.
 *
 *   npm run make-admin -- +919876543210
 *   npm run make-admin -- 9876543210 --name "Store Owner"
 *   npm run make-admin -- +919876543210 --role staff
 */
import 'dotenv/config';

type Role = 'retail' | 'wholesale' | 'staff' | 'admin';
const ASSIGNABLE: Role[] = ['retail', 'wholesale', 'staff', 'admin'];

interface Args {
  phone: string;
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
      'Usage: npm run make-admin -- <phone> [--name "Full Name"] [--role admin|staff]',
    );
  }

  // Accept 9876543210, +919876543210 or 919876543210 — store E.164 like the
  // auth service does, so the number matches at sign-in.
  const digits = raw.replace(/\D/g, '');
  if (digits.length < 10) throw new Error(`"${raw}" is not a valid phone number.`);
  const last10 = digits.slice(-10);
  const phone = `+91${last10}`;

  return { phone, name, role };
}

async function main(): Promise<void> {
  const { phone, name, role } = parseArgs(process.argv.slice(2));

  const { env } = await import('../config/env');
  const { connectDatabase, disconnectDatabase } = await import('../config/database');
  const { User } = await import('../models/user.model');

  // Show which database is being touched — this is the guard against
  // accidentally promoting someone in production.
  const target = env.MONGODB_URI.replace(/\/\/[^@]*@/, '//***@');
  console.log(`\nDatabase : ${target}`);
  console.log(`Phone    : ${phone}`);
  console.log(`Role     : ${role}\n`);

  await connectDatabase();

  try {
    const existing = await User.findOne({ phone });

    if (existing) {
      const previous = existing.accountType;
      if (previous === role) {
        console.log(`No change — ${phone} is already ${role}.`);
        return;
      }
      existing.accountType = role;
      // A wholesale applicant promoted to staff/admin keeps no pending review.
      if (role === 'staff' || role === 'admin') existing.wholesaleStatus = 'none';
      if (name) existing.name = name;
      existing.isActive = true;
      await existing.save();
      console.log(`Updated: ${phone} ${previous} → ${role}`);
    } else {
      await User.create({
        phone,
        name,
        accountType: role,
        wholesaleStatus: 'none',
        isActive: true,
      });
      console.log(`Created: ${phone} as ${role}`);
    }

    console.log(
      '\nSign in with this number on the app — the OTP goes through the normal flow.\n',
    );
  } finally {
    await disconnectDatabase();
  }
}

main().catch((error) => {
  console.error(`\n${(error as Error).message}\n`);
  process.exit(1);
});
