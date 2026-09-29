import { AI_PROVIDERS } from '../../shared/constants';
import type { AIProvider, ProviderState } from '../../shared/types';
import { isSendable } from '../workflow';
import { ProviderLogo } from './ProviderLogo';
import { toggleTarget } from './targets';

export function TargetChips({
  providers,
  states,
  selected,
  onChange,
  disabled = false,
  canToggle,
  roleBadges,
}: {
  providers: AIProvider[];
  states: Record<AIProvider, ProviderState>;
  selected: AIProvider[];
  onChange: (selected: AIProvider[], toggled: AIProvider) => void;
  disabled?: boolean;
  /** When set, only the chips it accepts can be clicked; the rest stay frozen. */
  canToggle?: (provider: AIProvider) => boolean;
  /** In a role mode the chip shows the role instead of the AI name; the name moves to the tooltip. */
  roleBadges?: Partial<Record<AIProvider, string>>;
}) {
  return (
    <>
      {providers.map((provider) => {
        const sendable = isSendable(states[provider]);
        const active = selected.includes(provider);
        const isCheckedOn = active && sendable;
        const name = AI_PROVIDERS[provider].name;
        const badge = roleBadges?.[provider];
        return (
          <button
            key={provider}
            type="button"
            disabled={!sendable || disabled || (canToggle !== undefined && !canToggle(provider))}
            onClick={() => onChange(toggleTarget(selected, provider), provider)}
            aria-pressed={isCheckedOn}
            title={roleBadges ? name : undefined}
            aria-label={roleBadges ? (badge ? `${name} · ${badge}` : name) : undefined}
            className={`border-2 px-2 py-1 text-xs ${
              isCheckedOn
                ? 'border-emerald-400 dark:border-emerald-500 bg-emerald-50 dark:bg-emerald-950 text-emerald-800 dark:text-emerald-200'
                : 'border-zinc-300 dark:border-zinc-700 text-zinc-600 dark:text-zinc-400 disabled:opacity-60'
            }`}
          >
            <span className="flex items-center gap-1.5">
              {isCheckedOn ? (
                <svg viewBox="0 0 24 24" className="h-3.5 w-3.5 shrink-0 text-emerald-600 dark:text-emerald-400" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M20 6 9 17l-5-5" />
                </svg>
              ) : null}
              <ProviderLogo provider={provider} />
              {roleBadges ? (badge ? <span>{badge}</span> : null) : <span>{name}</span>}
            </span>
          </button>
        );
      })}
    </>
  );
}
