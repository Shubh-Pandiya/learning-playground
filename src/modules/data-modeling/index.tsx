import { Component, type ReactNode } from 'react';
import { Route, Routes } from 'react-router-dom';
import { Button } from '@/shared/ui';
import { useDmReport } from './store';
import { Home } from './pages/Home';
import { Method } from './pages/Method';
import { Review } from './pages/Review';
import { TopicPage } from './pages/TopicPage';

class Boundary extends Component<{ children: ReactNode }, { error?: Error }> {
  state: { error?: Error } = {};
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="mx-auto max-w-xl px-6 py-20 text-center">
        <p className="eyebrow">Data modelling playground</p>
        <h1 className="mt-2 font-mono text-xl font-semibold">Something broke on this screen</h1>
        <p className="mt-2 font-mono text-[12px] text-bad">{this.state.error.message}</p>
        <Button className="mt-4" onClick={() => this.setState({ error: undefined })}>
          Try again
        </Button>
      </div>
    );
  }
}

export default function DataModelingModule() {
  useDmReport();
  return (
    <div className="h-[calc(100vh-var(--header-h))] min-h-[560px]">
      <Boundary>
        <Routes>
          <Route index element={<Home />} />
          <Route path="review" element={<Review />} />
          <Route path="method" element={<Method />} />
          <Route path="t/:id" element={<TopicPage />} />
          <Route path="t/:id/:mode" element={<TopicPage />} />
          <Route path="*" element={<Home />} />
        </Routes>
      </Boundary>
    </div>
  );
}
