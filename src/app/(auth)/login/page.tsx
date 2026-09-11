import Link from "next/link";
import { Suspense } from "react";
import { AuthForm } from "@/components/auth/auth-form";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Footer } from "@/components/layout/footer";

export default function LoginPage() {
  return (
    <div className="flex min-h-svh flex-col">
      <div className="flex flex-1 items-center justify-center p-4">
        <Card className="w-full max-w-sm">
          <CardHeader>
            <CardTitle>Log in to Matchday XI</CardTitle>
            <CardDescription>Predict the XI. Score when it drops.</CardDescription>
          </CardHeader>
          <CardContent>
            <Suspense>
              <AuthForm mode="login" />
            </Suspense>
            <p className="mt-4 text-center text-sm text-muted-foreground">
              No account? <Link href="/signup" className="underline">Sign up</Link>
            </p>
          </CardContent>
        </Card>
      </div>
      <Footer />
    </div>
  );
}
