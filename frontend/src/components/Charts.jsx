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
