import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

/**
 * Roadmap-only paid features (rulebook §12). Disabled by design — no payment logic exists
 * anywhere behind this card, it's purely a placeholder until Nigerian gaming-law licensing
 * (or an alternative compliant structure) is confirmed.
 */
export function ComingSoonCard({ title, description }: { title: string; description: string }) {
  return (
    <Card className="opacity-70">
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="text-base">{title}</CardTitle>
          <Badge variant="outline">Coming soon</Badge>
        </div>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent>
        <button
          type="button"
          disabled
          className="w-full cursor-not-allowed rounded-md border border-dashed py-2 text-sm text-muted-foreground"
        >
          Not available yet
        </button>
      </CardContent>
    </Card>
  );
}
