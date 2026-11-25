import { Link } from 'react-router-dom';

export function NotFoundPage() {
  return (
    <div className="mx-auto max-w-xl px-6 py-24 text-center">
      <p className="eyebrow">404</p>
      <h1 className="mt-3 text-2xl font-semibold">Nothing here</h1>
      <Link to="/" className="mt-6 inline-block font-mono text-sm text-accent underline-offset-4 hover:underline">
        ← back home
      </Link>
    </div>
  );
}
