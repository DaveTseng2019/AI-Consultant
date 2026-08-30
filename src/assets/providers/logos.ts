import type { AIProvider } from '../../../shared/types';
import chatgptLogo from './chatgpt.png?inline';
import claudeLogo from './claude.png?inline';
import geminiLogo from './gemini.png?inline';
import grokLogo from './grok.png?inline';

// `?inline` on every import: these are 32px marks small enough that Vite would inline them anyway,
// but the markdown export embeds the value straight into the file, and a bundled URL there would
// point at nothing once the .md is opened outside the app.
export const PROVIDER_LOGOS: Record<AIProvider, string> = {
  chatgpt: chatgptLogo,
  claude: claudeLogo,
  gemini: geminiLogo,
  grok: grokLogo,
};
