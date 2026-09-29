import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { AIProvider, ProviderState } from '../../shared/types';
import { TargetChips } from '../ui/TargetChips';

const providers: AIProvider[] = ['chatgpt', 'claude', 'meta'];
const states = Object.fromEntries(
  providers.map((provider) => [
    provider,
    { provider, webview: 'loaded', dom: 'ready', login: 'logged_in', thinking: false, lastStatusAt: 1 } satisfies ProviderState,
  ]),
) as Record<AIProvider, ProviderState>;

describe('TargetChips', () => {
  // In a role mode the user needs to see who reviews and who summarises; the logo already says
  // which AI it is, so the visible text is the role and the name stays reachable on hover.
  it('shows the role instead of the name in a role mode', () => {
    const html = renderToStaticMarkup(
      <TargetChips
        providers={providers}
        states={states}
        selected={['chatgpt', 'claude']}
        onChange={vi.fn()}
        roleBadges={{ chatgpt: '先答 A', claude: '審查' }}
      />,
    );

    expect(html).toContain('<span>先答 A</span>');
    expect(html).toContain('<span>審查</span>');
    expect(html).not.toContain('<span>ChatGPT</span>');
    expect(html).toContain('title="ChatGPT"');
    expect(html).toContain('aria-label="Claude · 審查"');
    expect(html).toContain('aria-label="Meta AI"');
  });

  it('keeps the AI name in free mode', () => {
    const html = renderToStaticMarkup(
      <TargetChips providers={providers} states={states} selected={['chatgpt']} onChange={vi.fn()} />,
    );

    expect(html).toContain('<span>ChatGPT</span>');
    expect(html).not.toContain('title=');
  });
});
