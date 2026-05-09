import React from 'react';
import Plot from 'react-plotly.js';

const baseLayout = {
  paper_bgcolor: '#ffffff',
  plot_bgcolor: '#fdfdfe',
  font: { family: 'Inter, system-ui, sans-serif', size: 11, color: '#2c3340' },
  margin: { l: 56, r: 16, t: 24, b: 44 },
  xaxis: { gridcolor: 'rgba(15,23,42,0.06)', zeroline: false, automargin: true },
  yaxis: { gridcolor: 'rgba(15,23,42,0.06)', zeroline: false, automargin: true },
  hoverlabel: { bgcolor: '#0f172a', font: { color: '#fff', family: 'JetBrains Mono, monospace' } },
};

const baseConfig = {
  displaylogo: false,
  responsive: true,
  modeBarButtonsToRemove: ['select2d', 'lasso2d'],
};

const PALETTE = ['#2c79f6', '#0e9488', '#c97a16', '#7b3fe4', '#1e8a5a', '#c2410c', '#0e6bb0', '#b58900',
                 '#b91c5c', '#65a30d', '#0369a1', '#d97706'];

// Colorscale used when colorKey is numeric.
const NUMERIC_COLORSCALE = 'Viridis';

/* ------------------------------------------------------------------
 *  Helpers
 * ------------------------------------------------------------------ */

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

// Group rows by a categorical (or any) key; returns Map<key, rows[]>.
function groupBy(rows, key) {
  const m = new Map();
  rows.forEach((r) => {
    const k = r?.[key];
    const sk = k === null || k === undefined ? '∅' : k;
    if (!m.has(sk)) m.set(sk, []);
    m.get(sk).push(r);
  });
  return m;
}

// Sort categorical keys (numbers numerically, strings lexically).
function sortKeys(keys) {
  const arr = [...keys];
  const allNum = arr.every((k) => typeof k === 'number' || (!isNaN(parseFloat(k)) && isFinite(k)));
  if (allNum) return arr.sort((a, b) => parseFloat(a) - parseFloat(b));
  return arr.sort((a, b) => String(a).localeCompare(String(b)));
}

/* ------------------------------------------------------------------
 *  ScatterPlot
 *
 *  - If xIsCategory, we render a strip-style scatter (one column of
 *    points per X value, with horizontal jitter).
 *  - colorKey can be categorical (one trace per value) or numeric
 *    (single trace, marker.color mapped via colorscale + colorbar).
 * ------------------------------------------------------------------ */
export function ScatterPlot({
  rows, xKey, yKey, colorKey,
  xLabel, yLabel, colorLabel,
  xIsCategory = false, colorIsCategory = true,
  onPointClick,
}) {
  const traces = [];

  if (colorKey && !colorIsCategory) {
    // Numeric color mapping → single trace with colorscale.
    const xs = rows.map((d) => d[xKey]);
    const ys = rows.map((d) => d[yKey]);
    const cs = rows.map((d) => d[colorKey]);
    traces.push({
      type: 'scattergl',
      mode: 'markers',
      x: xs,
      y: ys,
      marker: {
        size: 6,
        color: cs,
        colorscale: NUMERIC_COLORSCALE,
        showscale: true,
        colorbar: { title: { text: colorLabel || colorKey, side: 'right' }, thickness: 12, len: 0.6 },
        opacity: 0.85,
      },
      customdata: rows,
      hovertemplate: `<b>%{x}</b>, %{y}<br>${colorLabel || colorKey}: %{marker.color}<extra></extra>`,
      name: 'all',
    });
  } else {
    const colorGroups = colorKey ? groupBy(rows, colorKey) : new Map([['all', rows]]);
    const colorKeysSorted = colorKey ? sortKeys(colorGroups.keys()) : ['all'];
    let i = 0;
    for (const ck of colorKeysSorted) {
      const grp = colorGroups.get(ck);
      let xs, ys;
      if (xIsCategory) {
        // strip plot — preserve category but jitter for visibility
        xs = grp.map((d) => d[xKey]);
        ys = grp.map((d) => d[yKey]);
      } else {
        xs = grp.map((d) => d[xKey]);
        ys = grp.map((d) => d[yKey]);
      }
      traces.push({
        type: xIsCategory ? 'scatter' : 'scattergl',
        mode: 'markers',
        x: xs,
        y: ys,
        name: colorKey ? `${ck}` : 'all',
        marker: {
          size: xIsCategory ? 6 : 5,
          color: PALETTE[i % PALETTE.length],
          opacity: 0.78,
          line: xIsCategory ? { width: 0.5, color: '#ffffff80' } : undefined,
        },
        customdata: grp,
        hovertemplate: `<b>%{x}</b>, %{y}<extra></extra>`,
      });
      i++;
    }
  }

  const layout = {
    ...baseLayout,
    showlegend: !!colorKey && colorIsCategory,
    xaxis: {
      ...baseLayout.xaxis,
      title: xLabel || xKey,
      type: xIsCategory ? 'category' : undefined,
    },
    yaxis: { ...baseLayout.yaxis, title: yLabel || yKey },
    legend: { orientation: 'h', y: 1.08, x: 0 },
  };
  if (xIsCategory) {
    // give Plotly a small jitter so overlapping points fan out
    layout.xaxis.categoryorder = 'category ascending';
  }

  return (
    <Plot
      data={traces}
      layout={layout}
      config={baseConfig}
      style={{ width: '100%', height: '100%' }}
      useResizeHandler
      onClick={(e) => {
        if (onPointClick && e.points && e.points[0]) {
          onPointClick(e.points[0].customdata);
        }
      }}
    />
  );
}

