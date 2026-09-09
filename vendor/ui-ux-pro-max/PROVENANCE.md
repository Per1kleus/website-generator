# ui-ux-pro-max — vendored

Design intelligence used by the website generator: 79 UI styles, colour
systems, font pairings, landing-page patterns, UX guidelines and reasoning
rules, with a Python query layer.

- Upstream: https://github.com/nextlevelbuilder/ui-ux-pro-max-skill
- Homepage: https://uupm.cc
- Version:  2.13.0
- Commit:   4aad0584d92131626b16d4ff4d77f0455385013c
- Licence:  MIT (see LICENSE)

## Why it is vendored

Generation must not depend on a network fetch at request time, and the design
output must be reproducible for a given input. The data and query scripts are
committed so a build produces the same recommendations offline.

## What was taken

- `data/`    the CSV/JSON catalogues
- `scripts/` the query and design-system layer
- `LICENSE`

Upstream's own test suite and fixtures are not vendored — they test the
upstream project, not this integration.

## Refreshing

    node scripts/refresh-uiux-skill.mjs

That re-clones upstream, replaces `data/` and `scripts/`, and rewrites this
file. Re-run `npm run test:mobile` afterwards: a catalogue change can move the
recommended palette or typography for a given business.
