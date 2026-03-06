"use client"

import { useState, useCallback } from "react"
import Link from "next/link"
import { cn } from "@/lib/utils"

const SlideSection = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <div>
    <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground mb-2">{label}</p>
    {children}
  </div>
)

const Bullet = ({ label, text }: { label: string; text: React.ReactNode }) => (
  <li className="flex gap-2 text-sm">
    <span className="font-medium text-foreground shrink-0">{label}</span>
    <span className="text-muted-foreground">{text}</span>
  </li>
)

const SLIDES = [
  {
    title: "Commitment",
    content: (
      <div className="max-w-2xl mx-auto space-y-8">
        <div className="text-center">
          <p className="font-[var(--font-bebas)] text-3xl sm:text-4xl tracking-tight text-accent">SilentBid</p>
          <p className="mt-2 text-lg text-foreground font-medium">Fair token launches. Sealed bids. No MEV.</p>
        </div>
        <SlideSection label="What we build">
          <ul className="space-y-3 text-sm">
            <Bullet label="Sealed-bid CCA" text="Bid price and size stay private until the auction closes." />
            <Bullet label="Same settlement" text="Uniswap CCA clearing and pool seed; we only privatize bidding." />
            <Bullet label="Powered by" text="Chainlink Confidential Compute + CRE for off-chain bid handling." />
          </ul>
        </SlideSection>
      </div>
    ),
  },
  {
    title: "Market & Why It Matters",
    content: (
      <div className="max-w-2xl mx-auto space-y-6">
        <div className="grid grid-cols-2 gap-3">
          <div className="border border-border rounded-lg p-3 bg-muted/20 text-center">
            <p className="font-mono text-xl font-semibold text-accent">$100B+</p>
            <p className="text-[10px] text-muted-foreground mt-0.5">MEV extracted (Ethereum, cumulative)</p>
          </div>
          <div className="border border-border rounded-lg p-3 bg-muted/20 text-center">
            <p className="font-mono text-xl font-semibold text-accent">Billions</p>
            <p className="text-[10px] text-muted-foreground mt-0.5">Token launch / LBP / CCA volume</p>
          </div>
        </div>
        <SlideSection label="Context">
          <ul className="space-y-2 text-sm">
            <Bullet label="CCA/LBP" text="Standard for fair price discovery; bids are public → MEV and sniping." />
            <Bullet label="TradFi" text="Uses sealed-bid for fairness; we bring that on-chain without changing CCA." />
          </ul>
        </SlideSection>
      </div>
    ),
  },
  {
    title: "Problem",
    content: (
      <div className="max-w-2xl mx-auto space-y-6">
        <SlideSection label="On public CCA / LBP today">
          <ul className="space-y-2 text-sm">
            <Bullet label="Visibility" text="Mempool + chain state reveal every bid before settlement." />
            <Bullet label="MEV" text="Bots front-run and copy; last-block sniping distorts outcomes." />
            <Bullet label="Who loses" text="Retail (worse execution), projects (diluted allocations, less trust)." />
          </ul>
        </SlideSection>
        <div className="pt-4 border-t border-border text-center text-sm">
          <p className="text-muted-foreground">Need <span className="text-accent font-medium">sealed-bid privacy</span> with same on-chain settlement — no new chain, no black box.</p>
        </div>
      </div>
    ),
  },
  {
    title: "Solution",
    content: (
      <div className="max-w-2xl mx-auto space-y-6">
        <p className="text-center text-foreground font-medium">
          <span className="text-accent">SilentBid</span> = Uniswap CCA + sealed bids via Chainlink CRE.
        </p>
        <SlideSection label="How it works">
          <ul className="space-y-2 text-sm">
            <Bullet label="On-chain" text="Only commitment (hash) + escrow; real bid stays off-chain until deadline." />
            <Bullet label="CRE" text="Stores bids privately; runs clearing + optional compliance; calls forwardBidsToCCA." />
            <Bullet label="Outcome" text="Same CCA clearing; no bid leakage; no MEV on bid data." />
          </ul>
        </SlideSection>
      </div>
    ),
  },
  {
    title: "How We're Building It",
    content: (
      <div className="max-w-2xl mx-auto space-y-4">
        <div className="grid gap-3 text-sm">
          <div className="flex gap-3 py-3 px-4 rounded-lg bg-accent/10 border border-accent/30">
            <span className="font-mono text-[10px] uppercase text-accent shrink-0 w-12">1. Bid</span>
            <p className="text-muted-foreground">EIP-712 sign → hash commitment in browser → <code className="text-accent">submitSilentBid(commitment)</code> + ETH. Only hash on-chain.</p>
          </div>
          <div className="flex gap-3 py-3 px-4 rounded-lg bg-amber-500/10 border border-amber-500/30">
            <span className="font-mono text-[10px] uppercase text-amber-600 shrink-0 w-12">2. CRE</span>
            <p className="text-muted-foreground">Private bid storage → clearing + compliance → <code className="text-amber-600">forwardBidsToCCA</code> (admin).</p>
          </div>
          <div className="flex gap-3 py-3 px-4 rounded-lg bg-muted/30 border border-border">
            <span className="font-mono text-[10px] uppercase text-muted-foreground shrink-0 w-12">3. Settle</span>
            <p className="text-muted-foreground">CCA clears; claim tokens; pool seeds. CCA unchanged — we only privatized bidding.</p>
          </div>
        </div>
      </div>
    ),
  },
  {
    title: "Architecture",
    content: (
      <div className="max-w-2xl mx-auto">
        <table className="w-full border border-border text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/30">
              <th className="p-2.5 text-left font-mono text-[10px] uppercase tracking-widest text-muted-foreground w-40">Layer</th>
              <th className="p-2.5 text-left font-mono text-[10px] uppercase tracking-widest text-muted-foreground">Role</th>
            </tr>
          </thead>
          <tbody className="[&_tr]:border-b [&_tr]:border-border text-sm">
            <tr><td className="p-2.5 font-mono">Uniswap CCA</td><td className="p-2.5 text-muted-foreground">Clearing, settlement, pool seed.</td></tr>
            <tr><td className="p-2.5 font-mono">SilentBidCCA</td><td className="p-2.5 text-muted-foreground">Commitment + escrow; CRE calls forwardBidsToCCA after deadline.</td></tr>
            <tr><td className="p-2.5 font-mono">Chainlink CRE</td><td className="p-2.5 text-muted-foreground">Private storage, EIP-712, compliance, onchain forward.</td></tr>
            <tr><td className="p-2.5 font-mono">App</td><td className="p-2.5 text-muted-foreground">Create auction, deploy SilentBid, place sealed bid.</td></tr>
          </tbody>
        </table>
      </div>
    ),
  },
  {
    title: "Demo & What's Live",
    content: (
      <div className="max-w-2xl mx-auto space-y-6">
        <SlideSection label="Live on Sepolia (and Anvil)">
          <ul className="space-y-2 text-sm">
            <Bullet label="Create auction" text="CCA + fund + activate + deploy SilentBid in one flow." />
            <Bullet label="Sealed bid" text="Price + amount → commitment → submitSilentBid + escrow (hash only on-chain)." />
            <Bullet label="CRE" text="Bid ingestion + finalize stub; full path: CRE → forwardBidsToCCA." />
          </ul>
        </SlideSection>
        <p className="text-center pt-2">
          <Link href="/auctions" className="text-accent font-mono text-xs uppercase tracking-widest hover:underline">View Auctions →</Link>
        </p>
      </div>
    ),
  },
  {
    title: "Thank you",
    content: (
      <div className="max-w-xl mx-auto text-center py-8">
        <p className="font-[var(--font-bebas)] text-4xl sm:text-5xl tracking-tight text-accent">Thank you</p>
        <p className="mt-4 font-mono text-sm text-muted-foreground">SilentBid — Sealed-bid token launches</p>
        <p className="mt-6 text-[10px] uppercase tracking-widest text-muted-foreground">Chainlink Hackathon · Privacy Track</p>
      </div>
    ),
  },
]

