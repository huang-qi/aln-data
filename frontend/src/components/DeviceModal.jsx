import React, { useEffect, useState } from 'react';
import I from './Icons.jsx';
import { LineChart } from './Charts.jsx';
import { getDeviceSparam, getDeviceBodeq } from '../api/endpoints.js';

const TABS = [
  { key: 's11_db', label: 'S11 (dB)', yLabel: 'S11 (dB)' },
  { key: 's11_phase', label: 'S11 phase', yLabel: 'S11 phase (°)' },
  { key: 'bodeq', label: 'BodeQ', yLabel: 'BodeQ' },
];

export default function DeviceModal({ device, onClose }) {
  const [tab, setTab] = useState('s11_db');
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!device?.id) return;
    setLoading(true);
    setError(null);
    setData(null);
    const fetcher =
      tab === 'bodeq'
        ? getDeviceBodeq(device.id)
        : getDeviceSparam(device.id, tab);
    fetcher
      .then(setData)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [device?.id, tab]);

  if (!device) return null;

  const tabSpec = TABS.find((t) => t.key === tab);

  let plotProps = null;
  if (data) {
    if (tab === 'bodeq') {
      plotProps = {
        x: data.freq_ghz || [],
        y: data.values || data.smooth || [],
        xLabel: 'Frequency (GHz)',
        yLabel: 'BodeQ',
        markers:
          data.fs_ghz != null
            ? [
                { x: data.fs_ghz, label: 'fs', color: '#0e9488' },
                { x: data.fp_ghz, label: 'fp', color: '#c97a16' },
              ].filter((m) => m.x != null)
            : [],
      };
    } else {
      plotProps = {
        x: data.freq_ghz || [],
        y: data.values || [],
        xLabel: 'Frequency (GHz)',
        yLabel: tabSpec.yLabel,
      };
    }
  }

  return (
    <div className="modal-back" onClick={onClose}>
      <div className="modal" style={{ width: 920 }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <I.curve size={14} style={{ marginRight: 8, color: 'var(--primary)' }} />
          <span>器件曲线</span>
          <span className="mono dim" style={{ marginLeft: 10, fontSize: 11.5 }}>
            #{device.id} · {device.batch_no || device.batch || '—'}/W{device.wafer} · {device.coord || '—'}
          </span>
          <span className="x" onClick={onClose} style={{ cursor: 'pointer' }}>
            <I.x size={16} />
          </span>
        </div>
        <div className="modal-body" style={{ padding: 0 }}>
          <div className="toolbar" style={{ borderBottom: '1px solid var(--border)' }}>
            <div className="group">
              {TABS.map((t) => (
                <button
                  key={t.key}
                  className={tab === t.key ? 'active' : ''}
                  onClick={() => setTab(t.key)}
                >
                  {t.label}
                </button>
              ))}
            </div>
            <div className="spacer" />
            {data?.file_path && (
              <span className="mono dim" style={{ fontSize: 11 }}>
                {data.file_path}
              </span>
            )}
          </div>
          <div style={{ height: 380, padding: 12 }}>
            {loading && <div className="dim" style={{ padding: 40, textAlign: 'center' }}>loading...</div>}
            {error && (
              <div style={{ padding: 14, color: 'var(--fail)' }}>
                <I.alert size={12} /> {error}
              </div>
            )}
            {plotProps && <LineChart {...plotProps} />}
          </div>
          <div className="stat-strip" style={{ borderTop: '1px solid var(--border)' }}>
            <div className="stat">
              <div className="l">fs</div>
              <div className="v">
                {device.fs_ghz?.toFixed(3) || '—'}
                <span className="u">GHz</span>
              </div>
            </div>
            <div className="stat">
              <div className="l">fp</div>
              <div className="v">
                {device.fp_ghz?.toFixed(3) || '—'}
                <span className="u">GHz</span>
              </div>
            </div>
            <div className="stat">
              <div className="l">Qs</div>
              <div className="v">{device.qs?.toFixed(0) || '—'}</div>
            </div>
            <div className="stat">
              <div className="l">k²eff</div>
              <div className="v">
                {device.k2eff_pct?.toFixed(2) || '—'}
                <span className="u">%</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
