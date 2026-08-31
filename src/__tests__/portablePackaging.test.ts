import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const portablePackScript = readFileSync(
  new URL('../../scripts/pack-portable.mjs', import.meta.url),
  'utf8',
);

describe('portable package instructions', () => {
  it('describes the in-app update and where a failed one leaves its reason', () => {
    // The zip is the only documentation a portable user gets, so it has to say that the update
    // installs itself -- and name update-log.txt, the one place a failure after the app exits can
    // still be read.
    expect(portablePackScript).toContain('download and update');
    expect(portablePackScript).toContain('update-log.txt');
    expect(portablePackScript).toContain(
      'https://github.com/DaveTseng2019/AI-Consultant/releases/latest',
    );
  });

  it('names the folder inside the zip without the version', () => {
    // The update unzips over the folder that is already installed. A versioned folder name would
    // land the new build beside the old one instead of replacing it.
    expect(portablePackScript).toContain('`${metadata.slug}-windows-portable`');
  });
});
