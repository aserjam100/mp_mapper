import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, NavLink, Route, Routes } from 'react-router-dom';
import { AboutPage } from './pages/About';
import { CoveragePage } from './pages/Coverage';
import { CurriculaPage } from './pages/Curricula';
import { ObjectivePage } from './pages/Objective';
import { ProductsPage } from './pages/Products';
import './styles.css';

const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: 60_000, refetchOnWindowFocus: false } } });

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
          <NavLink to="/about">How to use</NavLink>
        </nav>
      </header>
      <main>
        <Routes>
          <Route path="/" element={<CurriculaPage />} />
          <Route path="/curricula/:id" element={<CoveragePage />} />
          <Route path="/objectives/:id" element={<ObjectivePage />} />
          <Route path="/products" element={<ProductsPage />} />
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
