import { lazy, Suspense } from 'react';
import { Route, Routes } from 'react-router';
import { Layout } from './components/Layout';
import { HomePage } from './pages/HomePage';
import { NotFoundPage } from './pages/NotFoundPage';

// The company page carries the charting library (Recharts, ~110 KB gzipped);
// splitting it off keeps the home page's download at its F2 size.
const CompanyPage = lazy(() => import('./pages/CompanyPage').then((m) => ({ default: m.CompanyPage })));

export function App() {
  return (
    <Layout>
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route
          path="/company/:ticker"
          element={
            <Suspense fallback={<p className="mx-auto max-w-[1200px] px-4 py-16 text-base text-muted sm:px-8">Loading…</p>}>
              <CompanyPage />
            </Suspense>
          }
        />
        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </Layout>
  );
}
