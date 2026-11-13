import { ChevronDown, Maximize2, X, ZoomIn, ZoomOut } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import { zoomLevels } from './zoomLevels';

type ViewControlsProps = {
  label: string;
  scale: number;
  disabled?: boolean;
  canZoomIn?: boolean;
  canZoomOut?: boolean;
  onZoomIn(): void;
  onZoomOut(): void;
  onSelectScale(scale: number): void;
  onFitWidth?(): void;
  onFitPage?(): void;
};

export function ViewControls({
  label,
  scale,
  disabled,
  canZoomIn = true,
  canZoomOut = true,
  onZoomIn,
  onZoomOut,
  onSelectScale,
  onFitWidth,
  onFitPage,
}: ViewControlsProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const panelId = useId();
  const scaleLabel = `${Math.round(scale * 100)}%`;
  const closePanel = () => {
    setOpen(false);
    triggerRef.current?.focus();
  };

  useEffect(() => {
    if (!open) return;

    panelRef.current?.focus();
    const handlePointerDown = (event: PointerEvent) => {
      if (event.target instanceof Node && !containerRef.current?.contains(event.target)) {
        setOpen(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        setOpen(false);
        triggerRef.current?.focus();
      }
    };
    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [open]);

  return (
    <div className="view-controls" ref={containerRef}>
      <button type="button" className="home-status-icon-button" aria-label="Zoom out" title="缩小"
        disabled={disabled || !canZoomOut} onClick={onZoomOut}>
        <ZoomOut size={15} aria-hidden="true" />
      </button>
      <button
        ref={triggerRef}
        type="button"
        className="home-view-scale"
        aria-label={`打开${label}视图控制，当前缩放 ${scaleLabel}`}
        aria-expanded={open}
        aria-controls={panelId}
        aria-haspopup="dialog"
        onClick={() => setOpen((value) => !value)}
      >
        <span>{scaleLabel}</span>
        <ChevronDown size={14} aria-hidden="true" />
      </button>
      <button
        type="button"
        className="home-status-icon-button"
        aria-label="Zoom in"
        title="放大"
        disabled={disabled || !canZoomIn}
        onClick={onZoomIn}
      >
        <ZoomIn size={15} aria-hidden="true" />
      </button>
      {open ? (
        <div
          id={panelId}
          ref={panelRef}
          className="view-controls-panel"
          role="dialog"
          aria-label={`${label}视图控制`}
          tabIndex={-1}
        >
          <div className="assist-card-heading">
            <strong>{label}视图控制</strong>
            <button
              type="button"
              className="icon-button"
              aria-label="关闭视图控制"
              onClick={closePanel}
            >
              <X size={14} />
            </button>
          </div>
          <div className="view-controls-presets" role="group" aria-label="常用缩放比例">
            {zoomLevels.map((level) => (
              <button key={level} type="button" disabled={disabled} aria-pressed={scale === level}
                onClick={() => { onSelectScale(level); closePanel(); }}>
                {Math.round(level * 100)}%
              </button>
            ))}
          </div>
          {onFitWidth || onFitPage ? (
            <div className="view-controls-actions">
              {onFitWidth ? <button type="button" aria-label="Fit width" disabled={disabled} onClick={onFitWidth}>适合宽度</button> : null}
              {onFitPage ? <button type="button" aria-label="Fit page" disabled={disabled} onClick={onFitPage}><Maximize2 size={14} />适合整页</button> : null}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
