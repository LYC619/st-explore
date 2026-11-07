import type { ArchiveCharacter } from '@/types/archive';
import { normalizeCharacterCard } from '@/lib/png-parser';
import { createWorld } from '../world/simulation';
import { withIntelligence } from '../agents/state';
import { personaFromCard } from '../sanctuary/summon';
import { sceneFromText, startGal } from './scene';
export function createVisualStory(character: ArchiveCharacter) {
  const world = withIntelligence(createWorld(73)), card = normalizeCharacterCard(character.card);
  world.actors[0].name = character.name.slice(0, 100); world.intelligence!.personas.a0 = personaFromCard(character);
  return startGal(world, sceneFromText(character.name, character.name, card.firstMessage || card.scenario || '一段新的旅程，从相遇开始。', 'dusk'), 'story', 'a0');
}
