import React, { useEffect, useMemo, useState } from 'react';
import I from '../components/Icons.jsx';
import { ScatterPlot, BoxPlot, ViolinPlot, MultiLineChart, FacetedGrid } from '../components/Charts.jsx';
import useFields, { displayLabel } from '../hooks/useFields.js';
import { queryDevices, exportCsv } from '../api/endpoints.js';
import DeviceModal from '../components/DeviceModal.jsx';
import FilterPanel from '../components/FilterPanel.jsx';

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

// Sections of the field metadata (from /api/query/fields)
const SECTION_LABELS = {
  categorical: '分类',
  geometric: '几何',
  numeric: '数值',
  process: '工艺',
};

// Whether a field section is treated as categorical for axis-mapping logic.
const CATEGORICAL_SECTIONS = new Set(['categorical']);

// Sensible default Y fields used by Facet mode (matches customer reference shot).
const DEFAULT_FACET_Y = ['fs_ghz', 'zs_ohm', 'qs_bodeq', 'fp_ghz', 'zp_ohm', 'qp_bodeq', 'bodeq_smooth', 'k2eff_pct'];

const CHART_TYPES = [
  { key: 'scatter', label: '散点',   icon: 'scatter' },
  { key: 'box',     label: '箱型',   icon: 'box' },
  { key: 'violin',  label: '小提琴', icon: 'box' },
  { key: 'line',    label: '折线',   icon: 'line' },
  { key: 'facet',   label: '小倍图', icon: 'layers' },
];

