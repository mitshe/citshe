import { Play } from "lucide-react";
import { MarkdownBlock } from "./markdown-block";

interface ExampleBlockProps {
  content: string;
}

export function ExampleBlock({ content }: ExampleBlockProps) {
  return (
    <div className="my-6 rounded-lg border border-border bg-surface-card overflow-hidden">
      <div className="px-4 py-2 bg-surface-inset border-b border-border flex items-center gap-2">
        <Play className="w-4 h-4 text-muted-foreground" />
        <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
          Example
        </span>
      </div>
      <div className="p-4">
        <MarkdownBlock content={content} />
      </div>
    </div>
  );
}