/* ------------------------------------------------------------------
 *  BoxPlot
 *
 *  Group on X (categorical). If colorKey is also categorical, we
 *  render side-by-side boxes (boxmode: group) per color value.
 * ------------------------------------------------------------------ */
export function BoxPlot({ rows, xKey, yKey, colorKey, xLabel, yLabel, colorIsCategory = true }) {
  const traces = [];
  if (colorKey && colorIsCategory && colorKey !== xKey) {
    const colorGroups = groupBy(rows, colorKey);
    const ckeys = sortKeys(colorGroups.keys());
    let i = 0;
    for (const ck of ckeys) {
      const grp = colorGroups.get(ck);
      traces.push({
        type: 'box',
        x: grp.map((d) => d[xKey]),
        y: grp.map((d) => d[yKey]),
        name: String(ck),
        marker: { color: PALETTE[i % PALETTE.length] },
        boxpoints: 'outliers',
      });
      i++;
    }
  } else {
    // single grouping by X
    const xGroups = groupBy(rows, xKey);
    const xkeys = sortKeys(xGroups.keys());
    let i = 0;
    for (const xk of xkeys) {
      const grp = xGroups.get(xk);
      traces.push({
        type: 'box',
        x: grp.map(() => xk),
        y: grp.map((d) => d[yKey]),
        name: String(xk),
        marker: { color: PALETTE[i % PALETTE.length] },
        boxpoints: 'outliers',
      });
      i++;
    }
  }
  const layout = {
    ...baseLayout,
    showlegend: !!colorKey && colorIsCategory && colorKey !== xKey,
    boxmode: 'group',
    xaxis: { ...baseLayout.xaxis, title: xLabel || xKey, type: 'category' },
    yaxis: { ...baseLayout.yaxis, title: yLabel || yKey },
    legend: { orientation: 'h', y: 1.08, x: 0 },
  };
  return (
    <Plot
      data={traces}
      layout={layout}
      config={baseConfig}
      style={{ width: '100%', height: '100%' }}
      useResizeHandler
    />
  );
}

/* ------------------------------------------------------------------
 *  ViolinPlot
 * ------------------------------------------------------------------ */
export function ViolinPlot({ rows, xKey, yKey, colorKey, xLabel, yLabel, colorIsCategory = true }) {
  const traces = [];
  if (colorKey && colorIsCategory && colorKey !== xKey) {
    const colorGroups = groupBy(rows, colorKey);
    const ckeys = sortKeys(colorGroups.keys());
    let i = 0;
    for (const ck of ckeys) {
      const grp = colorGroups.get(ck);
      traces.push({
        type: 'violin',
        x: grp.map((d) => d[xKey]),
        y: grp.map((d) => d[yKey]),
        name: String(ck),
        box: { visible: true },
        meanline: { visible: true },
        points: 'outliers',
        marker: { color: PALETTE[i % PALETTE.length], opacity: 0.8 },
        line: { color: PALETTE[i % PALETTE.length] },
        fillcolor: PALETTE[i % PALETTE.length] + '40',
      });
      i++;
    }
  } else {
    const xGroups = groupBy(rows, xKey);
    const xkeys = sortKeys(xGroups.keys());
    let i = 0;
    for (const xk of xkeys) {
      const grp = xGroups.get(xk);
      traces.push({
        type: 'violin',
        x: grp.map(() => xk),
        y: grp.map((d) => d[yKey]),
        name: String(xk),
        box: { visible: true },
        meanline: { visible: true },
        points: 'outliers',
        marker: { color: PALETTE[i % PALETTE.length], opacity: 0.8 },
        line: { color: PALETTE[i % PALETTE.length] },
        fillcolor: PALETTE[i % PALETTE.length] + '40',
      });
      i++;
    }
  }
  const layout = {
    ...baseLayout,
    showlegend: !!colorKey && colorIsCategory && colorKey !== xKey,
    violinmode: 'group',
    xaxis: { ...baseLayout.xaxis, title: xLabel || xKey, type: 'category' },
    yaxis: { ...baseLayout.yaxis, title: yLabel || yKey },
    legend: { orientation: 'h', y: 1.08, x: 0 },
  };
  return (
    <Plot
      data={traces}
      layout={layout}
      config={baseConfig}
      style={{ width: '100%', height: '100%' }}
      useResizeHandler
    />
  );
}

/* ------------------------------------------------------------------
 *  LineChart — basic single/multi-series line.
 * ------------------------------------------------------------------ */
