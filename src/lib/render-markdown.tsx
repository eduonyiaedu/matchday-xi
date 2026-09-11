import * as React from "react";

// Minimal renderer for the small markdown subset used by legal/*.md: #/## headings, **bold**,
// "- " lists, bare URLs/emails, and plain paragraphs. Not a general-purpose markdown parser.

function renderInline(text: string, keyPrefix: string): React.ReactNode[] {
  const parts: React.ReactNode[] = [];
  const pattern = /\*\*(.+?)\*\*|(https?:\/\/[^\s)]+)|([\w.+-]+@[\w-]+\.[\w.-]+)/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let i = 0;

  while ((match = pattern.exec(text))) {
    if (match.index > lastIndex) parts.push(text.slice(lastIndex, match.index));
    if (match[1] !== undefined) {
      parts.push(<strong key={`${keyPrefix}-b-${i}`}>{match[1]}</strong>);
    } else if (match[2] !== undefined) {
      parts.push(
        <a
          key={`${keyPrefix}-l-${i}`}
          href={match[2]}
          className="underline underline-offset-2"
          target="_blank"
          rel="noreferrer"
        >
          {match[2]}
        </a>
      );
    } else if (match[3] !== undefined) {
      parts.push(
        <a key={`${keyPrefix}-m-${i}`} href={`mailto:${match[3]}`} className="underline underline-offset-2">
          {match[3]}
        </a>
      );
    }
    lastIndex = pattern.lastIndex;
    i++;
  }
  if (lastIndex < text.length) parts.push(text.slice(lastIndex));
  return parts;
}

export function renderMarkdown(markdown: string): React.ReactNode {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const blocks: React.ReactNode[] = [];
  let listItems: string[] = [];
  let key = 0;

  function flushList() {
    if (listItems.length === 0) return;
    const items = listItems;
    listItems = [];
    blocks.push(
      <ul key={`ul-${key++}`} className="list-disc space-y-1 pl-5">
        {items.map((item, idx) => (
          <li key={idx}>{renderInline(item, `li-${key}-${idx}`)}</li>
        ))}
      </ul>
    );
  }

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (line === "") {
      flushList();
      continue;
    }
    if (line.startsWith("# ")) {
      flushList();
      blocks.push(
        <h1 key={`h-${key}`} className="text-3xl font-bold tracking-tight">
          {renderInline(line.slice(2), `h1-${key++}`)}
        </h1>
      );
    } else if (line.startsWith("## ")) {
      flushList();
      blocks.push(
        <h2 key={`h-${key}`} className="mt-8 text-xl font-semibold">
          {renderInline(line.slice(3), `h2-${key++}`)}
        </h2>
      );
    } else if (line.startsWith("- ")) {
      listItems.push(line.slice(2));
    } else {
      flushList();
      blocks.push(
        <p key={`p-${key}`} className="leading-relaxed text-muted-foreground">
          {renderInline(line, `p-${key++}`)}
        </p>
      );
    }
  }
  flushList();

  return blocks;
}
