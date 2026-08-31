import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import capability from '../../src-tauri/capabilities/default.json';
import tauriConfig from '../../src-tauri/tauri.conf.json';

describe('Tauri control-pane security boundary', () => {
  it('grants IPC only to the local main webview', () => {
    expect(capability).toMatchObject({ webviews: ['main'] });
    expect(capability).not.toHaveProperty('windows');
    expect(capability).not.toHaveProperty('remote');
  });

  it('enables a production CSP while leaving Vite development usable', () => {
    expect(tauriConfig.app.security).toMatchObject({
      csp: {
        'default-src': "'self'",
        'connect-src': 'ipc: http://ipc.localhost https://api.github.com',
        'img-src': "'self' asset: http://asset.localhost blob: data:",
        'style-src': "'self' 'unsafe-inline'",
      },
      devCsp: null,
    });
  });

  // One command is spelled out in three places -- build.rs mints the permission, lib.rs registers
  // the handler, the capability grants it. Miss the capability and it compiles, ships, and fails in
  // the user's hands with "not allowed by ACL"; miss build.rs and the build panics on a permission
  // that does not exist. Nothing else compares the three.
  it('names every command in build.rs, the invoke handler, and the capability alike', () => {
    const read = (file: string) => readFileSync(new URL(`../../src-tauri/${file}`, import.meta.url), 'utf8');
    const names = (source: string, pattern: RegExp) =>
      [...source.matchAll(pattern)].map((match) => `allow-${match[1].replace(/_/g, '-')}`).sort();

    const minted = names(/commands\(&\[([\s\S]*?)\]\)/.exec(read('build.rs'))?.[1] ?? '', /"(\w+)"/g);
    const registered = names(
      /generate_handler!\[([\s\S]*?)\]/.exec(read('src/lib.rs'))?.[1] ?? '',
      /(?:^|::)(\w+),?\s*$/gm,
    );
    const granted = capability.permissions.filter((permission) => permission.startsWith('allow-')).sort();

    expect(minted.length).toBeGreaterThan(0);
    expect(registered).toEqual(minted);
    expect(granted).toEqual(minted);
  });
});
