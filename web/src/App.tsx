import React from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import './global.css';
import Dashboard from './components/Dashboard';
import JobDetailsView from './Job_Details';

function App() {
  return (
    <Router>
      <div className="h-screen w-screen bg-gray-100">
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/job/:jobId" element={<JobDetailsView />} />
        </Routes>
      </div>
    </Router>
  );
}

export default App;