export function LineChart({ x, y, xLabel, yLabel, name, color, markers = [], series, showLegend, xIsCategory }) {
  const traces = series && series.length
    ? series.map((s, i) => ({
        type: 'scatter',
        mode: s.mode || 'lines+markers',
        x: s.x || x,
        y: s.y,
        name: s.name || `trace ${i + 1}`,
        connectgaps: false,
        line: {
          color: s.color || PALETTE[i % PALETTE.length],
          width: s.width != null ? s.width : 1.4,
          dash: s.dash || 'solid',
        },
        marker: { color: s.color || PALETTE[i % PALETTE.length], size: 5 },
        opacity: s.opacity != null ? s.opacity : 1,
      }))
    : [
        {
          type: 'scatter',
          mode: 'lines',
          x,
          y,
          name: name || 'trace',
          line: { color: color || PALETTE[0], width: 1.4 },
        },
      ];
  const shapes = markers.map((m) => ({
    type: 'line', x0: m.x, x1: m.x, yref: 'paper', y0: 0, y1: 1,
    line: { color: m.color || '#c97a16', width: 1, dash: 'dash' },
  }));
  const annotations = markers.map((m) => ({
    x: m.x, yref: 'paper', y: 1, text: m.label || '', showarrow: false,
    font: { color: m.color || '#c97a16', size: 10 }, bgcolor: '#fff',
  }));
  const layout = {
    ...baseLayout,
    showlegend: !!showLegend,
    legend: { orientation: 'h', y: 1.08, x: 0 },
    xaxis: { ...baseLayout.xaxis, title: xLabel || 'x', type: xIsCategory ? 'category' : undefined },
    yaxis: { ...baseLayout.yaxis, title: yLabel || 'y' },
    shapes,
    annotations,
  };
  return (
    <Plot
      data={traces}
      layout={layout}
      config={baseConfig}
      style={{ width: '100%', height: '100%' }}
      useResizeHandler
    />
  );
}

/* ------------------------------------------------------------------
 *  MultiLineChart
 *
 *  Build multiple line series from rows by:
 *    - groupKey (one line per group value)
 *    - xKey / yKey
 *  Within each group, points are sorted by X.
 * ------------------------------------------------------------------ */
export function MultiLineChart({ rows, xKey, yKey, colorKey, xLabel, yLabel, xIsCategory = false }) {
  const groups = colorKey ? groupBy(rows, colorKey) : new Map([['all', rows]]);
  const gkeys = colorKey ? sortKeys(groups.keys()) : ['all'];
  const series = gkeys.map((gk, i) => {
    const grp = groups.get(gk);
    let sorted;
    if (xIsCategory) {
      sorted = grp.slice();
    } else {
      sorted = grp.slice().sort((a, b) => {
        const ax = a[xKey], bx = b[xKey];
        if (!isNum(ax)) return 1; if (!isNum(bx)) return -1;
        return ax - bx;
      });
    }
    return {
      name: colorKey ? String(gk) : 'all',
      x: sorted.map((d) => d[xKey]),
      y: sorted.map((d) => d[yKey]),
      color: PALETTE[i % PALETTE.length],
    };
  });
  return (
    <LineChart
      series={series}
      xLabel={xLabel}
      yLabel={yLabel}
      showLegend={!!colorKey}
      xIsCategory={xIsCategory}
    />
  );
}

/* ------------------------------------------------------------------
 *  FacetedGrid
 *
 *  N rows × 1 column of small subplots, sharing the X axis. Each
 *  subplot shows a different yField from `yFields`. If `kind ==
 *  'violin'` and X is categorical, each subplot is a violin per X
 *  value (matching the customer reference shot). Otherwise scatter.
 *
 *  - rows: all data rows
 *  - xKey: X axis (typically categorical, e.g. 'eg')
 *  - yFields: array of {name, label, unit} for each row's Y
 *  - colorKey: optional sub-grouping color
 * ------------------------------------------------------------------ */
