/**
 * Applies db/schema.sql (idempotent) to DATABASE_URL.
 *   npm run migrate            # reads DATABASE_URL from the environment or .env.local
 */
import { readFileSync } from 'node:fs';
import { neon } from '@neondatabase/serverless';

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL is not set (run `vercel env pull` once the database exists).');
  process.exit(1);
}
const sql = neon(url);
const schema = readFileSync(new URL('../db/schema.sql', import.meta.url), 'utf8')
  .split('\n')
  .filter((line) => !line.trim().startsWith('--'))
  .join('\n');
const statements = schema.split(/;\s*(?:\n|$)/).map((s) => s.trim()).filter(Boolean);
for (const statement of statements) {
  await sql.query(statement);
  console.log('✓', statement.split('\n')[0]);
}
console.log(`Applied ${statements.length} statements.`);
