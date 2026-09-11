import { getPrivacyPolicy } from "@/lib/legal";
import { renderMarkdown } from "@/lib/render-markdown";

export const metadata = {
  title: "Privacy Policy — Matchday XI",
};

export default async function PrivacyPage() {
  const content = await getPrivacyPolicy();

  return <article className="mx-auto max-w-3xl space-y-4 py-4">{renderMarkdown(content)}</article>;
}
