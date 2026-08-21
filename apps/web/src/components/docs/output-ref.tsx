interface OutputRefBlockProps {
  lines: string[];
}

export function OutputRefBlock({ lines }: OutputRefBlockProps) {
  return (
    <div className="my-4 rounded-lg bg-surface-inset p-4 font-mono text-sm overflow-x-auto border border-border">
      {lines.map((line, i) => {
        const [expr, result] = line.split(/\s*→\s*/);
        return (
          <div key={i} className="flex gap-4 py-0.5">
            <span className="text-ok">{expr}</span>
            {result && (
              <>
                <span className="text-text-subtle">→</span>
                <span className="text-muted-foreground">{result}</span>
              </>
            )}
          </div>
        );
      })}
    </div>
  );
}
