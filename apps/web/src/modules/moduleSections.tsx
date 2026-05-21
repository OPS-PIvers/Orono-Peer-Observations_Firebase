import { ExternalLink, FileText } from 'lucide-react';
import type { TiptapDoc } from '@ops/shared';
import type { ModuleItem, ModuleSection } from '@ops/shared';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { TiptapEditor } from '@/components/ui/tiptap-editor';

function sectionItems(items: ModuleItem[], sectionId: string, kind: ModuleItem['kind']) {
  return items
    .filter((i) => i.sectionId === sectionId && i.kind === kind)
    .slice()
    .sort((a, b) => a.order - b.order);
}

/** Parse the body string → TiptapDoc. Returns undefined on empty/invalid. */
function parseBody(body: string): TiptapDoc | undefined {
  if (!body.trim()) return undefined;
  try {
    const parsed: unknown = JSON.parse(body);
    if (typeof parsed === 'object' && parsed !== null && 'type' in parsed) {
      return parsed as TiptapDoc;
    }
  } catch {
    // not JSON — treat as empty
  }
  return undefined;
}

export function RichTextSection({ section }: { section: ModuleSection }) {
  const doc = parseBody(section.body);
  return (
    <Card>
      {section.title ? (
        <CardHeader>
          <CardTitle>{section.title}</CardTitle>
        </CardHeader>
      ) : null}
      <CardContent>
        {doc ? (
          <TiptapEditor value={doc} onChange={() => undefined} readOnly variant="full" />
        ) : (
          <p className="text-muted-foreground text-sm">Nothing here yet.</p>
        )}
      </CardContent>
    </Card>
  );
}

export function ResourceListSection({
  section,
  items,
}: {
  section: ModuleSection;
  items: ModuleItem[];
}) {
  const resources = sectionItems(items, section.id, 'resource');
  return (
    <Card>
      <CardHeader>
        <CardTitle>{section.title || 'Resources'}</CardTitle>
      </CardHeader>
      <CardContent>
        {resources.length === 0 ? (
          <EmptyState icon={FileText} title="No resources yet" />
        ) : (
          <ul className="divide-border divide-y">
            {resources.map((r) => {
              const href = r.linkUrl ?? r.fileUrl ?? '';
              return (
                <li key={r.itemId} className="flex items-center gap-2 py-2">
                  <FileText className="text-muted-foreground h-4 w-4 shrink-0" />
                  {href ? (
                    <a
                      href={href}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-primary inline-flex items-center gap-1 text-sm hover:underline"
                    >
                      {r.title}
                      <ExternalLink className="h-3 w-3" />
                    </a>
                  ) : (
                    <span className="text-sm">{r.title}</span>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

export function MaterialsSection({
  section,
  items,
  doneItemIds,
  onToggleDone,
}: {
  section: ModuleSection;
  items: ModuleItem[];
  doneItemIds: Set<string>;
  onToggleDone: (item: ModuleItem, done: boolean) => void;
}) {
  const materials = sectionItems(items, section.id, 'material');
  return (
    <Card>
      <CardHeader>
        <CardTitle>{section.title || 'Materials'}</CardTitle>
      </CardHeader>
      <CardContent>
        {materials.length === 0 ? (
          <EmptyState icon={FileText} title="No materials yet" />
        ) : (
          <ul className="space-y-3">
            {materials.map((m) => {
              const done = doneItemIds.has(m.itemId);
              return (
                <li key={m.itemId} className="flex items-start justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium">{m.title}</span>
                      {done ? <Badge tone="active">Done</Badge> : null}
                      {!done && m.dueDate ? <Badge tone="warning">Due {m.dueDate}</Badge> : null}
                    </div>
                    {m.description ? (
                      <p className="text-muted-foreground mt-0.5 text-sm">{m.description}</p>
                    ) : null}
                  </div>
                  <Button
                    variant={done ? 'outline' : 'default'}
                    size="sm"
                    className="shrink-0"
                    onClick={() => onToggleDone(m, !done)}
                  >
                    {done ? 'Undo' : 'Mark done'}
                  </Button>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
