// The top bar's ☕ : Vincent's support page (Stripe), in the browser (the window's
// open handler hands http(s) links to the system, never inside the app). Quiet on
// purpose : a small icon at the far right, after Black, and absent while no
// address is set (src/shared/links.ts).

import { SUPPORT_URL } from '@shared/links'

export function SupportButton(): JSX.Element | null {
  if (!SUPPORT_URL) return null
  return (
    <a
      href={SUPPORT_URL}
      target="_blank"
      rel="noreferrer"
      className="btn shrink-0 text-[12px] opacity-70 hover:opacity-100"
      title="Palinopsia is free and open source. If it plays a part in your work, you can buy its author a coffee (opens in your browser)."
      aria-label="Support Palinopsia : buy its author a coffee"
    >
      ☕
    </a>
  )
}