export function FacetedGrid({
  rows, xKey, yFields, colorKey,
  xLabel, xIsCategory = true, kind = 'violin',
  rowHeight = 110,
}) {
  if (!yFields || yFields.length === 0) {
    return <div style={{ padding: 20, color: 'var(--fg-4)' }}>请选择至少一个 Y 字段</div>;
  }

  const nRows = yFields.length;
  const traces = [];
  const layout = {
    ...baseLayout,
    showlegend: false,
    grid: { rows: nRows, columns: 1, pattern: 'independent', roworder: 'top to bottom' },
    margin: { l: 64, r: 16, t: 16, b: 40 },
    height: Math.max(nRows * rowHeight + 60, 360),
    annotations: [],
  };

  // Plotly subplot axes are indexed: xaxis, xaxis2, ...; yaxis, yaxis2, ...
  // With grid.pattern='independent', each row gets its own X+Y pair, but we
  // share visible ticks only on the bottom-most X for a clean look.

  const colorGroups = colorKey ? groupBy(rows, colorKey) : null;
  const colorKeys = colorGroups ? sortKeys(colorGroups.keys()) : null;

  yFields.forEach((yf, rIdx) => {
    const yKey = yf.name;
    const yLabel = yf.unit ? `${yf.label} (${yf.unit})` : yf.label || yf.name;
    const axisIdx = rIdx + 1;
    const xref = `x${axisIdx === 1 ? '' : axisIdx}`;
    const yref = `y${axisIdx === 1 ? '' : axisIdx}`;

    const showX = rIdx === nRows - 1;
    layout[`xaxis${axisIdx === 1 ? '' : axisIdx}`] = {
      ...baseLayout.xaxis,
      type: xIsCategory ? 'category' : undefined,
      title: showX ? xLabel || xKey : undefined,
      showticklabels: showX,
      tickfont: { size: 10 },
    };
    layout[`yaxis${axisIdx === 1 ? '' : axisIdx}`] = {
      ...baseLayout.yaxis,
      title: { text: yLabel, font: { size: 10 } },
      tickfont: { size: 9 },
      automargin: true,
    };

    const baseColor = PALETTE[rIdx % PALETTE.length];

    if (kind === 'violin') {
      // one violin per X value, optionally split by color
      if (colorGroups) {
        let ci = 0;
        for (const ck of colorKeys) {
          const grp = colorGroups.get(ck);
          traces.push({
            type: 'violin',
            x: grp.map((d) => d[xKey]),
            y: grp.map((d) => d[yKey]),
            xaxis: xref, yaxis: yref,
            name: `${ck}`,
            legendgroup: String(ck),
            showlegend: rIdx === 0,
            box: { visible: true }, meanline: { visible: true },
            points: false,
            marker: { color: PALETTE[ci % PALETTE.length] },
            line: { color: PALETTE[ci % PALETTE.length], width: 1 },
            fillcolor: PALETTE[ci % PALETTE.length] + '50',
            spanmode: 'soft',
          });
          ci++;
        }
      } else {
        traces.push({
          type: 'violin',
          x: rows.map((d) => d[xKey]),
          y: rows.map((d) => d[yKey]),
          xaxis: xref, yaxis: yref,
          name: yLabel,
          showlegend: false,
          box: { visible: true }, meanline: { visible: true },
          points: false,
          marker: { color: baseColor },
          line: { color: baseColor, width: 1 },
          fillcolor: baseColor + '50',
          spanmode: 'soft',
        });
      }
    } else {
      // scatter / strip per row
      if (colorGroups) {
        let ci = 0;
        for (const ck of colorKeys) {
          const grp = colorGroups.get(ck);
          traces.push({
            type: 'scatter', mode: 'markers',
            x: grp.map((d) => d[xKey]),
            y: grp.map((d) => d[yKey]),
            xaxis: xref, yaxis: yref,
            name: String(ck),
            legendgroup: String(ck),
            showlegend: rIdx === 0,
            marker: { color: PALETTE[ci % PALETTE.length], size: 5, opacity: 0.7 },
          });
          ci++;
        }
      } else {
        traces.push({
          type: 'scatter', mode: 'markers',
          x: rows.map((d) => d[xKey]),
          y: rows.map((d) => d[yKey]),
          xaxis: xref, yaxis: yref,
          name: yLabel, showlegend: false,
          marker: { color: baseColor, size: 5, opacity: 0.7 },
        });
      }
    }
  });

  if (colorGroups) {
    layout.showlegend = true;
    layout.legend = { orientation: 'h', y: 1.04, x: 0 };
  }

  return (
    <Plot
      data={traces}
      layout={layout}
      config={baseConfig}
      style={{ width: '100%', height: '100%' }}
      useResizeHandler
    />
  );
}

/* ------------------------------------------------------------------
 *  WaferMap
 *
 *  Render every device at its physical (x, y) die coordinate as a
 *  square marker, color-encoded by `valueField`. If `facetField` is
 *  set, build a 1-row × N-col subplot grid (one panel per facet
 *  value, sharing the colorbar). 1:1 aspect ratio so dies look square.
 *
 *  Multiple devices at the same (x, y) overlap; the last drawn point
 *  wins visually but hover lists all neighbours via the tooltip.
 * ------------------------------------------------------------------ */
