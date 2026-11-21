import type { DeckVersionSnapshot } from '../types/deck';
import { normalizeDeckSnapshot } from './versionHistory';

const SHARED_PREFIX = 'manalens_shared_v1_';

export function generateShareableUrl(snapshot: DeckVersionSnapshot): string {
  try {
    const key = `${SHARED_PREFIX}${snapshot.id}`;
    window.localStorage.setItem(key, JSON.stringify(snapshot));
  } catch {
    // Ignore storage failure
  }

  const base = window.location.origin + window.location.pathname;
  return `${base}#share=${encodeURIComponent(snapshot.id)}`;
}

export function loadSharedDeckSnapshotFromUrl(): DeckVersionSnapshot | null {
  try {
    const hash = window.location.hash;
    if (!hash.includes('#share=')) return null;
    const match = hash.match(/#share=([^&]+)/);
    if (!match || !match[1]) return null;
    const id = decodeURIComponent(match[1]);
    const key = `${SHARED_PREFIX}${id}`;
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return normalizeDeckSnapshot(parsed);
  } catch {
    // Ignore parsing errors
  }
  return null;
}
