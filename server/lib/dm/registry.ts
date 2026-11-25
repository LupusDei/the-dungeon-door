import { DUNGEON_MASTERS } from '../catalog.ts';
import { fakeAI } from '../models.ts';
import { fakeDungeonMaster } from './fake.ts';
import { llmDungeonMaster } from './llm.ts';
import type { DungeonMaster } from './types.ts';

/**
 * Archetype id → DungeonMaster. Every archetype in the catalog starts on the shared LLM DM (each with its
 * own voice from the catalog). To give an archetype its own implementation, map its id here.
 * With DD_FAKE_AI=1 every archetype uses the offline fake DM unless a test registered something else.
 */
const registry = new Map<string, DungeonMaster>(DUNGEON_MASTERS.map((d) => [d.id, llmDungeonMaster]));
const overrides = new Map<string, DungeonMaster>();

export function getDungeonMaster(archetypeId: string): DungeonMaster {
  const override = overrides.get(archetypeId);
  if (override) return override;
  if (fakeAI()) return fakeDungeonMaster;
  return registry.get(archetypeId) ?? llmDungeonMaster;
}

/** Register an implementation at runtime (tests, experiments). Takes precedence, even in fake mode. */
export function registerDungeonMaster(archetypeId: string, dm: DungeonMaster): void {
  overrides.set(archetypeId, dm);
}

export function unregisterDungeonMaster(archetypeId: string): void {
  overrides.delete(archetypeId);
}
