import { Route, Routes } from 'react-router';
import { Layout } from './components/Layout';
import { CompanyPage } from './pages/CompanyPage';
import { HomePage } from './pages/HomePage';
import { NotFoundPage } from './pages/NotFoundPage';

export function App() {
  return (
    <Layout>
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/company/:ticker" element={<CompanyPage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </Layout>
  );
}
