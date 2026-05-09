import React, { useEffect, useState } from 'react';
import { Routes, Route, useLocation } from 'react-router-dom';
import Sidebar from './components/Sidebar.jsx';
import I from './components/Icons.jsx';
import Dashboard from './pages/Dashboard.jsx';
import Upload from './pages/Upload.jsx';
import Batches from './pages/Batches.jsx';
import BatchDetail from './pages/BatchDetail.jsx';
import Mappings from './pages/Mappings.jsx';
import Explore from './pages/Explore.jsx';
import Tasks from './pages/Tasks.jsx';
import TaskDetail from './pages/TaskDetail.jsx';
import { getHealth } from './api/endpoints.js';

function Titlebar({ health }) {
  const dot = health?.status === 'ok' ? '' : ' warn';
  return (
    <div className="titlebar">
      <div className="brand">
        <span className="mark">Σ</span>
        <span className="name">ALN Resonator Data Platform</span>
        <span className="ver">v0.2 · build 2026.05.09</span>
      </div>
      <div className="spacer" />
      <div className="right">
        <span className={`pill${dot}`}>
          <span className="dot" />api · {health?.status || '...'}
        </span>
        <span className={`pill${health?.db === 'ok' ? '' : ' warn'}`}>
          <span className="dot" />pg · {health?.db || '...'}
        </span>
        <span className={`pill${health?.redis === 'ok' ? '' : ' warn'}`}>
          <span className="dot" />redis · {health?.redis || '...'}
        </span>
      </div>
    </div>
  );
}

function Statusbar() {
  const loc = useLocation();
  return (
    <div className="statusbar">
      <span className="seg">
        <span className="dot" />CONNECTED
      </span>
      <span className="seg">PostgreSQL 15</span>
      <span className="seg">Redis · 7</span>
      <span className="seg">Celery</span>
      <span className="spacer" />
      <span className="seg">
        path: <b style={{ color: '#fff' }}>{loc.pathname}</b>
      </span>
      <span className="seg">tz: Asia/Shanghai</span>
      <span className="seg">© aln-data 2026</span>
    </div>
  );
}

export default function App() {
  const [health, setHealth] = useState(null);

  useEffect(() => {
    let alive = true;
    const tick = () =>
      getHealth()
        .then((h) => alive && setHealth(h))
        .catch(() => alive && setHealth({ status: 'down', db: 'down', redis: 'down' }));
    tick();
    const id = setInterval(tick, 15000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  return (
    <div className="app">
      <Titlebar health={health} />
      <Sidebar />
      <div className="main">
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/explore" element={<Explore />} />
          <Route path="/batches" element={<Batches />} />
          <Route path="/batches/:batchNo" element={<BatchDetail />} />
          <Route path="/mappings" element={<Mappings />} />
          <Route path="/upload" element={<Upload />} />
          <Route path="/tasks" element={<Tasks />} />
          <Route path="/tasks/:taskId" element={<TaskDetail />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </div>
      <Statusbar />
    </div>
  );
}

function NotFound() {
  return (
    <div style={{ padding: 40, textAlign: 'center', color: 'var(--fg-3)' }}>
      <I.alert size={32} />
      <div style={{ marginTop: 12 }}>页面未找到</div>
    </div>
  );
}
