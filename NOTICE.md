# Notices

AI Consultant is distributed under the [MIT License](./LICENSE).

Copyright © 2026 Ted Huang (teddashh) — original author of multi-ai-chat-desktop.
Copyright © 2026 Dave Tseng — modifications in this fork.

Portions of this project adapt MIT-licensed ideas or implementation patterns from:

- [`teddashh/multi-ai-chat-desktop`](https://github.com/teddashh/multi-ai-chat-desktop) — this project's code originates here
- [`teddashh/multi-ai-chat`](https://github.com/teddashh/multi-ai-chat)
- [`tony1223/better-agent-terminal`](https://github.com/tony1223/better-agent-terminal)

The repository history and study notes retain more detailed provenance where applicable.

## Provider logos

`src/assets/providers/*.png` are the marks of ChatGPT (OpenAI), Claude (Anthropic), Gemini
(Google) and Grok (xAI). They are bundled only to identify which service each row of the UI
connects to; the trademarks belong to their owners and this project is not affiliated with,
endorsed by, or a product of any of them. Redistribution terms for the individual files have NOT
been confirmed. If any owner objects, delete the file and its import in `src/ui/ProviderLogo.tsx`;
the provider name is always rendered beside the mark, so nothing else depends on it.

## Application icon

The AI Consultant application icon (`src/assets/app-icon.svg` and the generated files in
`src-tauri/icons/`) draws the brain-circuit glyph from the koboyo hand-drawn icon library
(<https://koboyo.com>), recoloured and placed on a tile. The licence terms for redistributing
that glyph inside this repository have NOT been confirmed. If they turn out to disallow it,
replace the glyph; nothing else in the project depends on it.
