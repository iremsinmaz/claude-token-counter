# Claude Token Counter

A browser extension that shows, as a small badge in the bottom-right corner of claude.ai, how many tokens the open chat takes up, the estimated load of the system prompt, and your account's usage limits. Works in Chrome and Safari.

```
Chat: ~12.4k tokens
Session limit        34%
Weekly limit         12%
Baseline estimate  94.6k tokens
```

Click the badge to see the details.

## How reliable is each number?

| Line | Source | Reliability |
|---|---|---|
| **Chat** | Messages and attachments, estimated from character count | Approximate. claude.ai doesn't expose thinking tokens, so they aren't included. |
| **Session / Weekly limit** | claude.ai's own `/usage` response | The server's value, not an estimate. |
| **Baseline estimate** | The system prompt sections for enabled features, pre-counted with `count_tokens` | The sections are counted exactly; that claude.ai uses exactly this prompt, and the section-to-feature mapping, are assumptions. |

The baseline is not added to the chat count; the two stay separate. Connector tools (Gmail, Calendar, Drive, Docs) are not added to the baseline, since there's no way to know which ones an account has connected; the details show them separately as "if connected".

## What does the extension access?

- It runs only on `https://claude.ai/*`. It asks for no special permission on other sites, tabs, cookies, or browsing history.
- All of its requests go to claude.ai (the open chat, account settings, usage limits). It sends no data anywhere else and stores nothing.
- All of the code is in [`extension/content.js`](extension/content.js).

On install, Safari shows a warning like "can read webpages and see browsing history". That's the standard text for any extension that reads page content; the permission is granted for claude.ai only.

> It uses claude.ai's undocumented internal endpoints. If claude.ai changes, the extension may break; if chat data can't be read, it falls back to the page text.

## Installation

The extension isn't in any store yet; in every browser it's installed from the folder, for free.

### Chrome (and Chromium-based browsers like Edge and Brave)

1. Download or clone the repo.
2. Open `chrome://extensions` → turn on **Developer mode** in the top right.
3. **Load unpacked** → select the `extension` folder.

When you update the code, click the extension's **Reload** button.

### Safari (macOS, requires Xcode)

1. Build with Xcode:
   ```sh
   cd "safari/Claude Token Counter"
   xcodebuild -project "Claude Token Counter.xcodeproj" -scheme "Claude Token Counter" \
     -configuration Release -derivedDataPath ../../build \
     CODE_SIGN_IDENTITY="-" CODE_SIGN_STYLE=Manual DEVELOPMENT_TEAM="" build
   ```
2. Safari → Settings → Advanced → **Show features for web developers**.
3. Develop → Developer Settings… → **Allow unsigned extensions**. (This has to be turned on again every time Safari restarts.)
4. Open the app once:
   ```sh
   open "build/Build/Products/Release/Claude Token Counter.app"
   ```
5. Safari → Settings → Extensions → enable **Claude Token Counter** and allow it on claude.ai.

## Updating the baseline

Anthropic updates the system prompt per model and version. The baseline isn't computed while the extension runs; it's counted once and written as fixed values into [`extension/baseline.js`](extension/baseline.js).

1. Save the current system prompt as `reference/<model>.md`. The file name sets the model id: `claude-opus-5.5.md` → `claude-opus-5-5`. The current baseline was counted from [`reference/claude-opus-5.5.md`](reference/claude-opus-5.5.md); newly added prompt files are kept out of the repo by `.gitignore` by default.
2. If needed, update the rules in [`reference/sections.json`](reference/sections.json). This is where each heading is mapped to a feature flag.
3. Run the count (`count_tokens` is free, but the prompt text is sent to the Anthropic API):
   ```sh
   ANTHROPIC_API_KEY=... node scripts/count-baseline.mjs
   ```
4. Reload the extension in Chrome; rebuild in Safari.

## Icon

The icons are drawn by [`scripts/make-icons.py`](scripts/make-icons.py) (requires Pillow): `python3 scripts/make-icons.py`. The Safari app icon is generated from them when the Xcode project is regenerated with `safari-web-extension-converter`.

## Acknowledgements

The feature flag names and the `/usage` endpoint were learned from [lugia19/Claude-Usage-Extension](https://github.com/lugia19/Claude-Usage-Extension). No code was taken from it; if you're looking for more comprehensive usage tracking, check out that extension.

## License

[MIT](LICENSE)
