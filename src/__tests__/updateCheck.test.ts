import { afterEach, describe, expect, it, vi } from 'vitest';
import { compareVersions, fetchLatestRelease, isLocalBuild } from '../ui/updateCheck';

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

  it('picks the portable zip so a portable install is not sent at an installer', async () => {
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
