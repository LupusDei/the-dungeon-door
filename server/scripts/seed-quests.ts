/**
 * Loads db/quest-seed.json into the quest log (DATABASE_URL from the environment or .env.local).
 *   npm run seed:quests            # sets the board's levels and workstreams; adds tasks only if there are none
 *   npm run seed:quests -- --force # also overwrites tasks that share an id with the seed
 */
import { readFileSync } from 'node:fs';
import { quests, type QuestMeta, type QuestTask } from '../lib/quests.ts';

const seed = JSON.parse(readFileSync(new URL('../db/quest-seed.json', import.meta.url), 'utf8')) as { meta: QuestMeta; tasks: QuestTask[] };
const force = process.argv.includes('--force');
const store = quests();
await store.setMeta(seed.meta);
const existing = await store.list();
if (existing.length && !force) {
  console.log(`Board settings updated. ${existing.length} tasks already exist, so none were added (use --force to overwrite seeded ones).`);
} else {
  for (const task of seed.tasks) await store.put(task);
  console.log(`Board settings updated and ${seed.tasks.length} tasks written.`);
}
