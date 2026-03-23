export default function CaseExplorer() {
  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      <h2 className="text-xl font-semibold">Case Explorer</h2>
      <div className="flex gap-2 mb-4">
        {['All', 'False Positive', 'False Negative', 'Rule Hit', 'Model Hit'].map((label) => (
          <button
            key={label}
            className="px-3 py-1.5 rounded-md text-xs font-medium border border-border hover:bg-muted/50"
          >
            {label}
          </button>
        ))}
      </div>
      <div className="border rounded-lg p-12 bg-card text-center">
        <p className="text-muted-foreground">No case explanations yet.</p>
        <p className="text-xs text-muted-foreground mt-1">Run experiments to generate sample-level explanations.</p>
      </div>
    </div>
  );
}
