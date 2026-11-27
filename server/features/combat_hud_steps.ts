/**
 * Step helpers for features/combat_hud.feature. Most steps play a fight through the engine the way a
 * round does (play/fight.ts fightRound) and read the HUD from the rules view the app is sent
 * (play/view.ts). The step that checks what leaves the server plays a whole game through the API in a
 * child process (combat_hud_replay.ts): the generated specs call helpers synchronously.
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { heroSheet } from '../lib/characters.ts';
import { type CombatVotes, fightRound, startFight } from '../lib/play/fight.ts';
import type { HudCondition } from '../lib/play/hud.ts';
import type { PartyState } from '../lib/play/state.ts';
import { rulesView } from '../lib/play/view.ts';
import { monsters } from '../lib/rules/monsters.ts';
import type { CombatState } from '../lib/rules/scene.ts';
import type { CharacterSheet } from '../lib/rules/sheet.ts';
import { srd } from '../lib/rules/srd.ts';

const fighter = heroSheet({ id: 'p1', name: 'Bryn', race: 'human', characterClass: 'fighter' });
const wizard = heroSheet({ id: 'p2', name: 'Cleo', race: 'elf', characterClass: 'wizard' });
const caster: CharacterSheet = { ...wizard, spellcasting: { ...wizard.spellcasting!, prepared: [...wizard.spellcasting!.prepared, 'sleep'] } };

const monsterId = (name: string) => {
  const m = [...monsters().values()].find((x) => x.name === name);
  assert.ok(m, `no monster ${name}`);
  return m.id;
};
const spellId = (name: string) => {
  const s = [...srd().spells.values()].find((x) => x.name === name);
  assert.ok(s, `no spell ${name}`);
  return s.id;
};

interface Replayed {
  views: unknown[];
  foes: { id: string; name: string; hp: number; maxHp: number }[];
}

export class CombatHudSteps {
  private party: PartyState = { version: 1, rng: 11, sheets: { p1: fighter, p2: caster } };
  private combat: CombatState | null = null;
  private lines: string[] = [];
  private table: { monster: string; share: number } = { monster: 'ogre', share: 1 };
  private replayed: Replayed | null = null;

  heroPoisoned(hero: string, minutes: number): void {
    const id = this.heroId(hero);
    const sheet = this.party.sheets[id];
    this.party = { ...this.party, sheets: { ...this.party.sheets, [id]: { ...sheet, conditions: [{ condition: 'poisoned', until: { kind: 'time', left: minutes * 60 } }] } } };
  }

  fightA(name: string, hp: number): void {
    const start = startFight(this.party, [monsterId(name)]);
    this.party = start.party;
    this.combat = start.combat;
    this.setFoe(name, { hp, maxHp: hp });
  }

  foeDownTo(name: string, hp: number): void {
    this.setFoe(name, { hp });
  }

  foeSlain(name: string): void {
    this.setFoe(name, { hp: 0, status: 'dead' });
  }

  heroDownTo(hero: string, hp: number): void {
    const id = this.heroId(hero);
    this.combat = { ...this.fight(), combatants: { ...this.fight().combatants, [id]: { ...this.fight().combatants[id], hp } } };
  }

  foeHelpless(name: string): void {
    const foe = this.foe(name);
    this.setFoe(name, { attacks: [], saveBonuses: { ...foe.saveBonuses, wis: -30 } });
  }

  casts(hero: string, spell: string, foe: string): void {
    this.round({ [this.heroId(hero)]: { choiceId: 'b', roll: 10, actionId: `spell:${spellId(spell)}`, targets: [this.foe(foe).id] } });
  }

  roundPasses(): void {
    this.round({});
  }

  strikes(hero: string): void {
    this.round({ [this.heroId(hero)]: { choiceId: 'a', roll: 20 } });
  }

  losesConcentration(hero: string): void {
    const id = this.heroId(hero);
    const sheet = this.party.sheets[id];
    this.party = { ...this.party, sheets: { ...this.party.sheets, [id]: { ...sheet, spellcasting: { ...sheet.spellcasting!, concentratingOn: null } } } };
  }

  foeShownAs(name: string, label: string): void {
    assert.equal(this.hudFoe(name).label, label);
  }

  noFoeHitPoints(): void {
    const view = this.view();
    for (const foe of [...view.combatants.filter((c) => c.side === 'foes'), ...view.hud.foes]) {
      assert.equal('hp' in foe, false, JSON.stringify(foe));
      assert.equal('maxHp' in foe, false, JSON.stringify(foe));
    }
  }

  heroShownAt(hero: string, hp: number): void {
    const shown = this.view().hud.party.find((h) => h.name === hero)!;
    assert.deepEqual([shown.hp, shown.maxHp], [hp, this.party.sheets[this.heroId(hero)].maxHp]);
  }

  foeShownWith(name: string, label: string, source: string): void {
    this.hasCondition(this.hudFoe(name).conditions, label, source);
  }

  heroShownWith(hero: string, label: string, source: string): void {
    this.hasCondition(this.view().hud.party.find((h) => h.name === hero)!.conditions, label, source);
  }

  heroShownEnding(hero: string, label: string, ends: string): void {
    const shown = this.view().hud.party.find((h) => h.name === hero)!.conditions.find((c) => c.label === label);
    assert.equal(shown?.ends, ends, JSON.stringify(this.view().hud.party));
  }

  foeFree(name: string): void {
    assert.deepEqual(this.hudFoe(name).conditions, []);
  }

  roundTells(line: string): void {
    assert.ok(this.lines.includes(line), this.lines.join('\n'));
  }

  roundTellsHeld(name: string, spell: string, condition: string): void {
    const pattern = new RegExp(`^${name} is still held by ${spell}: ${condition} \\(WIS save -?\\d+ vs DC \\d+\\)\\.$`);
    assert.ok(this.lines.some((l) => pattern.test(l)), this.lines.join('\n'));
  }

  atTheTable(name: string): void {
    this.table = { ...this.table, monster: monsterId(name) };
  }

  foeDownToShare(share: string): void {
    this.table = { ...this.table, share: { half: 0.5, 'a quarter': 0.25 }[share] ?? 1 };
  }

  sentNoFoeHitPoints(): void {
    const { views, foes } = this.replay();
    assert.ok(views.length >= 2 && foes.length > 0);
    for (const view of views) {
      const leaks = foeObjects(view).filter((o) => 'hp' in o || 'maxHp' in o);
      assert.deepEqual(leaks, [], 'a foe’s hit points were sent');
      const hud = (view as { rules: { combat: { hud: { foes: { id: string }[] } } } }).rules.combat.hud;
      assert.deepEqual(hud.foes.map((f) => f.id), foes.map((f) => f.id));
    }
  }

  everyPlayerSees(name: string, label: string): void {
    for (const view of this.replay().views) {
      const hud = (view as { rules: { combat: { hud: { foes: { name: string; label: string }[] } } } }).rules.combat.hud;
      assert.equal(hud.foes.find((f) => f.name === name)?.label, label);
    }
  }

  private replay(): Replayed {
    if (this.replayed) return this.replayed;
    const here = dirname(fileURLToPath(import.meta.url));
    const result = spawnSync(process.execPath, ['--experimental-strip-types', join(here, 'combat_hud_replay.ts')], {
      input: JSON.stringify(this.table), encoding: 'utf8', cwd: join(here, '..'),
      env: { ...process.env, DD_FAKE_AI: '1', DATABASE_URL: '', BLOB_READ_WRITE_TOKEN: '', NODE_NO_WARNINGS: '1' }, timeout: 60_000,
    });
    const out = result.stdout.split('__DD_VIEW__\n')[1];
    assert.ok(out, `the replay failed: ${result.stderr}`);
    this.replayed = JSON.parse(out) as Replayed;
    return this.replayed;
  }

  private hasCondition(conditions: HudCondition[], label: string, source: string): void {
    assert.ok(conditions.some((c) => c.label === label && c.source === source), JSON.stringify(conditions));
  }

  private round(votes: CombatVotes): void {
    const dodging: CombatVotes = Object.fromEntries(Object.keys(this.party.sheets).map((id) => [id, { choiceId: 'c' as const, roll: 10 }]));
    const played = fightRound(this.party, this.fight(), { ...dodging, ...votes });
    assert.equal(played.ended, null, played.lines.join('\n'));
    this.party = played.party;
    this.combat = played.combat;
    this.lines = played.lines;
  }

  private view() {
    return rulesView({ party: this.party, combat: this.fight(), dungeon: null }, this.lines).combat!;
  }

  private hudFoe(name: string) {
    const foe = this.view().hud.foes.find((f) => f.name === name);
    assert.ok(foe, `no ${name} on the HUD`);
    return foe;
  }

  private fight(): CombatState {
    assert.ok(this.combat, 'no fight has begun');
    return this.combat;
  }

  private foe(name: string) {
    const foe = Object.values(this.fight().combatants).find((c) => c.side === 'foes' && c.name === name);
    assert.ok(foe, `no foe ${name}`);
    return foe;
  }

  private setFoe(name: string, change: Partial<CombatState['combatants'][string]>): void {
    const foe = this.foe(name);
    this.combat = { ...this.fight(), combatants: { ...this.fight().combatants, [foe.id]: { ...foe, ...change } } };
  }

  private heroId(name: string): string {
    const id = Object.keys(this.party.sheets).find((k) => this.party.sheets[k].name === name);
    assert.ok(id, `no hero ${name}`);
    return id;
  }
}

/** Every object in a sent game state that stands for a foe: a combatant on the foes' side, and each HUD foe. */
function foeObjects(value: unknown, inFoes = false): Record<string, unknown>[] {
  if (Array.isArray(value)) return value.flatMap((v) => foeObjects(v, inFoes));
  if (value === null || typeof value !== 'object') return [];
  const o = value as Record<string, unknown>;
  const own = inFoes || o.side === 'foes' ? [o] : [];
  return [...own, ...Object.entries(o).flatMap(([k, v]) => foeObjects(v, k === 'foes' && Array.isArray(v)))];
}
