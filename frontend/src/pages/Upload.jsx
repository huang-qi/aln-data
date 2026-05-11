import React, { useEffect, useRef, useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import I from '../components/Icons.jsx';
import { listMappings, uploadBatch } from '../api/endpoints.js';
import useSSE from '../hooks/useSSE.js';

export default function Upload() {
  const [mappings, setMappings] = useState([]);
  const [mappingId, setMappingId] = useState('');
  const [file, setFile] = useState(null);
  const [fStart, setFStart] = useState('');
  const [fEnd, setFEnd] = useState('');
  const [processType, setProcessType] = useState('BOTH');
  const [deembed, setDeembed] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [taskInfo, setTaskInfo] = useState(null);
  const [submitError, setSubmitError] = useState(null);
  const [uploadPct, setUploadPct] = useState(0);
  const inputRef = useRef(null);
  const navigate = useNavigate();

  useEffect(() => {
    listMappings()
      .then((data) => {
        const list = Array.isArray(data) ? data : data?.items || [];
        setMappings(list);
        if (list.length && !mappingId) setMappingId(String(list[0].id));
      })
      .catch(() => setMappings([]));
  }, []);

  const sse = useSSE(taskInfo?.task_id, { enabled: !!taskInfo });

  useEffect(() => {
    if (sse.done && sse.status === 'success' && taskInfo?.batch_no) {
      const t = setTimeout(() => navigate(`/batches/${encodeURIComponent(taskInfo.batch_no)}`), 1500);
      return () => clearTimeout(t);
    }
  }, [sse.done, sse.status, taskInfo, navigate]);

  const onPickFile = (f) => {
    if (!f) return;
    if (!f.name.toLowerCase().endsWith('.zip')) {
      setSubmitError('仅支持 .zip 文件');
      return;
    }
    if (f.size === 0) {
      setSubmitError('文件为空（0 字节），无法上传');
      return;
    }
    setSubmitError(null);
    setFile(f);
  };

  const submit = async () => {
    setSubmitError(null);
    if (!file) {
      setSubmitError('请选择 zip 文件');
      return;
    }
    if (!mappingId) {
      setSubmitError('请选择对照表（如果列表为空，先到 /mappings 上传）');
      return;
    }
    const fd = new FormData();
    fd.append('file', file);
    fd.append('mapping_id', mappingId);
    if (fStart) fd.append('f_start_ghz', fStart);
    if (fEnd) fd.append('f_end_ghz', fEnd);
    fd.append('process_type', processType);
    fd.append('deembed', deembed ? 'true' : 'false');

    setSubmitting(true);
    setUploadPct(0);
    try {
      const res = await uploadBatch(fd, (p) => {
        if (p.total) setUploadPct(Math.round((p.loaded / p.total) * 100));
      });
      setTaskInfo(res);
    } catch (e) {
      setSubmitError(e.message);
    } finally {
      setSubmitting(false);
    }
  };

  const reset = () => {
    setTaskInfo(null);
    setFile(null);
    setUploadPct(0);
    setSubmitError(null);
    if (inputRef.current) inputRef.current.value = '';
  };

  return (
    <>
      <div className="toolbar">
        <span className="crumb">
          谐振器 <span style={{ color: 'var(--fg-4)' }}>›</span> <b>上传新批次</b>
        </span>
        <div className="spacer" />
        {mappings.length === 0 && (
          <Link to="/mappings" className="btn">
            <I.table size={13} /> 先去添加对照表
          </Link>
        )}
      </div>

      <div
        style={{
          flex: 1,
          overflow: 'auto',
          padding: 18,
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: 14,
          alignContent: 'start',
          maxWidth: 1280,
          margin: '0 auto',
        }}
      >
        <div className="chart-card" style={{ margin: 0 }}>
          <div className="chart-head">
            <span className="title">① 数据包</span>
            <span className="axes">.zip · 文件名（去扩展）即批次号</span>
          </div>
          <div style={{ padding: 14 }}>
            {file ? (
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 12,
                  padding: 14,
                  border: '1px solid var(--border)',
                  background: 'var(--bg-panel-2)',
                  borderRadius: 4,
                }}
              >
                <div
                  style={{
                    width: 40,
                    height: 40,
                    display: 'grid',
                    placeItems: 'center',
                    background: 'var(--primary-soft)',
                    borderRadius: 4,
                    color: 'var(--primary)',
                  }}
                >
                  <I.zip size={20} />
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--fg-1)' }}>{file.name}</div>
                  <div className="mono dim" style={{ fontSize: 11 }}>
                    {(file.size / 1024 / 1024).toFixed(1)} MB
                  </div>
                </div>
                <button className="btn sm danger" onClick={() => setFile(null)} disabled={submitting || taskInfo}>
                  <I.trash size={12} />
                </button>
              </div>
            ) : (
              <label
                style={{
                  display: 'block',
                  border: '2px dashed var(--border-strong)',
                  borderRadius: 4,
                  padding: '32px 16px',
                  textAlign: 'center',
                  background: 'var(--bg-panel-2)',
                  cursor: 'pointer',
                }}
              >
                <input
                  ref={inputRef}
                  type="file"
                  accept=".zip"
                  style={{ display: 'none' }}
                  onChange={(e) => onPickFile(e.target.files?.[0])}
                />
                <I.upload size={28} stroke="var(--fg-4)" />
                <div style={{ fontSize: 13, color: 'var(--fg-2)', margin: '8px 0 4px' }}>点击选择 .zip</div>
                <div className="dim mono" style={{ fontSize: 10.5 }}>
                  解压后文件夹名作为批次号
                </div>
              </label>
            )}
          </div>
        </div>

        <div className="chart-card" style={{ margin: 0 }}>
          <div className="chart-head">
            <span className="title">② 处理选项</span>
          </div>
          <div style={{ padding: 14 }}>
            <div className="field">
              <div className="field-label">
                <span>对照表 mapping</span>
                <span className="hint">必填</span>
              </div>
              <select
                className="select"
                style={{ width: '100%' }}
                value={mappingId}
                onChange={(e) => setMappingId(e.target.value)}
                disabled={submitting || taskInfo}
              >
                {mappings.length === 0 && <option value="">（无对照表，请先上传）</option>}
                {mappings.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name} ({m.entry_count} entries)
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <div className="field-label">
                <span>频率范围 (GHz)</span>
                <span className="hint">留空 = 全频段</span>
              </div>
              <div className="row-flex">
                <input
                  className="input mono"
                  placeholder="14.0"
                  value={fStart}
                  onChange={(e) => setFStart(e.target.value)}
                  style={{ flex: 1 }}
                  disabled={submitting || taskInfo}
                />
                <span className="dim">—</span>
                <input
                  className="input mono"
                  placeholder="16.0"
                  value={fEnd}
                  onChange={(e) => setFEnd(e.target.value)}
                  style={{ flex: 1 }}
                  disabled={submitting || taskInfo}
                />
              </div>
            </div>
            <div className="field">
              <div className="field-label">
                <span>处理类型</span>
              </div>
              <div className="proc-seg" style={{ width: '100%' }}>
                {['S2P', 'S1P', 'BOTH'].map((t) => (
                  <button
                    key={t}
                    type="button"
                    className={`proc-seg-btn${processType === t ? ' active' : ''}`}
                    onClick={() => setProcessType(t)}
                    disabled={submitting || !!taskInfo}
                  >
                    {t}
                  </button>
                ))}
              </div>
            </div>
            <div className="field">
              <label
                style={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: 8,
                  cursor: submitting || taskInfo ? 'default' : 'pointer',
                  opacity: submitting || taskInfo ? 0.6 : 1,
                }}
              >
                <input
                  type="checkbox"
                  data-testid="deembed-toggle"
                  checked={deembed}
                  onChange={(e) => setDeembed(e.target.checked)}
                  disabled={submitting || !!taskInfo}
                  style={{ marginTop: 2 }}
                />
                <span>
                  <div style={{ fontSize: 13, color: 'var(--fg-1)' }}>
                    De-embed (ShortOpen 校准)
                  </div>
                  <div className="dim" style={{ fontSize: 11, marginTop: 2 }}>
                    需 zip 内含 OPEN / SHORT 校准 .s2p。开启后处理速度变慢；缺校准件会任务失败。
                  </div>
                </span>
              </label>
            </div>
          </div>
        </div>

        <div style={{ gridColumn: '1 / -1', display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          {submitError && (
            <div style={{ flex: 1, color: 'var(--fail)', fontSize: 12, alignSelf: 'center' }}>
              <I.alert size={12} /> {submitError}
            </div>
          )}
          {taskInfo ? (
            <button className="btn" onClick={reset}>
              重新开始
            </button>
          ) : (
            <button className="btn primary" onClick={submit} disabled={submitting || !file || !mappingId}>
              <I.play size={11} /> {submitting ? `上传中 ${uploadPct}%` : '启动入库'}
            </button>
          )}
        </div>

        {taskInfo && (
          <div style={{ gridColumn: '1 / -1' }} className="chart-card">
            <div className="chart-head">
              <span className="title">④ 处理中 · {taskInfo.batch_no}</span>
              <span className="axes">task_id: {taskInfo.task_id}</span>
              <div className="right">
                <span
                  className={`badge ${
                    sse.status === 'success' ? 'done' : sse.status === 'error' ? 'err' : 'run'
                  }`}
                >
                  {(sse.status || 'pending').toUpperCase()}
                </span>
                <Link to={`/tasks/${taskInfo.task_id}`} className="btn ghost sm" style={{ textDecoration: 'none' }}>
                  详情 ›
                </Link>
              </div>
            </div>
            <div style={{ padding: 14 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                <div
                  style={{
                    flex: 1,
                    height: 8,
                    background: 'var(--bg-panel-2)',
                    border: '1px solid var(--border)',
                    borderRadius: 3,
                    overflow: 'hidden',
                  }}
                >
                  <div
                    style={{
                      width: `${sse.progress}%`,
                      height: '100%',
                      background:
                        sse.status === 'error'
                          ? 'var(--fail)'
                          : sse.status === 'success'
                          ? 'var(--pass)'
                          : 'var(--primary)',
                      transition: 'width 0.3s',
                    }}
                  />
                </div>
                <span className="mono" style={{ width: 56, textAlign: 'right' }}>
                  {sse.progress}%
                </span>
              </div>
              <div className="mono dim" style={{ fontSize: 12 }}>
                {sse.message || '等待 worker...'}
              </div>
              {sse.error && (
                <div
                  style={{
                    marginTop: 10,
                    padding: 10,
                    background: 'var(--fail-soft)',
                    border: '1px solid var(--fail)',
                    borderRadius: 4,
                    color: 'var(--fail)',
                  }}
                >
                  <I.alert size={12} /> {sse.error}
                </div>
              )}
              {sse.done && sse.status === 'success' && (
                <div style={{ marginTop: 10, color: 'var(--pass)', fontSize: 12 }}>
                  <I.check size={12} /> 完成，即将跳转到批次详情...
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </>
  );
}