export function WaferMap({
  rows, valueField, valueLabel,
  facetField, facets,
  onPointClick,
}) {
  const allXs = rows.map((r) => r['x']).filter(Number.isFinite);
  const allYs = rows.map((r) => r['y']).filter(Number.isFinite);
  const xMin = allXs.length ? Math.min(...allXs) - 1 : -1;
  const xMax = allXs.length ? Math.max(...allXs) + 1 : 1;
  const yMin = allYs.length ? Math.min(...allYs) - 1 : -1;
  const yMax = allYs.length ? Math.max(...allYs) + 1 : 1;

  const allVals = rows.map((r) => r[valueField]).filter(Number.isFinite);
  const vMin = allVals.length ? Math.min(...allVals) : 0;
  const vMax = allVals.length ? Math.max(...allVals) : 1;

  const useFacets = !!facetField && facets && facets.length > 0;
  const panels = useFacets
    ? facets.map((fv) => ({ key: String(fv), rows: rows.filter((r) => String(r[facetField]) === String(fv)) }))
    : [{ key: 'all', rows }];

  const traces = [];
  const layout = {
    ...baseLayout,
    showlegend: false,
    margin: { l: 56, r: 16, t: 36, b: 44 },
    annotations: [],
  };

  if (useFacets) {
    layout.grid = { rows: 1, columns: panels.length, pattern: 'independent' };
  }

  panels.forEach((panel, pIdx) => {
    const axisIdx = pIdx + 1;
    const xref = `x${axisIdx === 1 ? '' : axisIdx}`;
    const yref = `y${axisIdx === 1 ? '' : axisIdx}`;
    const xKeyAxis = `xaxis${axisIdx === 1 ? '' : axisIdx}`;
    const yKeyAxis = `yaxis${axisIdx === 1 ? '' : axisIdx}`;

    layout[xKeyAxis] = {
      ...baseLayout.xaxis,
      title: 'X (die 坐标)',
      range: [xMin, xMax],
      dtick: 1,
      zeroline: false,
    };
    layout[yKeyAxis] = {
      ...baseLayout.yaxis,
      title: pIdx === 0 ? 'Y (die 坐标)' : undefined,
      range: [yMin, yMax],
      dtick: 1,
      scaleanchor: xref,
      scaleratio: 1,
      zeroline: false,
    };

    if (useFacets) {
      // panel title centered above each subplot
      const xDomainCenter = (pIdx + 0.5) / panels.length;
      layout.annotations.push({
        x: xDomainCenter, y: 1.02, xref: 'paper', yref: 'paper',
        text: `${facetField} = ${panel.key}`, showarrow: false,
        font: { size: 11, color: '#475569' },
      });
    }

    const pRows = panel.rows;
    traces.push({
      type: 'scattergl',
      mode: 'markers',
      x: pRows.map((r) => r.x),
      y: pRows.map((r) => r.y),
      xaxis: xref,
      yaxis: yref,
      marker: {
        size: 22,
        symbol: 'square',
        color: pRows.map((r) => r[valueField]),
        colorscale: NUMERIC_COLORSCALE,
        cmin: vMin,
        cmax: vMax,
        showscale: pIdx === panels.length - 1,
        colorbar: pIdx === panels.length - 1
          ? { title: { text: valueLabel || valueField, side: 'right' }, thickness: 12, len: 0.7 }
          : undefined,
        line: { width: 1, color: 'rgba(15,23,42,0.25)' },
        opacity: 0.9,
      },
      customdata: pRows,
      hovertemplate:
        '<b>id %{customdata.id}</b><br>'
        + 'x=%{x}, y=%{y}<br>'
        + (valueLabel || valueField) + ': %{marker.color:.4g}'
        + '<extra></extra>',
      name: panel.key,
    });
  });

  return (
    <Plot
      data={traces}
      layout={layout}
      config={baseConfig}
      style={{ width: '100%', height: '100%' }}
      useResizeHandler
      onClick={(e) => {
        if (onPointClick && e.points && e.points[0]) {
          onPointClick(e.points[0].customdata);
        }
      }}
    />
  );
}

/* ------------------------------------------------------------------
 *  UnifiedChartGrid
 *
 *  Unified renderer that lays out a (yFields × xFields) subplot grid
 *  for chartType ∈ {scatter, box, violin, line}. Each cell renders a
 *  chart of the chosen type for that (xField, yField) pair, optionally
 *  colored / split by `zField`.
 *
 *    - xFields / yFields: array of { name, label, unit, isCategorical }
 *    - zField: { name, label, unit, isCategorical } | null
 *    - height: per-cell height (px). Default 350.
 *
 *  Empty xFields or yFields → placeholder.
 * ------------------------------------------------------------------ */

// Resolve all distinct values of a categorical field across rows, sorted.
function distinctSortedValues(rows, key) {
  const set = new Set();
  rows.forEach((r) => {
    const v = r?.[key];
    if (v !== null && v !== undefined) set.add(v);
  });
  return sortKeys(set);
}

// Sub-axis suffix: cell index 1 → '', cell index 2 → '2', ...
function axisSuffix(idx) {
  return idx === 1 ? '' : String(idx);
}

// Format axis title from field meta.
function axisTitle(field) {
  if (!field) return '';
  const lbl = field.label || field.name;
  return field.unit ? `${lbl} (${field.unit})` : lbl;
}

/* ----- per-cell trace builders ----- */

// Scatter / strip plot for one (xField, yField, zField) cell.
function buildScatterTraces({ rows, xField, yField, zField, axisRef, useGl, zCategoryValues, showLegend }) {
  const xKey = xField.name;
  const yKey = yField.name;
  const xref = `x${axisRef}`;
  const yref = `y${axisRef}`;
  const xIsCat = !!xField.isCategorical;
  const yIsCat = !!yField.isCategorical;
  // scattergl does not work cleanly when either axis is categorical → use SVG.
  const wantGl = useGl && !xIsCat && !yIsCat;
  const traces = [];

  if (zField && !zField.isCategorical) {
    // Numeric Z → single trace, marker.color encodes Z. Show only one
    // shared colorbar (the caller decides which cell does so).
    traces.push({
      type: wantGl ? 'scattergl' : 'scatter',
      mode: 'markers',
      x: rows.map((d) => d[xKey]),
      y: rows.map((d) => d[yKey]),
      xaxis: xref,
      yaxis: yref,
      marker: {
        size: 6,
        color: rows.map((d) => d[zField.name]),
        colorscale: NUMERIC_COLORSCALE,
        showscale: showLegend,
        colorbar: showLegend
          ? { title: { text: axisTitle(zField), side: 'right' }, thickness: 12, len: 0.6, x: 1.02 }
          : undefined,
        opacity: 0.85,
      },
      showlegend: false,
      hovertemplate: `<b>%{x}</b>, %{y}<br>${axisTitle(zField)}: %{marker.color}<extra></extra>`,
    });
  } else if (zField && zField.isCategorical) {
    // Categorical Z → one trace per Z value. Use legendgroup to share
    // a single legend across all cells; only the FIRST cell shows the
    // legend entry.
    const zKey = zField.name;
    const zVals = zCategoryValues || distinctSortedValues(rows, zKey);
    let i = 0;
    for (const zv of zVals) {
      const grp = rows.filter((r) => r[zKey] === zv);
      traces.push({
        type: wantGl ? 'scattergl' : 'scatter',
        mode: 'markers',
        x: grp.map((d) => d[xKey]),
        y: grp.map((d) => d[yKey]),
        xaxis: xref,
        yaxis: yref,
        name: String(zv),
        legendgroup: String(zv),
        showlegend: showLegend,
        marker: {
          size: (xIsCat || yIsCat) ? 6 : 5,
          color: PALETTE[i % PALETTE.length],
          opacity: 0.78,
          line: (xIsCat || yIsCat) ? { width: 0.5, color: '#ffffff80' } : undefined,
        },
        hovertemplate: `<b>%{x}</b>, %{y}<extra>${zv}</extra>`,
      });
      i++;
    }
  } else {
    // Single trace, single color.
    traces.push({
      type: wantGl ? 'scattergl' : 'scatter',
      mode: 'markers',
      x: rows.map((d) => d[xKey]),
      y: rows.map((d) => d[yKey]),
      xaxis: xref,
      yaxis: yref,
      name: 'all',
      showlegend: false,
      marker: { size: (xIsCat || yIsCat) ? 6 : 5, color: PALETTE[0], opacity: 0.78 },
      hovertemplate: `<b>%{x}</b>, %{y}<extra></extra>`,
    });
  }
  return traces;
}

