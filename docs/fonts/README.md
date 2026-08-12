# Why these are duplicated

The same four files live in `client/vendor/fonts/`. GitHub Pages serves only this
`docs/` directory, so the landing page cannot reach up into `client/`, and a
symlink is not reliably followed either.

176KB duplicated is cheaper than the alternative, which is the landing page
loading them from Google — on a page whose whole argument is that this app does
not send your data to third parties. It also means the page works offline.

If you replace the fonts, replace them in both places. `client/vendor/fonts/fonts.css`
says where they came from.
