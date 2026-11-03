import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  compareVersions,
  displayVersion,
  fetchLatestRelease,
  autoUpdateToggleLocked,
  isLocalBuild,
  isSkippedVersion,
  selfUpdateLane,
  updatePrompt,
} from '../ui/updateCheck';
import { t as translateKey } from '../i18n/t';

describe('update prompt', () => {
  it('shows both versions in tag form and names the three answers', () => {
    const prompt = updatePrompt(
      { kind: 'installer', url: 'https://example.invalid/x_x64-setup.exe' },
      '0.0.28',
      'v0.0.29',
      (key) => translateKey(key, 'zh-TW'),
    );
    expect(prompt.message).toContain('目前版本：v0.0.28');
    expect(prompt.message).toContain('新版本：v0.0.29');
    expect(prompt.message).toContain('安裝檔');
    expect(prompt).toMatchObject({ install: '立即更新', skip: '略過這個版本', later: '稍後再說' });
  });

  it('uses the portable wording for a portable lane, in every language', () => {
    for (const locale of ['en', 'zh-TW', 'ja', 'de'] as const) {
      const prompt = updatePrompt({ kind: 'portable', url: 'u' }, '1.0.0', 'v1.1.0', (key) => translateKey(key, locale));
      expect(prompt.message).toContain('v1.0.0');
      expect(prompt.message).toContain('v1.1.0');
      expect(prompt.message).not.toMatch(/\{current\}|\{latest\}/);
      expect(new Set([prompt.install, prompt.skip, prompt.later]).size).toBe(3);
    }
  });

  it('prefixes v only where it is missing', () => {
    expect(displayVersion('0.0.28')).toBe('v0.0.28');
    expect(displayVersion('v0.0.29')).toBe('v0.0.29');
  });
});

describe('skipped version', () => {
  it('matches the same release with or without the leading v, and nothing when empty', () => {
    expect(isSkippedVersion('v0.0.29', 'v0.0.29')).toBe(true);
    expect(isSkippedVersion('0.0.29', 'v0.0.29')).toBe(true);
    expect(isSkippedVersion('v0.0.29', 'v0.0.30')).toBe(false);
    expect(isSkippedVersion('', 'v0.0.29')).toBe(false);
  });
});

describe('local build detection', () => {
  it('recognises the pinned placeholder version only', () => {
    expect(isLocalBuild('0.0.0')).toBe(true);
    expect(isLocalBuild(' 0.0.0 ')).toBe(true);
    expect(isLocalBuild('0.0.13')).toBe(false);
    expect(isLocalBuild('v0.0.13-1-g5e59721')).toBe(false);
  });
});

describe('update version comparison', () => {
  it('treats equal versions as not newer', () => {
    expect(compareVersions('1.2.3', '1.2.3')).toBe(false);
    expect(compareVersions('v1.2.3', '1.2.3')).toBe(false);
    expect(compareVersions('1.2.3', 'v1.2.3')).toBe(false);
  });

  it('detects newer patch, minor, and major releases', () => {
    expect(compareVersions('1.2.3', '1.2.4')).toBe(true);
    expect(compareVersions('1.2.3', '1.3.0')).toBe(true);
    expect(compareVersions('1.2.3', '2.0.0')).toBe(true);
  });

  it('does not report older versions as newer', () => {
    expect(compareVersions('1.2.3', '1.2.2')).toBe(false);
    expect(compareVersions('1.2.3', '1.1.9')).toBe(false);
    expect(compareVersions('1.2.3', '0.9.9')).toBe(false);
  });

  it('tolerates leading v prefixes', () => {
    expect(compareVersions('v1.2.3', 'v1.2.4')).toBe(true);
    expect(compareVersions('v1.2.3', 'v1.3.0')).toBe(true);
    expect(compareVersions('v1.2.3', 'v2.0.0')).toBe(true);
  });

  it('compares prerelease and build suffixes by numeric core', () => {
    expect(compareVersions('1.2.3-beta.1', '1.2.4-beta.1')).toBe(true);
    expect(compareVersions('1.2.3', '1.2.3-beta.1')).toBe(false);
    expect(compareVersions('1.2.3+build.1', '1.2.3+build.2')).toBe(false);
    expect(compareVersions('1.2.3-alpha.1', '1.3.0-alpha.1')).toBe(true);
  });

  it('treats malformed input as not newer', () => {
    expect(compareVersions('1.2.x', '1.2.4')).toBe(false);
    expect(compareVersions('1.2.3', 'latest')).toBe(false);
    expect(compareVersions('', '1.2.4')).toBe(false);
    expect(compareVersions('1.2.3.4', '1.2.5')).toBe(false);
  });
});

