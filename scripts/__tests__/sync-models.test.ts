import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { syncKeepsakeModels } from '../sync-models.mjs';

describe('syncKeepsakeModels', () => {
  it('generates fallback sample keepsakes, companion glbs, and manifest when rawDir is empty', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cocnai-sync-'));
    const rawDir = path.join(tmp, 'models-raw');
    const outDir = path.join(tmp, 'public/models/keepsakes');
    const companionsDir = path.join(tmp, 'public/models/companions');
    const manifestPath = path.join(tmp, 'src/data/keepsakes.json');

    const manifest = await syncKeepsakeModels({ rawDir, outDir, companionsDir, manifestPath });
    expect(manifest.length).toBeGreaterThanOrEqual(3);
    expect(fs.existsSync(manifestPath)).toBe(true);
    expect(fs.existsSync(path.join(companionsDir, 'froakie.glb'))).toBe(true);
    expect(fs.existsSync(path.join(companionsDir, 'deerling.glb'))).toBe(true);
  });
});
