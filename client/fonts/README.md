# Fonts

Three faces, vendored here rather than fetched from a CDN. Two reasons: the app
is local and must work with no network, and a font served from someone else's
domain is a request that leaves this machine on every page load — which, for a
tool holding a full employment record, is a thing worth not doing.

These are the `latin` subsets only, taken from the Google Fonts CDN. All three
are licensed under the **SIL Open Font License 1.1**, which permits bundling
and redistribution provided the fonts are not sold on their own and the licence
travels with them. That is what this file is for.

| File | Family | Used for | Upstream |
|---|---|---|---|
| `newsreader-var.woff2` | Newsreader (variable, 400–700) | Headings, the fit score | https://fonts.google.com/specimen/Newsreader |
| `plex-sans-var.woff2` | IBM Plex Sans (variable, 400–600) | Interface text, labels, controls | https://fonts.google.com/specimen/IBM+Plex+Sans |
| `plex-sans-italic-var.woff2` | IBM Plex Sans Italic | Emphasis | as above |
| `plex-mono-400.woff2` | IBM Plex Mono 400 | The markdown editor, evidence refs | https://fonts.google.com/specimen/IBM+Plex+Mono |
| `plex-mono-500.woff2` | IBM Plex Mono 500 | Emphasis in the editor | as above |

Copyright and licence holders:

- **Newsreader** — Copyright 2019 The Newsreader Project Authors
  (https://github.com/productiontype/Newsreader), SIL OFL 1.1.
- **IBM Plex Sans / IBM Plex Mono** — Copyright 2017 IBM Corp.
  (https://github.com/IBM/plex), SIL OFL 1.1.

Full licence text: https://openfontlicense.org

## Replacing or updating them

`@font-face` lives at the top of `client/style.css`, and the two used on the
first screen are preloaded in `client/index.html`. If you swap a file, change
both. Keep the `.woff2` extension — `.gitattributes` marks those as binary, and
without that git would treat a font as text and corrupt it on checkout, which
shows up as the page quietly falling back to a system face rather than as an
error.
