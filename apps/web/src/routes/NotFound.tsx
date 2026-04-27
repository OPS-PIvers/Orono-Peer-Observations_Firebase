import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';

export function NotFound() {
  return (
    <section className="bg-background border-border mx-auto mt-12 max-w-xl rounded-lg border p-8 text-center shadow-sm">
      <h1 className="text-ops-blue-dark mb-3 text-2xl font-bold">Page not found</h1>
      <p className="text-muted-foreground mb-6">
        The page you&apos;re looking for doesn&apos;t exist (yet) or has moved.
      </p>
      <Button asChild>
        <Link to="/">Back to home</Link>
      </Button>
    </section>
  );
}
