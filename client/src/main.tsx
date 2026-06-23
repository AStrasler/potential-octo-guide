import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { Analytics } from '@vercel/analytics/react';

function App() {
  return (
    <>
      <div>
        <h1>Welcome to ScholarScan</h1>
        <p>Academic Integrity Suite</p>
      </div>
      <Analytics />
    </>
  );
}

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error('Root element not found');
}

createRoot(rootElement).render(
  <StrictMode>
    <App />
  </StrictMode>
);
