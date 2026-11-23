export interface PlaymatCoordinateItem {
  uid: string;
  playmatX?: number;
  playmatY?: number;
  playmatZ?: number;
  isLand?: boolean;
  isArtifactOrRock?: boolean;
  typeLine?: string;
}

export interface PlaymatDropPoint {
  x: number;
  y: number;
}

export function clampPlaymatX(x: number, min = 7, max = 93): number {
  if (!Number.isFinite(x)) return 50;
  return Math.round(Math.max(min, Math.min(max, x)) * 10) / 10;
}

export function clampPlaymatY(y: number, min = 13, max = 87): number {
  if (!Number.isFinite(y)) return 50;
  return Math.round(Math.max(min, Math.min(max, y)) * 10) / 10;
}

export function getNextPlaymatZ(items: ReadonlyArray<{ playmatZ?: number }>): number {
  let maxZ = 1;
  for (const item of items) {
    if (typeof item.playmatZ === 'number' && Number.isFinite(item.playmatZ)) {
      if (item.playmatZ > maxZ) maxZ = item.playmatZ;
    }
  }
  return maxZ + 1;
}

export function isBacklinePlaymatCard(item: {
  isLand?: boolean;
  isArtifactOrRock?: boolean;
  typeLine?: string;
}): boolean {
  if (item.isLand || item.isArtifactOrRock) return true;
  const lower = (item.typeLine || '').toLowerCase();
  if (lower.includes('land')) return true;
  return false;
}

/**
 * Picks a clean non-overlapping percentage coordinate on the Player's Playmat
 * (top half = frontline creatures & nonland permanents, bottom half = lands & mana sources).
 */
export function computeOpenPlayerPlaymatSpot(
  existing: ReadonlyArray<PlaymatCoordinateItem>,
  isBackline: boolean,
  dropPos?: PlaymatDropPoint
): { x: number; y: number; z: number } {
  const z = getNextPlaymatZ(existing);
  if (
    dropPos &&
    Number.isFinite(dropPos.x) &&
    Number.isFinite(dropPos.y)
  ) {
    return {
      x: clampPlaymatX(dropPos.x),
      y: clampPlaymatY(dropPos.y),
      z,
    };
  }

  const candidateXs = isBackline
    ? [10, 22, 34, 46, 58, 70, 82, 90]
    : [11, 25, 39, 53, 67, 81, 18, 32, 46, 60, 74, 88];
  const candidateYs = isBackline ? [74, 85, 62] : [23, 43, 58, 16];

  const coords = existing
    .filter((i) => typeof i.playmatX === 'number' && typeof i.playmatY === 'number')
    .map((i) => ({ x: i.playmatX as number, y: i.playmatY as number }));

  for (const y of candidateYs) {
    for (const x of candidateXs) {
      const collides = coords.some(
        (c) => Math.abs(c.x - x) < 9.5 && Math.abs(c.y - y) < 13
      );
      if (!collides) {
        return { x, y, z };
      }
    }
  }

  // Fallback with gentle offset when board is packed
  const count = existing.length;
  const fallbackX = 12 + ((count * 13) % 76);
  const fallbackY = isBackline ? 72 + ((count * 7) % 15) : 20 + ((count * 9) % 36);
  return {
    x: clampPlaymatX(fallbackX),
    y: clampPlaymatY(fallbackY),
    z,
  };
}

/**
 * Arranges all player battlefield permanents into tidy non-overlapping Frontline + Backline rows.
 */
export function tidyPlayerPlaymatPositions<T extends PlaymatCoordinateItem>(items: T[]): T[] {
  const frontline = items.filter((i) => !isBacklinePlaymatCard(i));
  const backline = items.filter((i) => isBacklinePlaymatCard(i));
  const posByUid = new Map<string, { x: number; y: number; z: number }>();

  const layoutGroup = (group: T[], baseY: number, rowStepY: number, maxCols: number) => {
    group.forEach((item, idx) => {
      const row = Math.floor(idx / maxCols);
      const col = idx % maxCols;
      const itemsInRow = Math.min(maxCols, group.length - row * maxCols);
      const stepX = itemsInRow <= 1 ? 0 : Math.min(15.5, 78 / (itemsInRow - 1));
      const totalSpan = stepX * Math.max(0, itemsInRow - 1);
      const startX = 50 - totalSpan / 2;
      const x = clampPlaymatX(itemsInRow <= 1 ? 50 : startX + col * stepX);
      const y = clampPlaymatY(baseY + row * rowStepY);
      posByUid.set(item.uid, { x, y, z: idx + 1 });
    });
  };

  layoutGroup(frontline, frontline.length > 6 ? 20 : 26, 22, 6);
  layoutGroup(backline, backline.length > 7 ? 71 : 77, 13, 7);

  return items.map((item, idx) => {
    const pos = posByUid.get(item.uid);
    if (!pos) return item;
    return {
      ...item,
      playmatX: pos.x,
      playmatY: pos.y,
      playmatZ: idx + 1,
    };
  });
}

