import type { AIProvider } from '../../shared/types';
import { PROVIDER_LOGOS } from '../assets/providers/logos';

// The provider name is always rendered next to the mark, so the image is decorative: an alt text
// here would make a screen reader announce every provider twice.
// One size for every mark in the app. The marks name the same four providers wherever they appear,
// and three different sizes read as three different things. Pass className only for something other
// than the size.
export function ProviderLogo({ provider, className = 'h-5 w-5' }: { provider: AIProvider; className?: string }) {
  return (
    <img
      src={PROVIDER_LOGOS[provider]}
      alt=""
      aria-hidden="true"
      // Two of the four marks ship on their own opaque tile (white for ChatGPT, black for Grok) and
      // two are transparent glyphs. The rounded box keeps the set looking like one row in both
      // themes instead of two bare glyphs beside two squares.
      className={`shrink-0 rounded-[0.1875rem] object-contain ${className}`}
    />
  );
}
