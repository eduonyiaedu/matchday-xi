import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Footer } from "@/components/layout/footer";
import { LandingDemoPitch } from "@/components/marketing/landing-demo-pitch";

const FEATURES = [
  {
    title: "Guess the XI",
    body: "1 goalkeeper + 10 free-form outfield picks, plus U21 academy players who are eligible to start. Place anyone anywhere — formation is just a starting layout.",
  },
  {
    title: "Scored the moment it drops",
    body: "+10 points per player who starts, +25 bonus for a perfect XI. Locks two hours before kickoff.",
  },
  {
    title: "Climb two tables",
    body: "A global leaderboard and one just for your club's fans — plus your public Perfect XI count and tier.",
  },
];

export default function MarketingHome() {
  return (
    <div className="flex min-h-svh flex-col">
      <header className="mx-auto flex w-full max-w-5xl items-center justify-between p-6">
        <span className="flex items-baseline gap-1.5">
          <span className="font-heading text-lg font-bold tracking-[0.05em] uppercase">Matchday</span>
          <span className="font-heading text-lg font-bold tracking-[0.05em] text-gold uppercase">XI</span>
        </span>
        <div className="flex gap-2">
          <Button variant="ghost" asChild>
            <Link href="/login">Log in</Link>
          </Button>
          <Button asChild>
            <Link href="/signup">Get started</Link>
          </Button>
        </div>
      </header>

      <section className="relative overflow-hidden">
        <div className="pointer-events-none absolute -top-35 left-1/2 h-110 w-130 -translate-x-1/2 floodlight" />
        <div className="relative mx-auto flex w-full max-w-2xl flex-col items-center gap-5 p-6 pt-4 pb-10 text-center">
          <h1 className="font-heading text-4xl leading-[1.02] font-semibold uppercase sm:text-5xl">
            Call the XI before
            <br />
            the <span className="text-gold">manager does</span>
          </h1>
          <p className="max-w-lg text-[15px] text-muted-foreground">
            Pick your club&apos;s starting eleven before kickoff. Scored the second the real team sheet drops.
          </p>
          <div className="w-full max-w-sm">
            <LandingDemoPitch />
          </div>
          <Button size="lg" asChild className="mt-1">
            <Link href="/signup">Create your free account</Link>
          </Button>
        </div>
      </section>

      <section className="mx-auto flex w-full max-w-2xl flex-col divide-y divide-white/8 rounded-2xl bg-pitch-light shadow-[0_4px_14px_rgba(0,0,0,0.3),inset_0_0_0_1px_rgba(245,243,236,0.06)] sm:mx-auto sm:mb-16">
        {FEATURES.map((f) => (
          <div key={f.title} className="p-5">
            <p className="font-heading text-sm font-semibold uppercase">{f.title}</p>
            <p className="mt-1.5 text-[13px] text-muted-foreground">{f.body}</p>
          </div>
        ))}
      </section>
      <div className="pb-10" />

      <Footer />
    </div>
  );
}
