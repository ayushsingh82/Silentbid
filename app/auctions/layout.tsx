import type { Metadata } from "next"
import { ConnectButtonWrapper } from "@/components/connect-button"
import { BlindPoolLogo } from "@/components/blindpool-logo"

export const metadata: Metadata = {
  title: "Auctions — BlindPool",
  description: "Sealed-bid Continuous Clearing Auctions. Privacy-first token launches.",
}

export default function AuctionsLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <main className="relative min-h-screen">
      <div className="grid-bg fixed inset-0 opacity-30" aria-hidden="true" />
      <header className="relative z-20 border-b border-border/30 bg-background/80 backdrop-blur-sm">
        <div className="flex items-center justify-between px-6 md:px-12 py-4 gap-4 flex-wrap">
          <BlindPoolLogo />
          <ConnectButtonWrapper />
        </div>
      </header>
      <div className="relative z-10">{children}</div>
    </main>
  )
}
