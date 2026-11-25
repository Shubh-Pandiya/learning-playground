import { Component, type ReactNode } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { useKafkaReport } from './store';
import { KafkaHome } from './pages/Home';
import { Lab } from './pages/Lab';
import { LessonPage } from './pages/Lesson';
import { DivePage, InternalsHome } from './pages/Internals';
import { DrillPage, DrillsHome } from './pages/Drills';
import { ComparePage } from './pages/Compare';
import { ReviewPage } from './pages/Review';
import { MethodPage } from './pages/Method';

class Boundary extends Component<{ children: ReactNode }, { err?: Error }> {
  state: { err?: Error } = {};
  static getDerivedStateFromError(err: Error) {
    return { err };
  }
  render() {
    if (this.state.err)
      return (
        <div className="p-8 font-mono text-sm">
          <p className="text-bad">Something broke in the Kafka playground: {this.state.err.message}</p>
          <a className="mt-2 inline-block underline" href="/kafka">
            Back to Kafka
          </a>
        </div>
      );
    return this.props.children;
  }
}

function Reporter() {
  useKafkaReport();
  return null;
}

export default function KafkaModule() {
  const loc = useLocation();
  return (
    <div className="h-[calc(100vh-var(--header-h))] min-h-[560px]">
      <Reporter />
      <Boundary key={loc.pathname}>
        <Routes>
          <Route index element={<KafkaHome />} />
          <Route path="lab" element={<Lab />} />
          <Route path="l/:id" element={<Navigate to="learn" replace />} />
          <Route path="l/:id/:mode" element={<LessonPage />} />
          <Route path="internals" element={<InternalsHome />} />
          <Route path="internals/:id" element={<DivePage />} />
          <Route path="drills" element={<DrillsHome />} />
          <Route path="drills/:kind/:id" element={<DrillPage />} />
          <Route path="compare" element={<ComparePage />} />
          <Route path="review" element={<ReviewPage />} />
          <Route path="method" element={<MethodPage />} />
          <Route path="*" element={<Navigate to="/kafka" replace />} />
        </Routes>
      </Boundary>
    </div>
  );
}
