import { afterEach, describe, expect, it, vi } from 'vitest';
import { compareVersions, fetchLatestRelease, autoUpdateToggleLocked, isLocalBuild, selfUpdateLane } from '../ui/updateCheck';

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
