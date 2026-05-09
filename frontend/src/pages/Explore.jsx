import React, { useEffect, useMemo, useState } from 'react';
import I from '../components/Icons.jsx';
import { UnifiedChartGrid, WaferMap } from '../components/Charts.jsx';
import useFields, { displayLabel } from '../hooks/useFields.js';
import { queryDevices, queryAggregate, exportCsv } from '../api/endpoints.js';
import DeviceModal from '../components/DeviceModal.jsx';
import FilterPanel from '../components/FilterPanel.jsx';

// Aggregation options for numeric Y/Z fields.
//   'all' is a UI sentinel meaning "no aggregation, plot raw rows".
//   The other ops map to backend AggOp values in /api/query/aggregate.
//   'mean' is rendered as 'avg' on the wire (backend uses SQL AVG).
const AGG_OPTIONS = [
  { key: 'all',    label: 'ALL（不聚合）' },
  { key: 'max',    label: 'max' },
  { key: 'min',    label: 'min' },
  { key: 'mean',   label: 'mean' },
  { key: 'p50',    label: 'median (p50)' },
  { key: 'p25',    label: 'p25' },
  { key: 'p75',    label: 'p75' },
];
// Wire name sent to backend metrics[].agg.
function aggWireName(uiKey) {
  return uiKey === 'mean' ? 'avg' : uiKey;
}

// Trigger a browser download for a returned Blob (used by CSV export).
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

// Full export field list (mirrors the Device ORM model + virtual batch_no).
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

// Sections returned by /api/query/fields. Used for grouping in pickers.
const SECTION_LABELS = {
  categorical: '类别字段',
  process: '工艺字段',
  geometric: '几何字段',
  numeric: '数值字段',
};
const SECTION_ORDER = ['categorical', 'process', 'geometric', 'numeric'];

// Per requirement: categorical *and* process fields are treated as discrete
// for charting purposes (process values like eg/fl/ag are floats but the
// customer uses them as enumerations). geometric (x/y) and numeric stay
// continuous.
const CATEGORICAL_SECTIONS = new Set(['categorical', 'process']);

// Chart-type radio choices (5 options — facet removed).
const CHART_TYPES = [
  { key: 'scatter', label: '散点图', icon: 'scatter' },
  { key: 'box',     label: '箱型图', icon: 'box' },
  { key: 'violin',  label: '小提琴', icon: 'box' },
  { key: 'line',    label: '折线图', icon: 'line' },
  { key: 'wafer',   label: 'Wafer 版图', icon: 'wafer' },
];

// Sentinel for "no facet" radio in wafer mode.
const NO_FACET = '__none__';

// Resolve a field name into an enriched field object (label/unit/section/
// isCategorical) using the metadata from useFields().
function enrichField(name, fields) {
  if (!name || !fields) return null;
  for (const section of SECTION_ORDER) {
    const f = (fields.raw?.[section] || []).find((x) => x.name === name);
    if (f) {
      return {
        name: f.name,
        label: f.label || f.name,
        unit: f.unit || '',
        section,
        isCategorical: CATEGORICAL_SECTIONS.has(section),
      };
    }
  }
  return { name, label: name, unit: '', section: 'other', isCategorical: false };
}

