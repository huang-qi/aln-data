import React, { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import I from '../components/Icons.jsx';
import { getBatch, listBatchDevices, exportCsv } from '../api/endpoints.js';
import DeviceModal from '../components/DeviceModal.jsx';

// 触发浏览器下载一个 Blob
function downloadBlob(blob, filename) {
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.URL.revokeObjectURL(url);
}

// 完整导出字段（覆盖 Device 表所有列 + virtual batch_no）
const EXPORT_FIELDS = [
  'id', 'batch_no',
  'original_filename', 'display_name', 'mark', 'wafer', 'folder_name', 'coord', 'x', 'y',
  'eg', 'fl', 'ag', 'pf', 'area_n', 'area_um2',
  'fs_ghz', 'fp_ghz', 'zs_ohm', 'zp_ohm', 'qs', 'qp',
  'qs_bodeq', 'qp_bodeq', 'dbqs', 'dbqp',
  'bodeq_fitted', 'bodeq_smooth', 'bodeq_raw', 'fbode_ghz', 'k2eff_pct',
  'fp2_ghz', 'fs2_ghz', 'zp2_ohm', 'zs2_ohm',
  'deembedded', 's_param_path',
];

export default function BatchDetail() {
  const { batchNo } = useParams();
  const [detail, setDetail] = useState(null);
  const [devices, setDevices] = useState({ items: [], total: 0 });
  const [page, setPage] = useState(1);
  const [size] = useState(50);
  const [waferFilter, setWaferFilter] = useState('');
  const [pfFilter, setPfFilter] = useState('');
  const [error, setError] = useState(null);
  const [activeDevice, setActiveDevice] = useState(null);
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    getBatch(batchNo)
      .then(setDetail)
      .catch((e) => setError(e.message));
  }, [batchNo]);

  useEffect(() => {
    const params = { page, size };
    if (waferFilter) params.wafer = waferFilter;
    if (pfFilter) params.pf = pfFilter;
    listBatchDevices(batchNo, params)
      .then(setDevices)
      .catch((e) => setError(e.message));
  }, [batchNo, page, size, waferFilter, pfFilter]);

  const items = devices.items || [];

  const onExportCsv = async () => {
    setExporting(true);
    setError(null);
    try {
      const res = await exportCsv({
        filters: { batch_no: [batchNo] },
        fields: EXPORT_FIELDS,
        limit: 200000,
        order_by: 'id',
      });
      const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      downloadBlob(res.data, `${batchNo}_devices_${ts}.csv`);
    } catch (e) {
      setError(e.message || '导出失败');
    } finally {
      setExporting(false);
    }
  };

  return (
    <>
      <div className="toolbar">
        <span className="crumb">
          <Link to="/batches" style={{ color: 'inherit', textDecoration: 'none' }}>
            批次管理
          </Link>{' '}
          <span style={{ color: 'var(--fg-4)' }}>›</span> <b>{batchNo}</b>
        </span>
        <div className="spacer" />
        <button className="btn" onClick={onExportCsv} disabled={exporting} title="导出当前批次全部 devices 为 CSV">
          <I.download size={13} /> {exporting ? '导出中…' : '导出 CSV'}
        </button>
        <button className="btn" disabled title="敬请期待">
          <I.download size={13} /> 导出 Excel
        </button>
      </div>

      <div style={{ flex: 1, overflow: 'auto', padding: 14 }}>
        {error && (
          <div style={{ padding: 12, background: 'var(--fail-soft)', color: 'var(--fail)', marginBottom: 12 }}>
            {error}
          </div>
        )}
        {detail && (
          <div className="chart-card" style={{ margin: 0, marginBottom: 12 }}>
            <div className="chart-head">
              <span className="title">批次概览</span>
            </div>
            <div style={{ padding: 14, display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10 }}>
              <Stat label="对照表" value={detail.mapping_name || '—'} />
              <Stat label="器件数" value={(detail.device_count || 0).toLocaleString()} />
              <Stat
                label="fs 范围"
                value={
                  detail.f_start_ghz != null
                    ? `${detail.f_start_ghz} – ${detail.f_end_ghz} GHz`
                    : '全频段'
                }
              />
              <Stat label="处理类型" value={detail.process_type || '—'} />
              <Stat label="De-embed" value={detail.deembedded ? 'YES' : 'NO'} />
              <Stat label="Wafer" value={(detail.wafers || []).map((w) => `W${w}`).join(', ') || '—'} />
              <Stat
                label="fs 中位 (GHz)"
                value={detail.stats?.fs_ghz_median != null ? detail.stats.fs_ghz_median.toFixed(3) : '—'}
              />
              <Stat
                label="Pass 率"
                value={
                  detail.stats?.pass_rate != null
                    ? `${(detail.stats.pass_rate * 100).toFixed(1)}%`
                    : '—'
                }
                accent="var(--pass)"
              />
            </div>
          </div>
        )}

        <div className="chart-card" style={{ margin: 0 }}>
          <div className="chart-head">
            <span className="title">器件列表</span>
            <span className="axes">{devices.total || 0} rows</span>
            <div className="right">
              <input
                className="input sm"
                placeholder="wafer"
                value={waferFilter}
                onChange={(e) => {
                  setWaferFilter(e.target.value);
                  setPage(1);
                }}
                style={{ width: 80 }}
              />
              <select
                className="select"
                value={pfFilter}
                onChange={(e) => {
                  setPfFilter(e.target.value);
                  setPage(1);
                }}
              >
                <option value="">全部 P/F</option>
                <option value="Y">Pass</option>
                <option value="N">Fail</option>
              </select>
            </div>
          </div>
          <div style={{ overflow: 'auto', maxHeight: '60vh' }}>
            <table className="dtable">
              <thead>
                <tr>
                  <th>ID</th>
                  <th>Wafer</th>
                  <th>Coord</th>
                  <th>Mark</th>
                  <th className="num">fs (GHz)</th>
                  <th className="num">Qs</th>
                  <th className="num">k²eff (%)</th>
                  <th>P/F</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {items.length === 0 && (
                  <tr>
                    <td colSpan="9" className="dim" style={{ textAlign: 'center', padding: 24 }}>
                      暂无器件
                    </td>
                  </tr>
                )}
                {items.map((d) => (
                  <tr key={d.id || `${d.wafer}-${d.coord}`} style={{ cursor: 'pointer' }} onClick={() => setActiveDevice(d)}>
                    <td className="mono">{d.id || '—'}</td>
                    <td>W{d.wafer}</td>
                    <td className="mono">{d.coord}</td>
                    <td>{d.mark}</td>
                    <td className="num">{d.fs_ghz?.toFixed(4) || '—'}</td>
                    <td className="num">{d.qs?.toFixed(0) || '—'}</td>
                    <td className="num">{d.k2eff_pct?.toFixed(2) || '—'}</td>
                    <td className={d.pf === 'Y' ? 'pass' : 'fail'}>{d.pf}</td>
                    <td>
                      <button className="btn ghost sm" onClick={(e) => { e.stopPropagation(); setActiveDevice(d); }}>
                        <I.curve size={12} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div style={{ padding: 12, display: 'flex', gap: 6, alignItems: 'center', justifyContent: 'center' }}>
            <button className="btn sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
              <I.chevron size={11} style={{ transform: 'scaleX(-1)' }} />
            </button>
            <span className="dim mono" style={{ fontSize: 11 }}>
              {page} / {Math.max(1, Math.ceil((devices.total || 0) / size))}
            </span>
            <button className="btn sm" disabled={page * size >= (devices.total || 0)} onClick={() => setPage((p) => p + 1)}>
              <I.chevron size={11} />
            </button>
          </div>
        </div>
      </div>

      {activeDevice && <DeviceModal device={activeDevice} onClose={() => setActiveDevice(null)} />}
    </>
  );
}

function Stat({ label, value, accent }) {
  return (
    <div
      style={{
        background: 'var(--bg-panel-2)',
        border: '1px solid var(--border)',
        borderRadius: 4,
        padding: 10,
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          position: 'absolute',
          left: 0,
          top: 0,
          bottom: 0,
          width: 2,
          background: accent || 'var(--fg-4)',
        }}
      />
      <div style={{ fontSize: 10.5, color: 'var(--fg-3)', textTransform: 'uppercase', letterSpacing: 0.4 }}>
        {label}
      </div>
      <div style={{ fontFamily: 'var(--font-mono)', fontSize: 16, fontWeight: 600, color: 'var(--fg-1)', marginTop: 2 }}>
        {value}
      </div>
    </div>
  );
}