describe('latest release parsing', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function stubRelease(body: unknown) {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve(body) })),
    );
  }

  // Each lane runs only its own file: a portable folder is never handed the installer, and the
  // installer lane is never handed the zip.
  it('picks the portable zip and the installer separately', async () => {
    stubRelease({
      tag_name: 'v1.2.3',
      html_url: 'https://github.com/owner/repo/releases/tag/v1.2.3',
      assets: [
        { name: 'AI-Consultant_1.2.3_x64-setup.exe', browser_download_url: 'https://example.com/setup.exe' },
        { name: 'ai-consultant-1.2.3-windows-portable.zip', browser_download_url: 'https://example.com/portable.zip' },
      ],
    });

    await expect(fetchLatestRelease('owner/repo')).resolves.toEqual({
      tagName: 'v1.2.3',
      htmlUrl: 'https://github.com/owner/repo/releases/tag/v1.2.3',
      portableAssetUrl: 'https://example.com/portable.zip',
      installerAssetUrl: 'https://example.com/setup.exe',
    });
  });

  it('falls back to the release page when no portable asset is trustworthy', async () => {
    stubRelease({
      tag_name: 'v1.2.3',
      html_url: 'https://github.com/owner/repo/releases/tag/v1.2.3',
      assets: [{ name: 'ai-consultant-1.2.3-windows-portable.zip', browser_download_url: 'http://example.com/portable.zip' }],
    });

    await expect(fetchLatestRelease('owner/repo')).resolves.toEqual({
      tagName: 'v1.2.3',
      htmlUrl: 'https://github.com/owner/repo/releases/tag/v1.2.3',
    });
  });
});

describe('selfUpdateLane', () => {
  const release = { portableAssetUrl: 'https://example.com/portable.zip', installerAssetUrl: 'https://example.com/setup.exe' };

  // Unzipping over an installed copy, or running the installer inside a portable folder, would
  // leave a broken or duplicated app, so each kind of build gets only its own file.
  it('gives a portable folder the zip and an installed copy the installer', () => {
    expect(selfUpdateLane({ portable: true, installed: false }, release)).toEqual({ kind: 'portable', url: release.portableAssetUrl });
    expect(selfUpdateLane({ portable: false, installed: true }, release)).toEqual({ kind: 'installer', url: release.installerAssetUrl });
  });

  it('leaves only the release page when the build or the release has no matching file', () => {
    expect(selfUpdateLane({ portable: false, installed: false }, release)).toBeUndefined();
    expect(selfUpdateLane({ portable: true, installed: false }, { installerAssetUrl: release.installerAssetUrl })).toBeUndefined();
    expect(selfUpdateLane({ portable: false, installed: true }, { portableAssetUrl: release.portableAssetUrl })).toBeUndefined();
  });
});

describe('autoUpdateToggleLocked', () => {
  const unsupported = { portable: false, installed: false, checkUpdatesOnStartup: true };

  // The settings file is shared by every build. A box ticked on an installed copy shows up ticked on
  // a dev build or a Mac, and a locked ticked box is one the user can never clear.
  it('never locks a ticked box, even where the option cannot work', () => {
    expect(autoUpdateToggleLocked({ ...unsupported, autoUpdateOnStartup: true })).toBe(false);
    expect(autoUpdateToggleLocked({ portable: true, installed: false, checkUpdatesOnStartup: false, autoUpdateOnStartup: true })).toBe(false);
  });

  it('refuses to turn it on without an install lane or without the startup check', () => {
    expect(autoUpdateToggleLocked({ ...unsupported, autoUpdateOnStartup: false })).toBe(true);
    expect(autoUpdateToggleLocked({ portable: false, installed: true, checkUpdatesOnStartup: false, autoUpdateOnStartup: false })).toBe(true);
    expect(autoUpdateToggleLocked({ portable: false, installed: true, checkUpdatesOnStartup: true, autoUpdateOnStartup: false })).toBe(false);
  });
});
