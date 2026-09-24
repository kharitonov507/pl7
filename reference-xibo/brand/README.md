# Player Server visual branding

Native branding for the installed CMS image, loaded from `library/brand`.
Compose mounts each asset read-only and leaves other library assets intact.
Reapply/recreate: `docker compose -f reference-xibo/compose.yaml up -d --force-recreate cms-web`.
Hard-refresh existing browser sessions after updating logos.

`config.json` changes only the user-facing application/product labels and
logo link. Source-code links and licence/about notices are retained.
`theme.css` sizes the longer wordmark and hides the disabled news card.
The news feed was disabled using the CMS General settings, persisted in MySQL.

SVG sources are editable. To regenerate PNG/ICO assets with the existing
local canvas dependency: `node tools/build-brand-icons.mjs` from the project root.
The old `theme/PlayerServer` scaffold is superseded and not mounted.
