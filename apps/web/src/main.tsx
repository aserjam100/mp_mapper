import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, NavLink, Route, Routes } from 'react-router-dom';
import { STATIC_SITE, useSnapshotMeta } from './lib/api';
import { AboutPage } from './pages/About';
import { CoveragePage } from './pages/Coverage';
import { CurriculaPage } from './pages/Curricula';
import { NewCurriculumPage } from './pages/NewCurriculum';
import { ObjectivePage } from './pages/Objective';
import { ProductsPage } from './pages/Products';
import { RunPage } from './pages/Run';
import { RunsPage } from './pages/Runs';
import './styles.css';

const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: 60_000, refetchOnWindowFocus: false } } });

/** Read-only site: when the data was saved. */
function DataAsOf() {
  const q = useSnapshotMeta();
  if (!q.data) return null;
  const at = new Date(q.data.at).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
  return <span className="as-of">Read-only copy · data as of {at}</span>;
}

function App() {
  return (
    <>
      <header className="topbar">
        <span className="brand">PR1ME Curriculum Mapper</span>
        <nav>
          <NavLink to="/" end>
            Curricula
          </NavLink>
          <NavLink to="/products">Product browser</NavLink>
          {!STATIC_SITE && <NavLink to="/new">New curriculum</NavLink>}
          {!STATIC_SITE && <NavLink to="/runs">Matching runs</NavLink>}
          <NavLink to="/about">How to use</NavLink>
        </nav>
        {STATIC_SITE && <DataAsOf />}
      </header>
      <main>
        <Routes>
          <Route path="/" element={<CurriculaPage />} />
          <Route path="/curricula/:id" element={<CoveragePage />} />
          <Route path="/objectives/:id" element={<ObjectivePage />} />
          <Route path="/products" element={<ProductsPage />} />
          {!STATIC_SITE && <Route path="/new" element={<NewCurriculumPage />} />}
          {!STATIC_SITE && <Route path="/runs" element={<RunsPage />} />}
          {!STATIC_SITE && <Route path="/runs/:id" element={<RunPage />} />}
          <Route path="/about" element={<AboutPage />} />
          <Route path="*" element={<div className="empty">Page not found.</div>} />
        </Routes>
      </main>
    </>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);