export default function PitchPage() {
  const [index, setIndex] = useState(0)
  const slide = SLIDES[index]
  const isFirst = index === 0
  const goNext = useCallback(() => {
    setIndex((i) => (i + 1) % SLIDES.length)
  }, [])

  const goPrev = useCallback(() => {
    setIndex((i) => (i - 1 + SLIDES.length) % SLIDES.length)
  }, [])

  return (
    <main className="min-h-screen w-full flex flex-col bg-background text-foreground">
      <div className="flex-1 flex flex-col items-center justify-center p-8 md:p-12">
        <div className="w-full max-w-4xl">
          <p className="font-mono text-xs text-muted-foreground mb-2">
            Pitch · Slide {index + 1} of {SLIDES.length}
          </p>

          <div className="border border-border bg-card p-6 md:p-10 min-h-[340px] flex flex-col justify-center rounded-sm">
            <h2 className="font-mono text-lg uppercase tracking-widest text-muted-foreground mb-6">
              {slide.title}
            </h2>
            <div className="text-foreground">
              {slide.content}
            </div>
          </div>

          <div className="flex items-center justify-between mt-8">
            <button
              type="button"
              onClick={goPrev}
              className="flex items-center gap-2 font-mono text-xs uppercase tracking-widest text-muted-foreground hover:text-accent transition-colors disabled:opacity-40 disabled:pointer-events-none"
              disabled={isFirst}
              aria-label="Previous slide"
            >
              <span aria-hidden>←</span> Prev
            </button>

            <div className="flex gap-2">
              {SLIDES.map((_, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => setIndex(i)}
                  className={cn(
                    "w-2 h-2 rounded-full transition-colors",
                    i === index ? "bg-accent" : "bg-muted-foreground/40 hover:bg-muted-foreground/60"
                  )}
                  aria-label={`Go to slide ${i + 1}`}
                />
              ))}
            </div>

            <button
              type="button"
              onClick={goNext}
              className="flex items-center gap-2 font-mono text-xs uppercase tracking-widest text-muted-foreground hover:text-accent transition-colors"
              aria-label="Next slide"
            >
              Next <span aria-hidden>→</span>
            </button>
          </div>
        </div>
      </div>

      <footer className="p-4 border-t border-border flex justify-center gap-6">
        <Link href="/" className="font-mono text-xs uppercase tracking-widest text-muted-foreground hover:text-accent transition-colors">
          ← Home
        </Link>
        <Link href="/auctions" className="font-mono text-xs uppercase tracking-widest text-muted-foreground hover:text-accent transition-colors">
          Auctions
        </Link>
      </footer>
    </main>
  )
}
