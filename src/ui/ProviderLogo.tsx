import type { AIProvider } from '../../shared/types';
import { PROVIDER_LOGOS } from '../assets/providers/logos';

// The provider name is always rendered next to the mark, so the image is decorative: an alt text
// here would make a screen reader announce every provider twice.
export function ProviderLogo({ provider, className = 'h-4 w-4' }: { provider: AIProvider; className?: string }) {
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
