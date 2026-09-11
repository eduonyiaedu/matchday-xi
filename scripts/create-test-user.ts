/**
 * Creates a confirmed test account directly via the Supabase admin API — skips the real signup
 * email entirely, so it doesn't touch Supabase's rate-limited free-tier mailer. Share the email
 * and password you pass in with the tester; they log in directly, no confirmation step needed.
 *
 * Usage:
 *   npm run create-test-user -- --email=tester3@matchday-xi.test --password=Secret1234 --name="Tester Three"
 *
 * By default this does NOT stamp age/ToS consent timestamps, since the tester never actually
 * clicked those checkboxes — pass --consent only if you specifically need to test logic that
 * depends on consent being present.
 */
import "dotenv/config";
import { createClient } from "@supabase/supabase-js";

function arg(name: string): string | undefined {
  const prefix = `--${name}=`;
  return process.argv.find((a) => a.startsWith(prefix))?.slice(prefix.length);
}

async function main() {
  const email = arg("email");
  const password = arg("password");
  const displayName = arg("name");
  const stampConsent = process.argv.includes("--consent");

  if (!email || !password) {
    console.error(
      'Usage: npm run create-test-user -- --email=you@example.com --password=Secret1234 [--name="Display Name"] [--consent]'
    );
    process.exit(1);
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) {
    console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env");
    process.exit(1);
  }

  const admin = createClient(url, serviceRoleKey);
  const now = new Date().toISOString();

  const { error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: {
      ...(displayName ? { full_name: displayName } : {}),
      ...(stampConsent ? { ageConfirmedAt: now, tosConsentedAt: now } : {}),
    },
  });

  if (error) {
    console.error("Failed to create user:", error.message);
    process.exit(1);
  }

  console.log("Test account created — share these credentials with the tester:");
  console.log(`  Email:     ${email}`);
  console.log(`  Password:  ${password}`);
  console.log(`  Log in at: ${process.env.APP_BASE_URL ?? "http://localhost:3000"}/login`);
  if (!stampConsent) {
    console.log(
      "\nNote: age/ToS consent timestamps were left unset (the tester didn't click the real checkboxes)."
    );
  }
}

main();
