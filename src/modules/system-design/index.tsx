import { Component, type ReactNode } from 'react';
import { Route, Routes } from 'react-router-dom';
import { Button } from '@/shared/ui';
import { useSdReport } from './store';
import { Home } from './pages/Home';
import { Method } from './pages/Method';
import { PatternPage } from './pages/PatternPage';
import { Review } from './pages/Review';
import { Inside } from './pages/Inside';
import { Practice } from './pages/Practice';
import { DesignReview } from './pages/DesignReview';
import { Incident } from './pages/Incident';
import { Adr } from './pages/Adr';

class Boundary extends Component<{ children: ReactNode }, { error?: Error }> {
  state: { error?: Error } = {};
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="mx-auto max-w-xl px-6 py-20 text-center">
        <p className="eyebrow">System design playground</p>
        <h1 className="mt-2 font-mono text-xl font-semibold">Something broke on this screen</h1>
        <p className="mt-2 font-mono text-[12px] text-bad">{this.state.error.message}</p>
        <Button className="mt-4" onClick={() => this.setState({ error: undefined })}>
          Try again
        </Button>
      </div>
    );
  }
}

export default function SystemDesignModule() {
  useSdReport();
  return (
    <div className="h-[calc(100vh-var(--header-h))] min-h-[560px]">
      <Boundary>
        <Routes>
          <Route index element={<Home />} />
          <Route path="review" element={<Review />} />
          <Route path="method" element={<Method />} />
          <Route path="inside" element={<Inside />} />
          <Route path="inside/:kind" element={<Inside />} />
          <Route path="practice" element={<Practice />} />
          <Route path="practice/review/:id" element={<DesignReview />} />
          <Route path="practice/incident/:id" element={<Incident />} />
          <Route path="practice/adr/:id" element={<Adr />} />
          <Route path="p/:id" element={<PatternPage />} />
          <Route path="p/:id/:mode" element={<PatternPage />} />
          <Route path="*" element={<Home />} />
        </Routes>
      </Boundary>
    </div>
  );
}
