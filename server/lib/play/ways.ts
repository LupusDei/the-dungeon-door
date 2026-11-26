/**
 * A way on as the players see it, for a move's label: how it is closed ("locked door"), and where it leads
 * once the party has been there ("Back to Narthex"). Never an exit id; ways alike from one area are told apart.
 */
import type { DungeonNode, Exit } from '../rules/dungeon.ts';
import type { DungeonState } from './state.ts';

/** What an area is called: what it is for ("Narthex"), else its name without the size ("Long hall"). */
export const areaName = (node: DungeonNode): string => node.purpose?.trim() || node.name.replace(/\s*\(.*$/, '') || node.name;

/** The area an exit comes out in once explored: past a fixed map's corridor, the room beyond it. */
function leadsTo(dungeon: DungeonState, exit: Exit): DungeonNode | undefined {
  const area = exit.to === null ? undefined : dungeon.map.nodes[exit.to];
  const beyond = area?.type === 'corridor' ? area.exits.find((x) => x.id === exit.id)?.to : undefined;
  return beyond ? dungeon.map.nodes[beyond] : area;
}

interface Way { lead: string; way: string }

function wayOf(dungeon: DungeonState, exit: Exit): Way {
  const known = leadsTo(dungeon, exit);
  const lead = known && dungeon.visited.includes(known.id) ? `Back to ${areaName(known)}` : 'Go on';
  return { lead, way: exit.connection.replaceAll('-', ' ') };
}

const ORDINALS = ['first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth', 'ninth', 'tenth'];
const told = ({ lead, way }: Way) => `${lead} (${way})`;

/** The label of the way through this exit from where the party is; an exit not there: "Go on". */
export function wayLabel(dungeon: DungeonState | null | undefined, exitId: string): string {
  const exits = (dungeon && dungeon.map.nodes[dungeon.at]?.exits) || [];
  const ways = exits.map((x) => wayOf(dungeon!, x));
  const mine = ways[exits.findIndex((x) => x.id === exitId)];
  if (!mine) return 'Go on';
  const alike = ways.filter((w) => told(w) === told(mine));
  if (alike.length === 1) return told(mine);
  return told({ lead: mine.lead, way: `${ORDINALS[alike.indexOf(mine)] ?? 'another'} ${mine.way}` });
}