/**
 * Picks a clean open spot on a Bot's playmat canvas (oriented top-down: backline at top, creatures forward).
 */
export function computeOpenBotPlaymatSpot(
  existing: ReadonlyArray<PlaymatCoordinateItem>,
  options?: { isBackline?: boolean; preferFront?: boolean }
): { x: number; y: number; z: number } {
  const z = getNextPlaymatZ(existing);
  const isBackline = Boolean(options?.isBackline);
  const preferFront = Boolean(options?.preferFront);

  const candidateXs = [14, 30, 46, 62, 78, 88, 22, 38, 54, 70];
  const candidateYs = isBackline
    ? [20, 32]
    : preferFront
    ? [66, 44, 28]
    : [46, 70, 28];

  const coords = existing
    .filter((i) => typeof i.playmatX === 'number' && typeof i.playmatY === 'number')
    .map((i) => ({ x: i.playmatX as number, y: i.playmatY as number }));

  for (const y of candidateYs) {
    for (const x of candidateXs) {
      const collides = coords.some(
        (c) => Math.abs(c.x - x) < 12 && Math.abs(c.y - y) < 18
      );
      if (!collides) {
        return { x, y, z };
      }
    }
  }

  const count = existing.length;
  return {
    x: clampPlaymatX(14 + ((count * 16) % 72), 10, 90),
    y: clampPlaymatY(isBackline ? 22 : 48 + ((count * 14) % 28), 16, 84),
    z,
  };
}

/**
 * Tidies a Bot / Opponent battlefield into clean formation rows.
 * If `includeBacklineSplit` is true (used in Multiplayer seats where lands are also tiles), lands go in top backline (`y~22%`) and creatures in frontline (`y~64%`).
 */
export function tidyBotPlaymatPositions<T extends PlaymatCoordinateItem>(
  items: T[],
  includeBacklineSplit = false
): T[] {
  if (!includeBacklineSplit) {
    return items.map((item, idx) => {
      const cols = 4;
      const row = Math.floor(idx / cols);
      const col = idx % cols;
      const itemsInRow = Math.min(cols, items.length - row * cols);
      const stepX = itemsInRow <= 1 ? 0 : Math.min(22, 72 / (itemsInRow - 1));
      const startX = 50 - (stepX * Math.max(0, itemsInRow - 1)) / 2;
      return {
        ...item,
        playmatX: clampPlaymatX(itemsInRow <= 1 ? 50 : startX + col * stepX, 11, 89),
        playmatY: clampPlaymatY(items.length <= 4 ? 50 : 34 + row * 34, 18, 82),
        playmatZ: idx + 1,
      };
    });
  }

  const backline = items.filter((i) => isBacklinePlaymatCard(i));
  const frontline = items.filter((i) => !isBacklinePlaymatCard(i));
  const posByUid = new Map<string, { x: number; y: number }>();

  const placeRow = (group: T[], baseY: number, stepY: number, cols: number) => {
    group.forEach((item, idx) => {
      const row = Math.floor(idx / cols);
      const col = idx % cols;
      const itemsInRow = Math.min(cols, group.length - row * cols);
      const stepX = itemsInRow <= 1 ? 0 : Math.min(18, 76 / (itemsInRow - 1));
      const startX = 50 - (stepX * Math.max(0, itemsInRow - 1)) / 2;
      posByUid.set(item.uid, {
        x: clampPlaymatX(itemsInRow <= 1 ? 50 : startX + col * stepX, 10, 90),
        y: clampPlaymatY(baseY + row * stepY, 16, 84),
      });
    });
  };

  placeRow(backline, 22, 16, 6);
  placeRow(frontline, frontline.length > 5 ? 58 : 66, 20, 5);

  return items.map((item, idx) => {
    const pos = posByUid.get(item.uid);
    if (!pos) return item;
    return {
      ...item,
      playmatX: pos.x,
      playmatY: pos.y,
      playmatZ: idx + 1,
    };
  });
}