// Box plot for one cell.
//
// Standard (Y numeric): vertical boxes, one per X category (or per Z if zField).
// Y categorical:        horizontal boxes (orientation 'h'), one per Y category;
//                       distribution along X (numeric). If zField categorical,
//                       split each Y row by Z (boxmode 'group').
function buildBoxTraces({ rows, xField, yField, zField, axisRef, zCategoryValues, showLegend }) {
  const xKey = xField.name;
  const yKey = yField.name;
  const xref = `x${axisRef}`;
  const yref = `y${axisRef}`;
  const yIsCat = !!yField.isCategorical;
  const traces = [];

  if (yIsCat) {
    // Horizontal box: y is the category, x is the numeric value.
    if (zField && zField.isCategorical) {
      const zKey = zField.name;
      const zVals = zCategoryValues || distinctSortedValues(rows, zKey);
      let i = 0;
      for (const zv of zVals) {
        const grp = rows.filter((r) => r[zKey] === zv);
        traces.push({
          type: 'box',
          orientation: 'h',
          x: grp.map((d) => d[xKey]),
          y: grp.map((d) => d[yKey]),
          xaxis: xref,
          yaxis: yref,
          name: String(zv),
          legendgroup: String(zv),
          showlegend: showLegend,
          marker: { color: PALETTE[i % PALETTE.length] },
          boxpoints: 'outliers',
        });
        i++;
      }
    } else {
      // One horizontal box per Y category.
      const yGroups = groupBy(rows, yKey);
      const ykeys = sortKeys(yGroups.keys());
      let i = 0;
      for (const yk of ykeys) {
        const grp = yGroups.get(yk);
        traces.push({
          type: 'box',
          orientation: 'h',
          x: grp.map((d) => d[xKey]),
          y: grp.map(() => yk),
          xaxis: xref,
          yaxis: yref,
          name: String(yk),
          showlegend: false,
          marker: { color: PALETTE[i % PALETTE.length] },
          boxpoints: 'outliers',
        });
        i++;
      }
    }
    return traces;
  }

  if (zField && zField.isCategorical) {
    const zKey = zField.name;
    const zVals = zCategoryValues || distinctSortedValues(rows, zKey);
    let i = 0;
    for (const zv of zVals) {
      const grp = rows.filter((r) => r[zKey] === zv);
      traces.push({
        type: 'box',
        x: grp.map((d) => d[xKey]),
        y: grp.map((d) => d[yKey]),
        xaxis: xref,
        yaxis: yref,
        name: String(zv),
        legendgroup: String(zv),
        showlegend: showLegend,
        marker: { color: PALETTE[i % PALETTE.length] },
        boxpoints: 'outliers',
      });
      i++;
    }
  } else {
    // Group rows by X value.
    const xGroups = groupBy(rows, xKey);
    const xkeys = sortKeys(xGroups.keys());
    let i = 0;
    for (const xk of xkeys) {
      const grp = xGroups.get(xk);
      traces.push({
        type: 'box',
        x: grp.map(() => xk),
        y: grp.map((d) => d[yKey]),
        xaxis: xref,
        yaxis: yref,
        name: String(xk),
        showlegend: false,
        marker: { color: PALETTE[i % PALETTE.length] },
        boxpoints: 'outliers',
      });
      i++;
    }
  }
  return traces;
}

