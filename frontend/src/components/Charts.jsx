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

const PALETTE = ['#2c79f6', '#0e9488', '#c97a16', '#7b3fe4', '#1e8a5a', '#c2410c', '#0e6bb0', '#b58900'];

export function ScatterPlot({ rows, xKey, yKey, colorKey, xLabel, yLabel, onPointClick }) {
  const groups = new Map();
  rows.forEach((d) => {
    const k = colorKey ? d[colorKey] : '_';
    if (!groups.has(k)) groups.set(k, { x: [], y: [], ids: [] });
    groups.get(k).x.push(d[xKey]);
    groups.get(k).y.push(d[yKey]);
    groups.get(k).ids.push(d);
  });
  const traces = [];
  let i = 0;
  for (const [k, g] of groups) {
    traces.push({
      type: 'scattergl',
      mode: 'markers',
      x: g.x,
      y: g.y,
      name: colorKey ? `${colorKey}=${k}` : 'all',
      marker: { size: 5, color: PALETTE[i % PALETTE.length], opacity: 0.75 },
      customdata: g.ids,
      hovertemplate: `<b>%{x}</b>, %{y}<extra></extra>`,
    });
    i++;
  }
  const layout = {
    ...baseLayout,
    showlegend: !!colorKey,
    xaxis: { ...baseLayout.xaxis, title: xLabel || xKey },
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
      onClick={(e) => {
        if (onPointClick && e.points && e.points[0]) {
          onPointClick(e.points[0].customdata);
        }
      }}
    />
  );
}

export function BoxPlot({ rows, groupKey, valueKey, valueLabel }) {
  const groups = new Map();
  rows.forEach((d) => {
    const k = d[groupKey];
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(d[valueKey]);
  });
  const traces = [];
  let i = 0;
  const sortedKeys = [...groups.keys()].sort((a, b) => (a > b ? 1 : -1));
  for (const k of sortedKeys) {
    traces.push({
      type: 'box',
      y: groups.get(k),
      name: String(k),
      marker: { color: PALETTE[i % PALETTE.length] },
      boxpoints: 'outliers',
    });
    i++;
  }
  const layout = {
    ...baseLayout,
    showlegend: false,
    xaxis: { ...baseLayout.xaxis, title: groupKey },
    yaxis: { ...baseLayout.yaxis, title: valueLabel || valueKey },
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

export function LineChart({ x, y, xLabel, yLabel, name, color, markers = [], series, showLegend }) {
  const traces = series && series.length
    ? series.map((s, i) => ({
        type: 'scatter',
        mode: 'lines',
        x: s.x || x,
        y: s.y,
        name: s.name || `trace ${i + 1}`,
        connectgaps: false,
        line: {
          color: s.color || PALETTE[i % PALETTE.length],
          width: s.width != null ? s.width : 1.4,
          dash: s.dash || 'solid',
        },
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
    type: 'line',
    x0: m.x,
    x1: m.x,
    yref: 'paper',
    y0: 0,
    y1: 1,
    line: { color: m.color || '#c97a16', width: 1, dash: 'dash' },
  }));
  const annotations = markers.map((m) => ({
    x: m.x,
    yref: 'paper',
    y: 1,
    text: m.label || '',
    showarrow: false,
    font: { color: m.color || '#c97a16', size: 10 },
    bgcolor: '#fff',
  }));
  const layout = {
    ...baseLayout,
    showlegend: !!showLegend,
    legend: { orientation: 'h', y: 1.08, x: 0 },
    xaxis: { ...baseLayout.xaxis, title: xLabel || 'x' },
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
