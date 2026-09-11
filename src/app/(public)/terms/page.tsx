import { getTermsOfService } from "@/lib/legal";
import { renderMarkdown } from "@/lib/render-markdown";

export const metadata = {
  title: "Terms of Service — Matchday XI",
};

export default async function TermsPage() {
  const content = await getTermsOfService();

  return <article className="mx-auto max-w-3xl space-y-4 py-4">{renderMarkdown(content)}</article>;
}