export default function Explore() {
  const { data: fields, loading: fLoading, error: fErr } = useFields();

  // Persisted across chart-type switches (don't reset on chartType change).
  const [chartType, setChartType] = useState('scatter');
  const [xFields, setXFields] = useState(['fs_ghz']);
  // Y fields: list of { name, aggregation } where aggregation is one of
  // AGG_OPTIONS keys. Default 'all' = no aggregation (plot raw rows).
  const [yFields, setYFields] = useState([{ name: 'qs', aggregation: 'all' }]);
  // Z field: { name, aggregation } | null. Same convention as Y.
  const [zField, setZField] = useState(null);

  // wafer-only state.
  const [waferZ, setWaferZ] = useState('k2eff_pct');
  const [waferFacet, setWaferFacet] = useState(NO_FACET);

  // Filters / query state.
  const [filters, setFilters] = useState({});
  const [limit, setLimit] = useState(50000);
  const [rows, setRows] = useState([]);
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [activeDevice, setActiveDevice] = useState(null);
  const [exporting, setExporting] = useState(false);

  const isWafer = chartType === 'wafer';

  // Enriched field metadata for charts. yMeta/zMeta carry the per-field
  // `aggregation` selected by the user (default 'all' = no aggregation).
  const xMeta = useMemo(
    () => xFields.map((n) => enrichField(n, fields)).filter(Boolean),
    [xFields, fields],
  );
  const yMeta = useMemo(
    () =>
      yFields
        .map((y) => {
          const m = enrichField(y.name, fields);
          return m ? { ...m, aggregation: y.aggregation || 'all' } : null;
        })
        .filter(Boolean),
    [yFields, fields],
  );
  const zMeta = useMemo(() => {
    if (!zField) return null;
    const m = enrichField(zField.name, fields);
    return m ? { ...m, aggregation: zField.aggregation || 'all' } : null;
  }, [zField, fields]);
  const waferZMeta = useMemo(() => enrichField(waferZ, fields), [waferZ, fields]);

  // Whether the current Y/Z selection requires the aggregate API.
  const needsAggregate = useMemo(() => {
    if (yMeta.some((f) => f.isCategorical ? false : (f.aggregation && f.aggregation !== 'all'))) return true;
    if (zMeta && !zMeta.isCategorical && zMeta.aggregation && zMeta.aggregation !== 'all') return true;
    return false;
  }, [yMeta, zMeta]);

  // Aggregate mode requires at least one categorical X (X is the GROUP BY key).
  const hasCategoricalX = useMemo(() => xMeta.some((f) => f.isCategorical), [xMeta]);
  const aggregateXWarning = useMemo(() => {
    if (!needsAggregate) return null;
    if (!hasCategoricalX) return '聚合模式需要至少一个类别 X 字段（已自动 fallback 为 ALL）';
    return null;
  }, [needsAggregate, hasCategoricalX]);
  // If aggregate would be invalid (no categorical X) we silently fall back.
  const useAggregate = needsAggregate && hasCategoricalX;

  const run = async () => {
    setLoading(true);
    setError(null);
    try {
      // ── Aggregate branch (Y/Z aggregation requested + categorical X exists)
      if (!isWafer && useAggregate) {
        // group_by = all selected X fields (caller asked us to bucket on X).
        const groupBy = xFields.slice();
        // Build metrics: one per Y/Z field that has a non-'all' aggregation.
        // Keys: { field, agg: [<wireName>] }. Categorical Y is skipped (the
        // UI never offers an agg dropdown for it, but guard here too).
        const metrics = [];
        const aggByField = {}; // field-name -> ui-key, used during flatten
        for (const y of yMeta) {
          if (!y.isCategorical && y.aggregation && y.aggregation !== 'all') {
            metrics.push({ field: y.name, agg: [aggWireName(y.aggregation)] });
            aggByField[y.name] = aggWireName(y.aggregation);
          }
        }
        if (zMeta && !zMeta.isCategorical && zMeta.aggregation && zMeta.aggregation !== 'all') {
          // If Z field already in metrics (also a Y), don't dup.
          if (!aggByField[zMeta.name]) {
            metrics.push({ field: zMeta.name, agg: [aggWireName(zMeta.aggregation)] });
            aggByField[zMeta.name] = aggWireName(zMeta.aggregation);
          }
        }
        const res = await queryAggregate({ filters, group_by: groupBy, metrics });
        // Flatten {x_field: v, qs: {avg: 1234}} → {x_field: v, qs: 1234}.
        const flat = (res.groups || []).map((g) => {
          const row = {};
          for (const k of Object.keys(g)) {
            const v = g[k];
            if (v && typeof v === 'object' && !Array.isArray(v)) {
              // Take the (sole) requested agg op for this field.
              const op = aggByField[k];
              row[k] = op != null ? v[op] : Object.values(v)[0];
            } else {
              row[k] = v;
            }
          }
          // Inject Y fields whose aggregation is 'all' as undefined to make
          // it visually obvious they have no per-X bucket value (Charts will
          // show empty for that subplot — user-visible signal to switch back).
          for (const y of yMeta) {
            if ((y.aggregation || 'all') === 'all' && !(y.name in row)) {
              row[y.name] = null;
            }
          }
          return row;
        });
        setRows(flat);
        setStats({ total: flat.length, returned: flat.length, truncated: false });
        return;
      }

      // ── Default branch: raw rows via /api/query/devices.
      const fieldSet = new Set(['id']);
      if (isWafer) {
        ['x', 'y'].forEach((k) => fieldSet.add(k));
        if (waferZ) fieldSet.add(waferZ);
        if (waferFacet && waferFacet !== NO_FACET) fieldSet.add(waferFacet);
        // include common identification cols for tooltip / modal.
        ['batch_no', 'wafer', 'folder_name', 'pf'].forEach((k) => fieldSet.add(k));
      } else {
        xFields.forEach((n) => fieldSet.add(n));
        yFields.forEach((y) => fieldSet.add(y.name));
        if (zField) fieldSet.add(zField.name);
        // device-identification cols for the modal.
        ['batch_no', 'wafer', 'folder_name', 'coord', 'pf'].forEach((k) => fieldSet.add(k));
      }
      const res = await queryDevices({
        filters,
        fields: Array.from(fieldSet),
        limit,
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

  // Header title for the chart card.
  const titleText = isWafer
    ? `Wafer 版图 · ${waferZMeta ? displayLabel(waferZMeta) : waferZ}`
    : (() => {
        const xs = xMeta.map((f) => displayLabel(f)).join(', ') || '—';
        const ys = yMeta.map((f) => displayLabel(f)).join(', ') || '—';
        return `${xs}  ×  ${ys}`;
      })();

  // Distinct facet values for wafer mode.
  const waferFacetValues = useMemo(() => {
    if (!isWafer || !waferFacet || waferFacet === NO_FACET) return [];
    const s = new Set();
    rows.forEach((r) => {
      const v = r[waferFacet];
      if (v !== null && v !== undefined) s.add(v);
    });
    return Array.from(s).sort((a, b) => (a > b ? 1 : a < b ? -1 : 0));
  }, [rows, isWafer, waferFacet]);

  // Heuristic warning: violin/box with no categorical X is awkward.
  const violinXWarning = useMemo(() => {
    if (!(chartType === 'violin' || chartType === 'box')) return null;
    if (xMeta.length === 0) return null;
    const allNumeric = xMeta.every((f) => !f.isCategorical);
    if (allNumeric) return '建议至少选一个类别字段做 X（例如 EG / batch_no），否则会被强制按数值分箱';
    return null;
  }, [chartType, xMeta]);

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
                  {!isWafer && (xMeta.length === 0 || yMeta.length === 0) && (
                    <div style={{ padding: 40, color: 'var(--fg-4)', textAlign: 'center' }}>
                      请至少选择 1 个 X 字段和 1 个 Y 字段
                    </div>
                  )}
                  {!isWafer && xMeta.length > 0 && yMeta.length > 0 && (
                    <UnifiedChartGrid
                      chartType={chartType}
                      rows={rows}
                      xFields={xMeta}
                      yFields={yMeta}
                      zField={zMeta}
                    />
                  )}
                  {isWafer && (
                    <WaferMap
                      rows={rows}
                      valueField={waferZ}
                      valueLabel={waferZMeta ? displayLabel(waferZMeta) : waferZ}
                      facetField={waferFacet !== NO_FACET ? waferFacet : null}
                      facets={waferFacetValues}
                      onPointClick={(d) => setActiveDevice(d)}
                    />
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
        <Inspector
          fields={fields}
          chartType={chartType}
          xFields={xFields}
          setXFields={setXFields}
          yFields={yFields}
          setYFields={setYFields}
          zField={zField}
          setZField={setZField}
          waferZ={waferZ}
          setWaferZ={setWaferZ}
          waferFacet={waferFacet}
          setWaferFacet={setWaferFacet}
          xMeta={xMeta}
          yMeta={yMeta}
          violinXWarning={violinXWarning}
          aggregateXWarning={aggregateXWarning}
          limit={limit}
          setLimit={setLimit}
          stats={stats}
        />
      </div>

      {activeDevice && <DeviceModal device={activeDevice} onClose={() => setActiveDevice(null)} />}
    </>
  );
}

/* -------------------------------------------------------------------------
 * Inspector — right-rail config panel.
 *
 * In normal modes it shows multi-select X / multi-select Y / single-select Z.
 * In wafer mode X/Y are locked and only Z (numeric only) + facet (categorical
 * only) are exposed.
 * ----------------------------------------------------------------------- */
function Inspector({
  fields, chartType,
  xFields, setXFields,
  yFields, setYFields,
  zField, setZField,
  waferZ, setWaferZ,
  waferFacet, setWaferFacet,
  xMeta, yMeta, violinXWarning, aggregateXWarning,
  limit, setLimit, stats,
}) {
  const isWafer = chartType === 'wafer';

  // Grid preview text (X cols × Y rows).
  const gridText = `将渲染 ${yMeta.length || '?'} 行 × ${xMeta.length || '?'} 列 = ${(yMeta.length || 0) * (xMeta.length || 0) || '?'} 个子图`;

  return (
    <div className="panel right">
      <div className="panel-head">
        <I.settings size={12} />
        <span>CHART CONFIG</span>
      </div>
      <div className="panel-body">
        {isWafer ? (
          <>
            <div className="section">
              <div className="section-title">轴 / 编码</div>
              <div className="explore-locked-hint">
                X / Y 锁定为器件几何坐标 (x, y)
              </div>
              <FieldRadio
                label="颜色编码 (Z)"
                hint="numeric"
                fields={fields}
                value={waferZ}
                onChange={setWaferZ}
                allowedSections={['numeric', 'process', 'geometric']}
                allowNone={false}
              />
              <FieldRadio
                label="分面字段"
                hint="optional · 类别"
                fields={fields}
                value={waferFacet}
                onChange={setWaferFacet}
                allowedSections={['categorical']}
                allowNone={true}
                noneLabel="不分面"
                noneValue="__none__"
              />
            </div>
          </>
        ) : (
          <>
            <div className="section">
              <div className="section-title">X 字段（可多选）</div>
              <FieldCheckList
                fields={fields}
                value={xFields}
                onChange={setXFields}
              />
            </div>
            <div className="section">
              <div className="section-title">Y 字段（可多选）</div>
              <FieldCheckListWithAgg
                fields={fields}
                value={yFields}
                onChange={setYFields}
              />
              {violinXWarning && (
                <div className="explore-warn">⚠ {violinXWarning}</div>
              )}
              {aggregateXWarning && (
                <div className="explore-warn">⚠ {aggregateXWarning}</div>
              )}
            </div>
            <div className="section">
              <div className="section-title">颜色 / 分组（Z，单选）</div>
              <FieldRadioWithAgg
                hint="optional"
                fields={fields}
                value={zField}
                onChange={setZField}
                allowedSections={['categorical', 'process', 'numeric', 'geometric']}
                allowNone={true}
                noneLabel="不编码"
              />
            </div>
            <div className="explore-grid-hint">{gridText}</div>
          </>
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

/* -------------------------------------------------------------------------
 * FieldCheckList — multi-select checkbox grid grouped by section.
 *
 * Lays sections out as collapsible labelled rows of checkboxes (categorical /
 * process / geometric / numeric). Selected items are toggled in `value`
 * (an array of field-names) via onChange.
 * ----------------------------------------------------------------------- */
function FieldCheckList({ fields, value, onChange, discouragedSections = [], discouragedHint }) {
  const selected = useMemo(() => new Set(value), [value]);
  const toggle = (name) => {
    if (selected.has(name)) onChange(value.filter((v) => v !== name));
    else onChange([...value, name]);
  };
  if (!fields) return <div className="dim" style={{ fontSize: 11 }}>loading…</div>;
  const discouragedSet = new Set(discouragedSections);
  return (
    <div className="explore-fieldlist">
      {SECTION_ORDER.map((section) => {
        const items = fields.raw?.[section] || [];
        if (items.length === 0) return null;
        const isDiscouraged = discouragedSet.has(section);
        return (
          <div key={section} className="explore-fieldgroup">
            <div className="explore-fieldgroup-head">
              <span className="explore-fieldgroup-name">{SECTION_LABELS[section] || section}</span>
              {isDiscouraged && discouragedHint && (
                <span className="explore-fieldgroup-warn">{discouragedHint}</span>
              )}
            </div>
            <div className="explore-fieldgroup-body">
              {items.map((f) => {
                const checked = selected.has(f.name);
                return (
                  <label
                    key={f.name}
                    className={`explore-fieldchip${checked ? ' checked' : ''}${isDiscouraged ? ' discouraged' : ''}`}
                    title={displayLabel(f)}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggle(f.name)}
                      style={{ position: 'absolute', opacity: 0, pointerEvents: 'none' }}
                    />
                    <span className="explore-fieldchip-cb" aria-hidden>
                      {checked && <I.check size={9} stroke="#fff" sw={2.5} />}
                    </span>
                    <span className="explore-fieldchip-label">{displayLabel(f)}</span>
                  </label>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* -------------------------------------------------------------------------
 * FieldCheckListWithAgg — like FieldCheckList but each numeric field carries
 * an aggregation `<select>` (ALL / max / min / mean / median / p25 / p75).
 *
 * value:    [{ name, aggregation }, ...]
 * onChange: receives a new array.
 *
 * Categorical sections never show the dropdown — aggregation is meaningless
 * for category labels.
 * ----------------------------------------------------------------------- */
function FieldCheckListWithAgg({ fields, value, onChange }) {
  const byName = useMemo(() => {
    const m = new Map();
    for (const v of value) m.set(v.name, v);
    return m;
  }, [value]);
  if (!fields) return <div className="dim" style={{ fontSize: 11 }}>loading…</div>;
  const toggle = (name) => {
    if (byName.has(name)) onChange(value.filter((v) => v.name !== name));
    else onChange([...value, { name, aggregation: 'all' }]);
  };
  const setAgg = (name, agg) => {
    onChange(value.map((v) => (v.name === name ? { ...v, aggregation: agg } : v)));
  };
  return (
    <div className="explore-fieldlist">
      {SECTION_ORDER.map((section) => {
        const items = fields.raw?.[section] || [];
        if (items.length === 0) return null;
        const isCategorical = CATEGORICAL_SECTIONS.has(section);
        return (
          <div key={section} className="explore-fieldgroup">
            <div className="explore-fieldgroup-head">
              <span className="explore-fieldgroup-name">{SECTION_LABELS[section] || section}</span>
            </div>
            <div className="explore-fieldgroup-body">
              {items.map((f) => {
                const entry = byName.get(f.name);
                const checked = !!entry;
                return (
                  <span
                    key={f.name}
                    style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}
                  >
                    <label
                      className={`explore-fieldchip${checked ? ' checked' : ''}`}
                      title={displayLabel(f)}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggle(f.name)}
                        style={{ position: 'absolute', opacity: 0, pointerEvents: 'none' }}
                      />
                      <span className="explore-fieldchip-cb" aria-hidden>
                        {checked && <I.check size={9} stroke="#fff" sw={2.5} />}
                      </span>
                      <span className="explore-fieldchip-label">{displayLabel(f)}</span>
                    </label>
                    {checked && !isCategorical && (
                      <select
                        className="input mono"
                        value={entry.aggregation || 'all'}
                        onChange={(e) => setAgg(f.name, e.target.value)}
                        style={{
                          height: 22,
                          padding: '0 4px',
                          fontSize: 10.5,
                          width: 'auto',
                          minWidth: 64,
                        }}
                        title="聚合方式：ALL=不聚合，其他=按 X 分组取该聚合值"
                      >
                        {AGG_OPTIONS.map((o) => (
                          <option key={o.key} value={o.key}>{o.label}</option>
                        ))}
                      </select>
                    )}
                  </span>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* -------------------------------------------------------------------------
 * FieldRadioWithAgg — single-select Z field with aggregation dropdown for
 * numeric picks.
 *
 * value:    { name, aggregation } | null
 * onChange: receives the new value (object) or null.
 * ----------------------------------------------------------------------- */
function FieldRadioWithAgg({
  hint, fields, value, onChange,
  allowedSections, allowNone = true, noneLabel = '不编码',
}) {
  if (!fields) return <div className="dim" style={{ fontSize: 11 }}>loading…</div>;
  const allowed = new Set(allowedSections);
  const currentName = value ? value.name : null;
  const setAgg = (agg) => {
    if (!value) return;
    onChange({ ...value, aggregation: agg });
  };
  // Look up section of currently-selected field to decide whether to show agg.
  const currentSection = useMemo(() => {
    if (!currentName) return null;
    for (const s of SECTION_ORDER) {
      if ((fields.raw?.[s] || []).some((x) => x.name === currentName)) return s;
    }
    return null;
  }, [currentName, fields]);
  const showAgg = currentName && currentSection && !CATEGORICAL_SECTIONS.has(currentSection);
  return (
    <div className="explore-radio">
      {hint && (
        <div className="field-label" style={{ marginBottom: 6 }}>
          <span className="hint">{hint}</span>
        </div>
      )}
      {showAgg && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
          <span style={{ fontSize: 10.5, color: 'var(--fg-3)' }}>聚合：</span>
          <select
            className="input mono"
            value={value.aggregation || 'all'}
            onChange={(e) => setAgg(e.target.value)}
            style={{ height: 22, padding: '0 4px', fontSize: 10.5, minWidth: 110 }}
          >
            {AGG_OPTIONS.map((o) => (
              <option key={o.key} value={o.key}>{o.label}</option>
            ))}
          </select>
        </div>
      )}
      <div className="explore-fieldlist compact">
        {allowNone && (
          <div className="explore-fieldgroup">
            <div className="explore-fieldgroup-body">
              <label className={`explore-fieldchip${value === null ? ' checked' : ''} radio`}>
                <input
                  type="radio"
                  checked={value === null}
                  onChange={() => onChange(null)}
                  style={{ position: 'absolute', opacity: 0, pointerEvents: 'none' }}
                />
                <span className="explore-fieldchip-radio" aria-hidden>
                  {value === null && <span className="dot" />}
                </span>
                <span className="explore-fieldchip-label">{noneLabel}</span>
              </label>
            </div>
          </div>
        )}
        {SECTION_ORDER.filter((s) => allowed.has(s)).map((section) => {
          const items = fields.raw?.[section] || [];
          if (items.length === 0) return null;
          return (
            <div key={section} className="explore-fieldgroup">
              <div className="explore-fieldgroup-head">
                <span className="explore-fieldgroup-name">{SECTION_LABELS[section] || section}</span>
              </div>
              <div className="explore-fieldgroup-body">
                {items.map((f) => {
                  const checked = currentName === f.name;
                  return (
                    <label
                      key={f.name}
                      className={`explore-fieldchip${checked ? ' checked' : ''} radio`}
                      title={displayLabel(f)}
                    >
                      <input
                        type="radio"
                        checked={checked}
                        onChange={() => onChange({ name: f.name, aggregation: 'all' })}
                        style={{ position: 'absolute', opacity: 0, pointerEvents: 'none' }}
                      />
                      <span className="explore-fieldchip-radio" aria-hidden>
                        {checked && <span className="dot" />}
                      </span>
                      <span className="explore-fieldchip-label">{displayLabel(f)}</span>
                    </label>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------
 * FieldRadio — single-select radio grid grouped by section. Used for Z and
 * the wafer-mode pickers. Optionally includes a leading "no encoding" radio.
 * ----------------------------------------------------------------------- */
function FieldRadio({
  label, hint, fields, value, onChange,
  allowedSections, allowNone = false, noneLabel = '不编码', noneValue = null,
}) {
  if (!fields) return <div className="dim" style={{ fontSize: 11 }}>loading…</div>;
  const allowed = new Set(allowedSections);
  return (
    <div className="explore-radio">
      {label && (
        <div className="field-label" style={{ marginBottom: 6 }}>
          <span>{label}</span>
          {hint && <span className="hint">{hint}</span>}
        </div>
      )}
      <div className="explore-fieldlist compact">
        {allowNone && (
          <div className="explore-fieldgroup">
            <div className="explore-fieldgroup-body">
              <label
                className={`explore-fieldchip${value === noneValue ? ' checked' : ''} radio`}
              >
                <input
                  type="radio"
                  checked={value === noneValue}
                  onChange={() => onChange(noneValue)}
                  style={{ position: 'absolute', opacity: 0, pointerEvents: 'none' }}
                />
                <span className="explore-fieldchip-radio" aria-hidden>
                  {value === noneValue && <span className="dot" />}
                </span>
                <span className="explore-fieldchip-label">{noneLabel}</span>
              </label>
            </div>
          </div>
        )}
        {SECTION_ORDER.filter((s) => allowed.has(s)).map((section) => {
          const items = fields.raw?.[section] || [];
          if (items.length === 0) return null;
          return (
            <div key={section} className="explore-fieldgroup">
              <div className="explore-fieldgroup-head">
                <span className="explore-fieldgroup-name">{SECTION_LABELS[section] || section}</span>
              </div>
              <div className="explore-fieldgroup-body">
                {items.map((f) => {
                  const checked = value === f.name;
                  return (
                    <label
                      key={f.name}
                      className={`explore-fieldchip${checked ? ' checked' : ''} radio`}
                      title={displayLabel(f)}
                    >
                      <input
                        type="radio"
                        checked={checked}
                        onChange={() => onChange(f.name)}
                        style={{ position: 'absolute', opacity: 0, pointerEvents: 'none' }}
                      />
                      <span className="explore-fieldchip-radio" aria-hidden>
                        {checked && <span className="dot" />}
                      </span>
                      <span className="explore-fieldchip-label">{displayLabel(f)}</span>
                    </label>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
