import React from 'react';
import { SpeedInsights } from '@vercel/speed-insights/react';

function App() {
  return (
    <div className="min-h-screen bg-gray-50">
      <h1>ScholarScan – Academic Integrity Suite</h1>
      <p>Professional-grade AI detection, plagiarism checking, and citation validation for students.</p>
      <SpeedInsights />
    </div>
  );
}

export default App;
