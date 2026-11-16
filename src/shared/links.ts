// Palinopsia's outside links, in one place.
//
// SUPPORT_URL : Vincent's support page (Buy Me a Coffee). Set it with
//   npm run support-link <https://… | Buy Me a Coffee username> [--stripe-button <id> <key>]
// which also fills the README, the site (docs/index.html) and GitHub's Sponsor
// button (.github/FUNDING.yml). While it is empty the app shows no ☕ button, and a
// release build (a v* tag) fails (scripts/release-check.mjs), so a release never
// ships without it, nor with a guessed address.
export const SUPPORT_URL = 'https://buymeacoffee.com/filliformes'

// SIGNAL_FLOW_URL : the site's interactive map of how Palinopsia runs (docs/signal-flow.html,
//   drawn by npm run signal-flow) : every input, path, output and feedback loop. Opened
//   in the browser from the Performance tab and from Search.
export const SIGNAL_FLOW_URL = 'https://filliformes.github.io/palinopsia/signal-flow.html'
