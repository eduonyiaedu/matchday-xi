import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const FEATURES = [
  {
    title: "Guess the XI",
    body: "1 goalkeeper + 10 free-form outfield picks. Build your lineup on a 1-4-4-2 pitch — the layout is just a starting point, place anyone anywhere.",
  },
  {
    title: "Scored the moment it drops",
    body: "+1 point per player who starts, +3 bonus for a perfect XI. Locks automatically 2 hours before kickoff.",
  },
  {
    title: "Climb two tables",
    body: "A global leaderboard and one just for your club's fans — plus your public Perfect XI count.",
  },
];

export default function MarketingHome() {
  return (
    <div className="flex min-h-svh flex-col">
      <header className="mx-auto flex w-full max-w-5xl items-center justify-between p-6">
        <span className="text-lg font-bold">Matchday XI</span>
        <div className="flex gap-2">
          <Button variant="ghost" asChild>
            <Link href="/login">Log in</Link>
          </Button>
          <Button asChild>
            <Link href="/signup">Get started</Link>
          </Button>
        </div>
      </header>

      <section className="mx-auto flex w-full max-w-5xl flex-1 flex-col items-center justify-center gap-6 p-6 text-center">
        <h1 className="text-4xl font-bold tracking-tight sm:text-5xl">
          Predict the starting XI.
          <br />
          Score when it&apos;s confirmed.
        </h1>
        <p className="max-w-xl text-lg text-muted-foreground">
          Pick your Premier League club, guess their lineup before it&apos;s official, and get
          scored the instant the real XI drops — free to play.
        </p>
        <Button size="lg" asChild>
          <Link href="/signup">Create your free account</Link>
        </Button>
      </section>

      <section className="mx-auto grid w-full max-w-5xl gap-4 p-6 pb-16 sm:grid-cols-3">
        {FEATURES.map((f) => (
          <Card key={f.title}>
            <CardHeader>
              <CardTitle className="text-base">{f.title}</CardTitle>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground">{f.body}</CardContent>
          </Card>
        ))}
      </section>
    </div>
  );
}
