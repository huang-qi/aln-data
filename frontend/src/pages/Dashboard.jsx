import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import I from '../components/Icons.jsx';
import { getStats, listTasks } from '../api/endpoints.js';

function Tile({ label, value, unit, sub, accent }) {
  return (
    <div
      style={{
        background: 'var(--bg-panel)',
        border: '1px solid var(--border)',
        borderRadius: 4,
        padding: '12px 14px',
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 3, background: accent || 'var(--primary)' }} />
      <div style={{ fontSize: 10.5, textTransform: 'uppercase', letterSpacing: 0.5, color: 'var(--fg-3)', marginBottom: 6 }}>
        {label}
      </div>
      <div style={{ fontFamily: 'var(--font-mono)', fontSize: 26, fontWeight: 600, color: 'var(--fg-1)', lineHeight: 1.1 }}>
        {value}
        <span style={{ fontSize: 13, color: 'var(--fg-4)', marginLeft: 4 }}>{unit}</span>
      </div>
      {sub && (
        <div style={{ fontSize: 11, color: 'var(--fg-3)', marginTop: 4, fontFamily: 'var(--font-mono)' }}>
          {sub}
        </div>
      )}
    </div>
  );
}

function StatusBadge({ status }) {
  const map = {
    running: ['run', 'RUNNING'],
    success: ['done', 'SUCCESS'],
    failed: ['err', 'FAILED'],
    error: ['err', 'ERROR'],
    pending: ['idle', 'PENDING'],
  };
  const [cls, txt] = map[status] || ['idle', String(status || '').toUpperCase()];
  return <span className={`badge ${cls}`}>{txt}</span>;
}

export default function Dashboard() {
  const [stats, setStats] = useState(null);
  const [tasks, setTasks] = useState([]);
  const [error, setError] = useState(null);

  useEffect(() => {
    Promise.all([getStats(), listTasks()])
      .then(([s, t]) => {
        setStats(s);
        setTasks(Array.isArray(t) ? t : t?.items || []);
      })
      .catch((e) => setError(e.message));
  }, []);

  const fmtN = (n) => (n == null ? '—' : n.toLocaleString());

  return (
    <>
      <div className="toolbar">
        <span className="crumb">
          <b>Dashboard</b>
        </span>
        <div className="spacer" />
        <button className="btn ghost" onClick={() => window.location.reload()}>
          <I.refresh size={13} /> 刷新
        </button>
      </div>
      <div style={{ flex: 1, overflow: 'auto', padding: 14 }}>
        {error && (
          <div style={{ padding: 12, background: 'var(--fail-soft)', border: '1px solid var(--fail)', borderRadius: 4, marginBottom: 12 }}>
            <I.alert size={14} /> {error}
          </div>
        )}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 10, marginBottom: 14 }}>
          <Tile label="批次总数" value={fmtN(stats?.batches)} unit="" />
          <Tile label="器件记录" value={fmtN(stats?.devices)} unit="" accent="var(--t3)" />
          <Tile label="对照表" value={fmtN(stats?.mappings)} unit="" accent="var(--t5)" />
          <Tile label="磁盘使用" value={stats?.disk_used_gb?.toFixed(1) || '—'} unit="GB" sub={`${fmtN(stats?.disk_free_gb)} GB free`} accent="var(--t2)" />
          <Tile label="进行中任务" value={fmtN(stats?.tasks_running)} unit="" accent="var(--running)" />
          <Tile label="排队任务" value={fmtN(stats?.tasks_pending)} unit="" accent="var(--warn)" />
        </div>

        <div style={{ background: 'var(--bg-panel)', border: '1px solid var(--border)', borderRadius: 4 }}>
          <div className="panel-head" style={{ borderRadius: '4px 4px 0 0' }}>
            <I.cpu size={12} />
            <span>最近任务</span>
            <Link to="/tasks" className="btn ghost sm" style={{ marginLeft: 'auto', height: 22, textDecoration: 'none' }}>
              查看全部 ›
            </Link>
          </div>
          <table className="dtable">
            <thead>
              <tr>
                <th>Task ID</th>
                <th>批次号</th>
                <th>状态</th>
                <th style={{ width: 240 }}>进度</th>
                <th>开始</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {tasks.length === 0 && (
                <tr>
                  <td colSpan="6" className="dim" style={{ textAlign: 'center', padding: 24 }}>
                    暂无任务
                  </td>
                </tr>
              )}
              {tasks.slice(0, 10).map((t) => (
                <tr key={t.id}>
                  <td className="mono">{String(t.id).slice(0, 8)}</td>
                  <td>
                    <b style={{ color: 'var(--fg-1)' }}>{t.batch_no}</b>
                  </td>
                  <td>
                    <StatusBadge status={t.status} />
                  </td>
                  <td>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <div style={{ flex: 1, height: 5, background: 'var(--bg-panel-2)', border: '1px solid var(--border)', borderRadius: 3, overflow: 'hidden' }}>
                        <div
                          style={{
                            width: `${t.progress_pct || 0}%`,
                            height: '100%',
                            background:
                              t.status === 'failed' || t.status === 'error'
                                ? 'var(--fail)'
                                : t.status === 'success'
                                ? 'var(--pass)'
                                : 'var(--primary)',
                            transition: 'width 0.3s',
                          }}
                        />
                      </div>
                      <span style={{ width: 40, textAlign: 'right' }}>{t.progress_pct || 0}%</span>
                    </div>
                  </td>
                  <td className="mono dim" style={{ fontSize: 11 }}>
                    {t.started_at ? new Date(t.started_at).toLocaleString() : '—'}
                  </td>
                  <td>
                    <Link to={`/tasks/${t.id}`} className="btn ghost sm" style={{ textDecoration: 'none' }}>
                      <I.more size={12} />
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
