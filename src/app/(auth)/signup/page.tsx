import Link from "next/link";
import { Suspense } from "react";
import { AuthForm } from "@/components/auth/auth-form";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export default function SignupPage() {
  return (
    <div className="flex min-h-svh items-center justify-center p-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>Create your Matchday XI account</CardTitle>
          <CardDescription>Pick your club, guess the XI, climb the table.</CardDescription>
        </CardHeader>
        <CardContent>
          <Suspense>
            <AuthForm mode="signup" />
          </Suspense>
          <p className="mt-4 text-center text-sm text-muted-foreground">
            Already have an account? <Link href="/login" className="underline">Log in</Link>
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
