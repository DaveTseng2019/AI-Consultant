// notes: the repo pins 0.0.0 and only CI injects a real version from the tag, so a locally
//        built exe always reads as older than the newest release and Settings always offers an
//        update. That is the same trade-off the source project makes, and why build-local.mjs
//        stamps the commit beside the exe -- read build-info.json, not the version, to know
//        which build you are holding. Settings now shows that stamp itself (app_version_label),
//        so the answer is on screen; the comparison below still uses the pinned version.
export const DEFAULT_RELEASE_REPO = 'DaveTseng2019/AI-Consultant';

export interface LatestRelease {
  tagName: string;
  htmlUrl: string;
  /** Direct link to the Windows portable zip, on a release that ships one. */
  portableAssetUrl?: string;
}

const PORTABLE_ASSET_SUFFIX = '-windows-portable.zip';

interface ParsedVersion {
  major: number;
  minor: number;
  patch: number;
}

function parseVersion(value: string): ParsedVersion | null {
  const match = value.trim().match(/^v?(\d+)(?:\.(\d+))?(?:\.(\d+))?(?:[-+][0-9A-Za-z.-]+)?$/);
  if (!match) return null;

  return {
    major: Number(match[1]),
    minor: Number(match[2] ?? 0),
    patch: Number(match[3] ?? 0),
  };
}

export function compareVersions(current: string, latest: string): boolean {
  const currentVersion = parseVersion(current);
  const latestVersion = parseVersion(latest);
  if (!currentVersion || !latestVersion) return false;

  if (latestVersion.major !== currentVersion.major) return latestVersion.major > currentVersion.major;
  if (latestVersion.minor !== currentVersion.minor) return latestVersion.minor > currentVersion.minor;
  return latestVersion.patch > currentVersion.patch;
}

function isReleaseRepo(value: string): boolean {
  return /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(value);
}

function httpsUrl(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  try {
    return new URL(value).protocol === 'https:' ? value : undefined;
  } catch {
    return undefined;
  }
}

function portableAssetUrl(assets: unknown): string | undefined {
  if (!Array.isArray(assets)) return undefined;

  for (const asset of assets) {
    if (!asset || typeof asset !== 'object') continue;
    const { name, browser_download_url: downloadUrl } = asset as Record<string, unknown>;
    if (typeof name !== 'string' || !name.endsWith(PORTABLE_ASSET_SUFFIX)) continue;
    const url = httpsUrl(downloadUrl);
    if (url) return url;
  }
  return undefined;
}

function releaseFromJson(value: unknown): LatestRelease | null {
  if (!value || typeof value !== 'object') return null;
  const release = value as Partial<Record<'tag_name' | 'html_url' | 'assets', unknown>>;
  if (typeof release.tag_name !== 'string') return null;

  const htmlUrl = httpsUrl(release.html_url);
  if (!htmlUrl) return null;

  const portable = portableAssetUrl(release.assets);
  return { tagName: release.tag_name, htmlUrl, ...(portable ? { portableAssetUrl: portable } : {}) };
}

export async function fetchLatestRelease(repo = DEFAULT_RELEASE_REPO): Promise<LatestRelease | null> {
  if (!isReleaseRepo(repo)) return null;

  try {
    const response = await fetch(`https://api.github.com/repos/${repo}/releases/latest`, {
      headers: {
        Accept: 'application/vnd.github+json',
      },
    });
    if (!response.ok) return null;

    const data: unknown = await response.json();
    return releaseFromJson(data);
  } catch {
    return null;
  }
}