// Violin plot for one cell. Y categorical → horizontal violin (one per Y).
function buildViolinTraces({ rows, xField, yField, zField, axisRef, zCategoryValues, showLegend }) {
  const xKey = xField.name;
  const yKey = yField.name;
  const xref = `x${axisRef}`;
  const yref = `y${axisRef}`;
  const yIsCat = !!yField.isCategorical;
  const traces = [];

  if (yIsCat) {
    if (zField && zField.isCategorical) {
      const zKey = zField.name;
      const zVals = zCategoryValues || distinctSortedValues(rows, zKey);
      let i = 0;
      for (const zv of zVals) {
        const grp = rows.filter((r) => r[zKey] === zv);
        const c = PALETTE[i % PALETTE.length];
        traces.push({
          type: 'violin',
          orientation: 'h',
          x: grp.map((d) => d[xKey]),
          y: grp.map((d) => d[yKey]),
          xaxis: xref,
          yaxis: yref,
          name: String(zv),
          legendgroup: String(zv),
          showlegend: showLegend,
          box: { visible: true },
          meanline: { visible: true },
          points: 'outliers',
          marker: { color: c, opacity: 0.8 },
          line: { color: c, width: 1 },
          fillcolor: c + '50',
          spanmode: 'soft',
        });
        i++;
      }
    } else {
      const yGroups = groupBy(rows, yKey);
      const ykeys = sortKeys(yGroups.keys());
      let i = 0;
      for (const yk of ykeys) {
        const grp = yGroups.get(yk);
        const c = PALETTE[i % PALETTE.length];
        traces.push({
          type: 'violin',
          orientation: 'h',
          x: grp.map((d) => d[xKey]),
          y: grp.map(() => yk),
          xaxis: xref,
          yaxis: yref,
          name: String(yk),
          showlegend: false,
          box: { visible: true },
          meanline: { visible: true },
          points: 'outliers',
          marker: { color: c, opacity: 0.8 },
          line: { color: c, width: 1 },
          fillcolor: c + '50',
          spanmode: 'soft',
        });
        i++;
      }
    }
    return traces;
  }

  if (zField && zField.isCategorical) {
    const zKey = zField.name;
    const zVals = zCategoryValues || distinctSortedValues(rows, zKey);
    let i = 0;
    for (const zv of zVals) {
      const grp = rows.filter((r) => r[zKey] === zv);
      const c = PALETTE[i % PALETTE.length];
      traces.push({
        type: 'violin',
        x: grp.map((d) => d[xKey]),
        y: grp.map((d) => d[yKey]),
        xaxis: xref,
        yaxis: yref,
        name: String(zv),
        legendgroup: String(zv),
        showlegend: showLegend,
        box: { visible: true },
        meanline: { visible: true },
        points: 'outliers',
        marker: { color: c, opacity: 0.8 },
        line: { color: c, width: 1 },
        fillcolor: c + '50',
        spanmode: 'soft',
      });
      i++;
    }
  } else {
    const xGroups = groupBy(rows, xKey);
    const xkeys = sortKeys(xGroups.keys());
    let i = 0;
    for (const xk of xkeys) {
      const grp = xGroups.get(xk);
      const c = PALETTE[i % PALETTE.length];
      traces.push({
        type: 'violin',
        x: grp.map(() => xk),
        y: grp.map((d) => d[yKey]),
        xaxis: xref,
        yaxis: yref,
        name: String(xk),
        showlegend: false,
        box: { visible: true },
        meanline: { visible: true },
        points: 'outliers',
        marker: { color: c, opacity: 0.8 },
        line: { color: c, width: 1 },
        fillcolor: c + '50',
        spanmode: 'soft',
      });
      i++;
    }
  }
  return traces;
}

// Line plot for one cell. Within each Z group, points are sorted by X.
// If Y is categorical, lines have no real meaning → fall back to markers only.
function buildLineTraces({ rows, xField, yField, zField, axisRef, zCategoryValues, showLegend }) {
  const xKey = xField.name;
  const yKey = yField.name;
  const xref = `x${axisRef}`;
  const yref = `y${axisRef}`;
  const xIsCat = !!xField.isCategorical;
  const yIsCat = !!yField.isCategorical;
  const lineMode = yIsCat ? 'markers' : 'lines+markers';
  const traces = [];

  const sortRows = (arr) => {
    if (xIsCat) return arr.slice();
    return arr.slice().sort((a, b) => {
      const ax = a[xKey], bx = b[xKey];
      if (!isNum(ax)) return 1;
      if (!isNum(bx)) return -1;
      return ax - bx;
    });
  };

  if (zField && zField.isCategorical) {
    const zKey = zField.name;
    const zVals = zCategoryValues || distinctSortedValues(rows, zKey);
    let i = 0;
    for (const zv of zVals) {
      const grp = sortRows(rows.filter((r) => r[zKey] === zv));
      const c = PALETTE[i % PALETTE.length];
      traces.push({
        type: 'scatter',
        mode: lineMode,
        x: grp.map((d) => d[xKey]),
        y: grp.map((d) => d[yKey]),
        xaxis: xref,
        yaxis: yref,
        name: String(zv),
        legendgroup: String(zv),
        showlegend: showLegend,
        line: { color: c, width: 1.4 },
        marker: { color: c, size: yIsCat ? 6 : 5 },
      });
      i++;
    }
  } else {
    const sorted = sortRows(rows);
    traces.push({
      type: 'scatter',
      mode: lineMode,
      x: sorted.map((d) => d[xKey]),
      y: sorted.map((d) => d[yKey]),
      xaxis: xref,
      yaxis: yref,
      name: 'all',
      showlegend: false,
      line: { color: PALETTE[0], width: 1.4 },
      marker: { color: PALETTE[0], size: yIsCat ? 6 : 5 },
    });
  }
  return traces;
}

