import React, { useEffect, useMemo, useState } from 'react';
import I from '../components/Icons.jsx';
import { ScatterPlot, BoxPlot } from '../components/Charts.jsx';
import useFields, { displayLabel } from '../hooks/useFields.js';
import { queryDevices, queryAggregate, exportCsv } from '../api/endpoints.js';
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

export default function Explore() {
  const { data: fields, loading: fLoading, error: fErr } = useFields();
  const [chartType, setChartType] = useState('scatter');
  const [xKey, setXKey] = useState('fs_ghz');
  const [yKey, setYKey] = useState('qs');
  const [colorKey, setColorKey] = useState('eg');
  const [filters, setFilters] = useState({});
  const [limit, setLimit] = useState(20000);
  const [rows, setRows] = useState([]);
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [activeDevice, setActiveDevice] = useState(null);
  const [exporting, setExporting] = useState(false);

  const numericFields = fields?.numeric || [];
  const allFields = fields?.all || [];

  const xField = fields?.byName?.[xKey];
  const yField = fields?.byName?.[yKey];
  const colorField = fields?.byName?.[colorKey];

  const run = async () => {
    setLoading(true);
    setError(null);
    try {
      const requestedFields = Array.from(
        new Set([xKey, yKey, colorKey, 'batch_no', 'wafer', 'coord', 'pf'].filter(Boolean))
      );
      const res = await queryDevices({
        filters,
        fields: requestedFields,
        limit,
        order_by: xKey,
      });
      setRows(res.rows || []);
      setStats({ total: res.total, returned: res.returned, truncated: res.truncated });
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  const xLabel = xField ? displayLabel(xField) : xKey;
  const yLabel = yField ? displayLabel(yField) : yKey;

  const onExportCsv = async () => {
    setExporting(true);
    setError(null);
    try {
      const res = await exportCsv({
        filters,
        fields: EXPORT_FIELDS,
        limit: 200000,
        order_by: 'id',
      });
      const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      downloadBlob(res.data, `devices_${ts}.csv`);
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
          谐振器 <span style={{ color: 'var(--fg-4)' }}>›</span> <b>数据分析</b>
        </span>
        <div className="divider" />
        <div className="group">
          <button className={chartType === 'scatter' ? 'active' : ''} onClick={() => setChartType('scatter')}>
            <I.scatter size={14} /> 散点
          </button>
          <button className={chartType === 'box' ? 'active' : ''} onClick={() => setChartType('box')}>
            <I.box size={14} /> 箱型
          </button>
        </div>
        <div className="spacer" />
        <button className="btn" onClick={onExportCsv} disabled={exporting} title="按当前筛选条件导出为 CSV">
          <I.download size={13} /> {exporting ? '导出中…' : '导出 CSV'}
        </button>
        <button className="btn" disabled title="敬请期待">
          <I.download size={13} /> 导出 Excel
        </button>
        <button className="btn primary" onClick={run} disabled={loading || fLoading}>
          <I.refresh size={13} /> {loading ? '查询中...' : '运行查询'}
        </button>
      </div>

      <div className="workspace">
        <FilterPanel filters={filters} setFilters={setFilters} fields={fields} />
        <div className="canvas-wrap">
          <div className="chart-card">
            <div className="chart-head">
              <span className="title">
                {chartType === 'scatter' ? `${xLabel} × ${yLabel}` : `${yLabel} grouped`}
              </span>
              <span className="axes">
                {stats
                  ? `${stats.returned}/${stats.total} rows${stats.truncated ? ' · truncated' : ''}`
                  : '尚未查询'}
              </span>
            </div>
            <div className="chart-body" style={{ minHeight: 480 }}>
              {fErr && (
                <div style={{ padding: 14, color: 'var(--fail)' }}>
                  fields error: {fErr.message}
                </div>
              )}
              {error && (
                <div style={{ padding: 14, color: 'var(--fail)' }}>
                  <I.alert size={12} /> {error}
                </div>
              )}
              {!error && rows.length === 0 && !loading && (
                <div style={{ padding: 40, color: 'var(--fg-4)', textAlign: 'center' }}>
                  请配置参数后点击「运行查询」
                </div>
              )}
              {rows.length > 0 && chartType === 'scatter' && (
                <div style={{ position: 'absolute', inset: 0 }}>
                  <ScatterPlot
                    rows={rows}
                    xKey={xKey}
                    yKey={yKey}
                    colorKey={colorKey}
                    xLabel={xLabel}
                    yLabel={yLabel}
                    onPointClick={(d) => setActiveDevice(d)}
                  />
                </div>
              )}
              {rows.length > 0 && chartType === 'box' && (
                <div style={{ position: 'absolute', inset: 0 }}>
                  <BoxPlot rows={rows} groupKey={colorKey} valueKey={yKey} valueLabel={yLabel} />
                </div>
              )}
            </div>
          </div>
        </div>
        <Inspector
          xKey={xKey}
          setXKey={setXKey}
          yKey={yKey}
          setYKey={setYKey}
          colorKey={colorKey}
          setColorKey={setColorKey}
          numericFields={numericFields}
          allFields={allFields}
          limit={limit}
          setLimit={setLimit}
          stats={stats}
        />
      </div>

      {activeDevice && <DeviceModal device={activeDevice} onClose={() => setActiveDevice(null)} />}
    </>
  );
}

function FilterPanel({ filters, setFilters, fields }) {
  const [batchNo, setBatchNo] = useState('');
  const [wafer, setWafer] = useState('');
  const [pf, setPf] = useState('');
  const [fsMin, setFsMin] = useState('');
  const [fsMax, setFsMax] = useState('');

  const apply = () => {
    const f = {};
    if (batchNo) f.batch_no = batchNo.split(',').map((s) => s.trim()).filter(Boolean);
    if (wafer) f.wafer = wafer.split(',').map((s) => parseInt(s, 10)).filter((x) => !isNaN(x));
    if (pf) f.pf = [pf];
    if (fsMin || fsMax) {
      f.fs_ghz = {};
      if (fsMin) f.fs_ghz.gte = parseFloat(fsMin);
      if (fsMax) f.fs_ghz.lte = parseFloat(fsMax);
    }
    setFilters(f);
  };

  const clear = () => {
    setBatchNo('');
    setWafer('');
    setPf('');
    setFsMin('');
    setFsMax('');
    setFilters({});
  };

  return (
    <div className="panel">
      <div className="panel-head">
        <I.filter size={12} />
        <span>FILTERS</span>
        <button className="btn ghost sm" style={{ marginLeft: 'auto', height: 20 }} onClick={clear}>
          清空
        </button>
      </div>
      <div className="panel-body">
        <div className="field">
          <div className="field-label">
            <span>批次号</span>
            <span className="hint">逗号分隔</span>
          </div>
          <input
            className="input"
            placeholder="T8901P.01, T8902"
            value={batchNo}
            onChange={(e) => setBatchNo(e.target.value)}
          />
        </div>
        <div className="field">
          <div className="field-label">
            <span>Wafer</span>
            <span className="hint">逗号分隔</span>
          </div>
          <input
            className="input"
            placeholder="1, 2"
            value={wafer}
            onChange={(e) => setWafer(e.target.value)}
          />
        </div>
        <div className="field">
          <div className="field-label">
            <span>Pass / Fail</span>
          </div>
          <select className="select" value={pf} onChange={(e) => setPf(e.target.value)}>
            <option value="">任意</option>
            <option value="Y">Pass</option>
            <option value="N">Fail</option>
          </select>
        </div>
        <div className="field">
          <div className="field-label">
            <span>fs (GHz)</span>
          </div>
          <div className="row-flex">
            <input
              className="input mono"
              placeholder="min"
              value={fsMin}
              onChange={(e) => setFsMin(e.target.value)}
              style={{ flex: 1 }}
            />
            <span className="dim">—</span>
            <input
              className="input mono"
              placeholder="max"
              value={fsMax}
              onChange={(e) => setFsMax(e.target.value)}
              style={{ flex: 1 }}
            />
          </div>
        </div>
        <div className="hr" />
        <button className="btn primary" style={{ width: '100%', justifyContent: 'center' }} onClick={apply}>
          应用筛选
        </button>
        {Object.keys(filters).length > 0 && (
          <div className="dim mono" style={{ fontSize: 10.5, marginTop: 8, wordBreak: 'break-all' }}>
            {JSON.stringify(filters)}
          </div>
        )}
      </div>
    </div>
  );
}

function Inspector({
  xKey,
  setXKey,
  yKey,
  setYKey,
  colorKey,
  setColorKey,
  numericFields,
  allFields,
  limit,
  setLimit,
  stats,
}) {
  return (
    <div className="panel right">
      <div className="panel-head">
        <I.settings size={12} />
        <span>CHART CONFIG</span>
      </div>
      <div className="panel-body">
        <div className="section">
          <div className="section-title">轴 / 编码</div>
          <FieldSelect label="X 轴" hint="numeric" fields={numericFields} value={xKey} onChange={setXKey} />
          <FieldSelect label="Y 轴" hint="numeric" fields={numericFields} value={yKey} onChange={setYKey} />
          <FieldSelect label="颜色编码" hint="any" fields={allFields} value={colorKey} onChange={setColorKey} />
        </div>
        <div className="section">
          <div className="section-title">查询参数</div>
          <div className="field">
            <div className="field-label">
              <span>limit</span>
            </div>
            <input
              className="input mono"
              type="number"
              value={limit}
              onChange={(e) => setLimit(parseInt(e.target.value, 10) || 0)}
            />
          </div>
        </div>
        {stats && (
          <div className="section">
            <div className="section-title">查询统计</div>
            <div
              style={{
                background: 'var(--bg-panel-2)',
                border: '1px solid var(--border)',
                borderRadius: 4,
                padding: 8,
                fontFamily: 'var(--font-mono)',
                fontSize: 11.5,
                lineHeight: 1.7,
              }}
            >
              <div className="row-flex" style={{ justifyContent: 'space-between' }}>
                <span className="muted">total</span>
                <span>{stats.total}</span>
              </div>
              <div className="row-flex" style={{ justifyContent: 'space-between' }}>
                <span className="muted">returned</span>
                <span>{stats.returned}</span>
              </div>
              <div className="row-flex" style={{ justifyContent: 'space-between' }}>
                <span className="muted">truncated</span>
                <span style={{ color: stats.truncated ? 'var(--fail)' : 'var(--pass)' }}>
                  {stats.truncated ? 'yes' : 'no'}
                </span>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function FieldSelect({ label, hint, fields, value, onChange }) {
  return (
    <div className="field">
      <div className="field-label">
        <span>{label}</span>
        {hint && <span className="hint">{hint}</span>}
      </div>
      <select className="select" value={value} onChange={(e) => onChange(e.target.value)}>
        {fields.map((f) => (
          <option key={f.name} value={f.name}>
            {displayLabel(f)}
          </option>
        ))}
      </select>
    </div>
  );
}
