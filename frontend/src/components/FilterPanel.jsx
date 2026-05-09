import React, { useEffect, useState } from 'react';
import I from './Icons.jsx';
import { distinctValues } from '../api/endpoints.js';

/**
 * CheckboxGroup
 *
 * Renders a list of checkbox options. Either pass `options` directly
 * (array of strings/numbers) or `fetcher` returning a Promise that
 * resolves to `{ values: [...] }` (matching /api/query/distinct).
 *
 * `value` is the array of currently-selected entries; `onChange(next)`
 * receives the new array. Empty array == no constraint (don't filter).
 */
export function CheckboxGroup({ label, options, fetcher, value, onChange, formatter }) {
  const [items, setItems] = useState(options || []);
  const [loading, setLoading] = useState(!options && !!fetcher);
  const [error, setError] = useState(null);

  useEffect(() => {
    let alive = true;
    if (options) {
      setItems(options);
      return;
    }
    if (!fetcher) return;
    setLoading(true);
    fetcher()
      .then((res) => {
        if (!alive) return;
        const vals = Array.isArray(res) ? res : res.values || [];
        setItems(vals);
        setLoading(false);
      })
      .catch((e) => {
        if (!alive) return;
        setError(e.message || String(e));
        setLoading(false);
      });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const selected = new Set((value || []).map(String));
  const allSelected = items.length > 0 && items.every((v) => selected.has(String(v)));
  const someSelected = items.some((v) => selected.has(String(v)));

  const toggle = (v) => {
    const sv = String(v);
    const nextSet = new Set(selected);
    if (nextSet.has(sv)) nextSet.delete(sv);
    else nextSet.add(sv);
    // Preserve original type when emitting back
    const next = items.filter((it) => nextSet.has(String(it)));
    onChange(next);
  };
  const selectAll = () => onChange(items.slice());
  const selectNone = () => onChange([]);
  const invert = () => onChange(items.filter((it) => !selected.has(String(it))));

  const format = formatter || ((v) => String(v));
  const scrollable = items.length > 10;

  return (
    <div className="field">
      <div className="field-label">
        <span>{label}</span>
        <span className="hint">
          {loading ? 'loading…' : `${selected.size}/${items.length}`}
        </span>
      </div>
      {error && <div className="dim" style={{ color: 'var(--fail)', fontSize: 11 }}>{error}</div>}
      <div className="cbg-actions">
        <button type="button" className="btn ghost sm" onClick={selectAll} disabled={loading || allSelected}>全选</button>
        <button type="button" className="btn ghost sm" onClick={selectNone} disabled={loading || !someSelected}>清空</button>
        <button type="button" className="btn ghost sm" onClick={invert} disabled={loading || items.length === 0}>反选</button>
      </div>
      <div className={`cbg-list${scrollable ? ' scrollable' : ''}${loading ? ' loading' : ''}`}>
        {!loading && items.length === 0 && (
          <div className="dim" style={{ fontSize: 11, padding: '4px 2px' }}>无可用选项</div>
        )}
        {items.map((v) => {
          const sv = String(v);
          const checked = selected.has(sv);
          return (
            <label key={sv} className="cbg-item" title={format(v)}>
              <span className={`cb${checked ? ' checked' : ''}`} aria-hidden>
                {checked && <I.check size={10} stroke="#fff" sw={2.5} />}
              </span>
              <input
                type="checkbox"
                checked={checked}
                onChange={() => toggle(v)}
                style={{ position: 'absolute', opacity: 0, pointerEvents: 'none' }}
              />
              <span className="cbg-item-label">{format(v)}</span>
            </label>
          );
        })}
      </div>
    </div>
  );
}

/**
 * RangeInput — two numeric inputs for {gte, lte} on a numeric field.
 */
export function RangeInput({ label, value, onChange, placeholder = ['min', 'max'] }) {
  const v = value || {};
  const setMin = (e) => {
    const s = e.target.value;
    const next = { ...v };
    if (s === '') delete next.gte; else next.gte = parseFloat(s);
    onChange(next);
  };
  const setMax = (e) => {
    const s = e.target.value;
    const next = { ...v };
    if (s === '') delete next.lte; else next.lte = parseFloat(s);
    onChange(next);
  };
  return (
    <div className="field">
      <div className="field-label">
        <span>{label}</span>
      </div>
      <div className="row-flex">
        <input
          className="input mono"
          placeholder={placeholder[0]}
          value={v.gte ?? ''}
          onChange={setMin}
          style={{ flex: 1 }}
        />
        <span className="dim">—</span>
        <input
          className="input mono"
          placeholder={placeholder[1]}
          value={v.lte ?? ''}
          onChange={setMax}
          style={{ flex: 1 }}
        />
      </div>
    </div>
  );
}

/**
 * FilterPanel — wraps the standard set of filters used by /explore.
 *
 * `value` is the in-flight filter draft; `onApply(filters)` is called
 * when the user clicks "应用筛选" with a normalized filter dict ready
 * to send to /api/query/devices.
 */
export default function FilterPanel({ value, onApply }) {
  const [draft, setDraft] = useState(value || {});

  const setField = (name, v) => {
    setDraft((d) => {
      const next = { ...d };
      // Empty array / empty range => remove the key so it doesn't filter.
      if (Array.isArray(v) && v.length === 0) delete next[name];
      else if (v && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length === 0) delete next[name];
      else next[name] = v;
      return next;
    });
  };

  const apply = () => onApply(draft);
  const clear = () => { setDraft({}); onApply({}); };

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
        <CheckboxGroup
          label="批次号"
          fetcher={() => distinctValues('batch_no')}
          value={draft.batch_no || []}
          onChange={(v) => setField('batch_no', v)}
        />
        <CheckboxGroup
          label="Wafer"
          fetcher={() => distinctValues('wafer')}
          value={draft.wafer || []}
          onChange={(v) => setField('wafer', v)}
        />
        <CheckboxGroup
          label="Pass / Fail"
          options={['Y', 'N']}
          value={draft.pf || []}
          onChange={(v) => setField('pf', v)}
          formatter={(x) => (x === 'Y' ? 'Pass (Y)' : x === 'N' ? 'Fail (N)' : String(x))}
        />
        <CheckboxGroup
          label="端口"
          options={['S11', 'S22']}
          value={draft.folder_name || []}
          onChange={(v) => setField('folder_name', v)}
        />
        <RangeInput
          label="fs (GHz)"
          value={draft.fs_ghz || {}}
          onChange={(v) => setField('fs_ghz', v)}
        />
        <div className="hr" />
        <button className="btn primary" style={{ width: '100%', justifyContent: 'center' }} onClick={apply}>
          应用筛选
        </button>
        {Object.keys(draft).length > 0 && (
          <div className="dim mono" style={{ fontSize: 10.5, marginTop: 8, wordBreak: 'break-all' }}>
            {JSON.stringify(draft)}
          </div>
        )}
      </div>
    </div>
  );
}