const BUILDER_MAP = {
  scatter: buildScatterTraces,
  box: buildBoxTraces,
  violin: buildViolinTraces,
  line: buildLineTraces,
};

// Chart types that ignore numeric Z (box/violin/line).
const Z_NUMERIC_UNSUPPORTED = new Set(['box', 'violin', 'line']);

const PERF_GL_THRESHOLD = 50000;

export function UnifiedChartGrid({
  chartType,
  rows,
  xFields,
  yFields,
  zField,
  height = 350,
  width = null,
  onPerformanceWarn,
}) {
  const cols = (xFields || []).length;
  const nRows = (yFields || []).length;

  if (cols === 0 || nRows === 0) {
    return (
      <div style={{ padding: 24, color: 'var(--fg-4)', fontSize: 12 }}>
        请至少选一个 X / Y 字段
      </div>
    );
  }

  const builder = BUILDER_MAP[chartType];
  if (!builder) {
    return (
      <div style={{ padding: 24, color: 'var(--fg-4)', fontSize: 12 }}>
        未知 chartType: {String(chartType)}
      </div>
    );
  }

  // Effective Z: drop numeric Z for chart types that don't support it.
  const effZ = zField && Z_NUMERIC_UNSUPPORTED.has(chartType) && !zField.isCategorical
    ? null
    : zField || null;

  // Performance: warn / disable scattergl when row count is huge.
  const useGl = rows.length < PERF_GL_THRESHOLD;
  if (rows.length >= PERF_GL_THRESHOLD && onPerformanceWarn) {
    onPerformanceWarn({ rowCount: rows.length, threshold: PERF_GL_THRESHOLD });
  }

  // Pre-compute Z categorical values once across the whole dataset, so
  // every cell's traces line up with the shared legend and color palette.
  const zCategoryValues = effZ && effZ.isCategorical
    ? distinctSortedValues(rows, effZ.name)
    : null;

  const allTraces = [];
  const layout = {
    ...baseLayout,
    grid: {
      rows: nRows,
      columns: cols,
      pattern: 'independent',
      xgap: 0.08,
      ygap: 0.12,
      roworder: 'top to bottom',
    },
    margin: { l: 60, r: 80, t: 60, b: 60 },
    height: nRows * height + 100,
    annotations: [],
    showlegend: !!effZ && effZ.isCategorical,
    legend: { orientation: 'h', y: 1.04, x: 0 },
    font: { ...baseLayout.font, size: 11 },
    boxmode: 'group',
    violinmode: 'group',
  };
  if (width) layout.width = width;

  // Cell that owns the shared color/legend artifact: the first cell.
  const COLOR_OWNER_CELL = 1;

  for (let r = 0; r < nRows; r++) {
    const yField = yFields[r];
    for (let c = 0; c < cols; c++) {
      const xField = xFields[c];
      const cellIdx = r * cols + c + 1;
      const sfx = axisSuffix(cellIdx);
      const xAxisKey = `xaxis${sfx}`;
      const yAxisKey = `yaxis${sfx}`;

      const yIsCat = !!yField.isCategorical;

      // X-axis layout for this cell.
      const xLayout = {
        ...baseLayout.xaxis,
        title: { text: axisTitle(xField), font: { size: 11 } },
        tickfont: { size: 10 },
        automargin: true,
      };
      if (xField.isCategorical) {
        const xCats = distinctSortedValues(rows, xField.name);
        xLayout.type = 'category';
        xLayout.categoryorder = 'array';
        xLayout.categoryarray = xCats;
      }
      // Box / violin with numeric Y treat X as category-like (vertical
      // boxes per X bin). If Y is categorical we draw horizontal boxes,
      // so X must stay numeric.
      if (
        (chartType === 'box' || chartType === 'violin')
        && !xField.isCategorical
        && !yIsCat
      ) {
        xLayout.type = 'category';
      }

      layout[xAxisKey] = xLayout;

      const yLayout = {
        ...baseLayout.yaxis,
        title: { text: axisTitle(yField), font: { size: 11 } },
        tickfont: { size: 10 },
        automargin: true,
      };
      if (yIsCat) {
        const yCats = distinctSortedValues(rows, yField.name);
        yLayout.type = 'category';
        yLayout.categoryorder = 'array';
        yLayout.categoryarray = yCats;
      }
      layout[yAxisKey] = yLayout;

      // Sub-plot title.
      layout.annotations.push({
        xref: `x${sfx} domain`,
        yref: `y${sfx} domain`,
        x: 0.5,
        y: 1.08,
        text: `${axisTitle(yField)} vs ${axisTitle(xField)}`,
        showarrow: false,
        font: { size: 12, color: '#334155' },
      });

      const cellTraces = builder({
        rows,
        xField,
        yField,
        zField: effZ,
        axisRef: sfx,
        useGl,
        zCategoryValues,
        showLegend: cellIdx === COLOR_OWNER_CELL,
      });
      allTraces.push(...cellTraces);
    }
  }

  return (
    <Plot
      data={allTraces}
      layout={layout}
      config={baseConfig}
      style={{ width: '100%', height: layout.height }}
      useResizeHandler
    />
  );
}

