import type { RemoveOptions } from '@/lib/repo';
import type { CardItem } from '@/types/character-card';
import { createRepo } from '@/lib/repo';

const repo = createRepo<CardItem>('cards');

export async function getAllCards(): Promise<CardItem[]> {
  return repo.list();
}

export async function getCard(id: string): Promise<CardItem | undefined> {
  return repo.get(id);
}

export async function saveCard(item: CardItem): Promise<void> {
  return repo.put(item);
}

export async function deleteCard(id: string, options?: RemoveOptions): Promise<void> {
  return repo.remove(id, options);
}

/** 历史兼容存根：已取消按上限静默删除旧角色卡记录的行为。 */
export async function pruneAutoSavedCards(_keep = 5): Promise<string[]> {
  return [];
}
