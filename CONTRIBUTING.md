# Contributing / 参与贡献

Bug reports, translations, documentation improvements, and focused pull requests in English or Chinese are welcome. For larger feature or layout changes, open an issue first to align on direction.

## Development setup

- Node.js 22 and `npm ci`
- Start local dev server: `npm run dev`
- Translation guide: [docs/I18N.md](docs/I18N.md) / [docs/I18N.zh-CN.md](docs/I18N.zh-CN.md)
- Isolated desktop testing: [docs/guides/native-test-isolation.md](docs/guides/native-test-isolation.md) (never run automated tests against a real library or production app identifier)

## Pull request checklist

1. Run `npm run verify:web` (and `npx playwright test --config=playwright.production.config.ts` when changing UI flows).
2. Keep SillyTavern source scanning read-only, preserve explicit writebacks and recovery paths, and surface read/save errors clearly instead of swallowing them with empty `catch` blocks.
3. Reuse the semantic theme tokens in `themes.css` / `index.css`, and verify both desktop keyboard shortcuts and mobile 44px touch targets.
4. Use synthetic cards, chats, and mocked responses in tests, screenshots, and issue/PR descriptions—never include private character data, chat logs, API keys, or build output folders (`dist/`, `site-dist/`, `release/`).

中文：欢迎用中英文提交问题反馈、翻译改进与聚焦的 PR，较大改动建议先开 issue 对齐方向。提交前请运行 `npm run verify:web`，使用合成示例复现或截图，保持 ST 来源只读、读写报错可见、双端交互顺手。