export default function Explore() {
  const { data: fields, loading: fLoading, error: fErr } = useFields();
  const [chartType, setChartType] = useState('scatter');
  const [xKey, setXKey] = useState('fs_ghz');
  const [yKey, setYKey] = useState('qs');
  const [colorKey, setColorKey] = useState('eg');
  const [facetYKeys, setFacetYKeys] = useState(DEFAULT_FACET_Y);
  const [filters, setFilters] = useState({});
  const [limit, setLimit] = useState(20000);
  const [rows, setRows] = useState([]);
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [activeDevice, setActiveDevice] = useState(null);
  const [exporting, setExporting] = useState(false);

  const allFields = fields?.all || [];

  const xField = fields?.byName?.[xKey];
  const yField = fields?.byName?.[yKey];
  const colorField = fields?.byName?.[colorKey];
  const xIsCategory = xField ? CATEGORICAL_SECTIONS.has(xField.section) : false;
  const yIsCategory = yField ? CATEGORICAL_SECTIONS.has(yField.section) : false;
  const colorIsCategory = colorField ? CATEGORICAL_SECTIONS.has(colorField.section) : false;

  const xLabel = xField ? displayLabel(xField) : xKey;
  const yLabel = yField ? displayLabel(yField) : yKey;
  const colorLabel = colorField ? displayLabel(colorField) : colorKey;

  // Validation: Y as categorical is only allowed for box/violin where it
  // doesn't really make sense; surface a warning.
  const yWarning = yIsCategory ? 'Y 轴是类别字段，建议把它放到 X 轴或颜色编码上' : null;

  const run = async () => {
    setLoading(true);
    setError(null);
    try {
      // For facet, request all selected Y fields too.
      const fieldsNeeded = new Set(['batch_no', 'wafer', 'coord', 'pf', 'id']);
      [xKey, yKey, colorKey].forEach((k) => k && fieldsNeeded.add(k));
      if (chartType === 'facet') facetYKeys.forEach((k) => fieldsNeeded.add(k));
      const res = await queryDevices({
        filters,
        fields: Array.from(fieldsNeeded),
        limit,
        order_by: xIsCategory ? 'id' : xKey,
      });
      setRows(res.rows || []);
      setStats({ total: res.total, returned: res.returned, truncated: res.truncated });
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  const onExportCsv = async () => {
    setExporting(true);
    setError(null);
    try {
      const res = await exportCsv({
        filters, fields: EXPORT_FIELDS, limit: 200000, order_by: 'id',
      });
      const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      downloadBlob(res.data, `devices_${ts}.csv`);
    } catch (e) {
      setError(e.message || '导出失败');
    } finally {
      setExporting(false);
    }
  };

  const facetYFields = useMemo(
    () => facetYKeys.map((k) => fields?.byName?.[k]).filter(Boolean),
    [facetYKeys, fields],
  );

  const titleText = chartType === 'facet'
    ? `${xLabel} × ${facetYFields.length} 个 Y 字段`
    : chartType === 'box' || chartType === 'violin'
      ? `${yLabel} grouped by ${xLabel}`
      : `${xLabel} × ${yLabel}`;

  return (
    <>
      <div className="toolbar">
        <span className="crumb">
          谐振器 <span style={{ color: 'var(--fg-4)' }}>›</span> <b>数据分析</b>
        </span>
        <div className="divider" />
        <div className="group">
          {CHART_TYPES.map((c) => {
            const Icn = I[c.icon] || I.scatter;
            return (
              <button
                key={c.key}
                className={chartType === c.key ? 'active' : ''}
                onClick={() => setChartType(c.key)}
                title={c.label}
              >
                <Icn size={14} /> {c.label}
              </button>
            );
          })}
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
        <FilterPanel value={filters} onApply={setFilters} />
        <div className="canvas-wrap">
          <div className="chart-card">
            <div className="chart-head">
              <span className="title">{titleText}</span>
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
              {rows.length > 0 && (
                <div style={{ position: 'absolute', inset: 0, overflow: 'auto' }}>
                  {chartType === 'scatter' && (
                    <ScatterPlot
                      rows={rows}
                      xKey={xKey} yKey={yKey} colorKey={colorKey}
                      xLabel={xLabel} yLabel={yLabel} colorLabel={colorLabel}
                      xIsCategory={xIsCategory}
                      colorIsCategory={colorIsCategory}
                      onPointClick={(d) => setActiveDevice(d)}
                    />
                  )}
                  {chartType === 'box' && (
                    <BoxPlot
                      rows={rows}
                      xKey={xKey} yKey={yKey} colorKey={colorKey}
                      xLabel={xLabel} yLabel={yLabel}
                      colorIsCategory={colorIsCategory}
                    />
                  )}
                  {chartType === 'violin' && (
                    <ViolinPlot
                      rows={rows}
                      xKey={xKey} yKey={yKey} colorKey={colorKey}
                      xLabel={xLabel} yLabel={yLabel}
                      colorIsCategory={colorIsCategory}
                    />
                  )}
                  {chartType === 'line' && (
                    <MultiLineChart
                      rows={rows}
                      xKey={xKey} yKey={yKey} colorKey={colorKey}
                      xLabel={xLabel} yLabel={yLabel}
                      xIsCategory={xIsCategory}
                    />
                  )}
                  {chartType === 'facet' && (
                    <FacetedGrid
                      rows={rows}
                      xKey={xKey}
                      yFields={facetYFields}
                      colorKey={colorIsCategory ? colorKey : undefined}
                      xLabel={xLabel}
                      xIsCategory={xIsCategory}
                      kind="violin"
                    />
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
        <Inspector
          xKey={xKey} setXKey={setXKey}
          yKey={yKey} setYKey={setYKey}
          colorKey={colorKey} setColorKey={setColorKey}
          allFields={allFields}
          chartType={chartType}
          facetYKeys={facetYKeys}
          setFacetYKeys={setFacetYKeys}
          limit={limit} setLimit={setLimit}
          stats={stats}
          xIsCategory={xIsCategory}
          colorIsCategory={colorIsCategory}
          yWarning={yWarning}
        />
      </div>

      {activeDevice && <DeviceModal device={activeDevice} onClose={() => setActiveDevice(null)} />}
    </>
  );
}

function Inspector({
  xKey, setXKey, yKey, setYKey, colorKey, setColorKey,
  allFields, chartType,
  facetYKeys, setFacetYKeys,
  limit, setLimit, stats,
  xIsCategory, colorIsCategory, yWarning,
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
          <FieldSelect label="X 轴" hint={xIsCategory ? 'category' : 'numeric'} fields={allFields} value={xKey} onChange={setXKey} />
          <FieldSelect label="Y 轴" hint="numeric ↑" fields={allFields} value={yKey} onChange={setYKey} />
          {yWarning && (
            <div style={{ fontSize: 10.5, color: 'var(--warn)', marginTop: -4, marginBottom: 8 }}>
              ⚠ {yWarning}
            </div>
          )}
          <FieldSelect label="颜色编码 (Z)" hint={colorIsCategory ? 'category' : 'numeric'} fields={allFields} value={colorKey} onChange={setColorKey} />
        </div>

        {chartType === 'facet' && (
          <div className="section">
            <div className="section-title">小倍图 Y 字段</div>
            <FacetYPicker allFields={allFields} value={facetYKeys} onChange={setFacetYKeys} />
          </div>
        )}

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
  // Group fields by section for an organized dropdown.
  const grouped = useMemo(() => {
    const out = {};
    for (const f of fields) {
      const k = f.section || 'other';
      (out[k] ||= []).push(f);
    }
    return out;
  }, [fields]);

  const order = ['categorical', 'geometric', 'numeric', 'process'];

  return (
    <div className="field">
      <div className="field-label">
        <span>{label}</span>
        {hint && <span className="hint">{hint}</span>}
      </div>
      <select className="select" value={value} onChange={(e) => onChange(e.target.value)}>
        {order.filter((s) => grouped[s]).map((section) => (
          <optgroup key={section} label={SECTION_LABELS[section] || section}>
            {grouped[section].map((f) => (
              <option key={f.name} value={f.name}>
                {displayLabel(f)}
              </option>
            ))}
          </optgroup>
        ))}
      </select>
    </div>
  );
}

function FacetYPicker({ allFields, value, onChange }) {
  // Show only numeric fields as facet Y candidates.
  const candidates = allFields.filter((f) => f.section === 'numeric' || f.section === 'process');
  const selected = new Set(value);
  const toggle = (name) => {
    const next = selected.has(name)
      ? value.filter((v) => v !== name)
      : [...value, name];
    onChange(next);
  };
  return (
    <div className="cbg-list scrollable" style={{ maxHeight: 220 }}>
      {candidates.map((f) => {
        const checked = selected.has(f.name);
        return (
          <label key={f.name} className="cbg-item" title={displayLabel(f)}>
            <span className={`cb${checked ? ' checked' : ''}`} aria-hidden>
              {checked && <I.check size={10} stroke="#fff" sw={2.5} />}
            </span>
            <input
              type="checkbox"
              checked={checked}
              onChange={() => toggle(f.name)}
              style={{ position: 'absolute', opacity: 0, pointerEvents: 'none' }}
            />
            <span className="cbg-item-label">{displayLabel(f)}</span>
          </label>
        );
      })}
    </div>
  );
}
