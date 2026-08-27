import { useId, useMemo } from 'react';
import { motion } from 'framer-motion';

export interface MiniChartProps {
  data: number[];
  type: 'bar' | 'line' | 'ring';
  width?: number;
  height?: number;
  color?: string;
  className?: string;
}

function MiniBar({
  data,
  width = 48,
  height = 24,
  color,
}: {
  data: number[];
  width: number;
  height: number;
  color?: string;
}) {
  const maxVal = Math.max(...data, 1);
  const barWidth = Math.max(2, (width / data.length) - 1);
  const strokeColor = color || 'var(--primary)';

  return (
    <div className="flex items-end gap-[1px]" style={{ width, height }}>
      {data.map((v, i) => (
        <motion.div
          key={i}
          initial={{ height: 0 }}
          animate={{ height: `${(v / maxVal) * 100}%` }}
          transition={{ duration: 0.4, delay: i * 0.03, ease: [0.16, 1, 0.3, 1] }}
          className="flex-1 rounded-t-[1px]"
          style={{
            background: strokeColor,
            minHeight: 1,
            maxWidth: barWidth,
          }}
        />
      ))}
    </div>
  );
}

function MiniLine({
  data,
  width = 48,
  height = 24,
  color,
}: {
  data: number[];
  width: number;
  height: number;
  color?: string;
}) {
  const strokeColor = color || 'var(--primary)';

  const path = useMemo(() => {
    if (data.length < 2) return '';
    const minVal = Math.min(...data);
    const maxVal = Math.max(...data);
    const range = maxVal - minVal || 1;

    const pts = data.map((v, i) => {
      const x = (i / (data.length - 1)) * width;
      const y = 2 + (1 - (v - minVal) / range) * (height - 4);
      return [x, y];
    });

    let d = `M${pts[0][0]},${pts[0][1]}`;
    for (let i = 1; i < pts.length; i++) {
      const prev = pts[i - 1];
      const curr = pts[i];
      const cpx = (prev[0] + curr[0]) / 2;
      d += ` C${cpx},${prev[1]} ${cpx},${curr[1]} ${curr[0]},${curr[1]}`;
    }
    return d;
  }, [data, width, height]);

  const areaPath = path ? `${path} L${width},${height} L0,${height} Z` : '';
  const gradId = useId();

  if (data.length < 2) return <div style={{ width, height }} />;

  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
      <defs>
        <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={strokeColor} stopOpacity={0.15} />
          <stop offset="100%" stopColor={strokeColor} stopOpacity={0} />
        </linearGradient>
      </defs>
      <path d={areaPath} fill={`url(#${gradId})`} />
      <path d={path} fill="none" stroke={strokeColor} strokeWidth={1.5} strokeLinecap="round" />
    </svg>
  );
}

function MiniRing({
  data,
  size = 32,
  color,
}: {
  data: number[];
  size: number;
  height: number;
  color?: string;
}) {
  const strokeColor = color || 'var(--primary)';
  const strokeWidth = 3;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const total = data.reduce((a, b) => a + b, 0);
  const firstVal = data[0] ?? 0;
  const percentage = total > 0 ? firstVal / total : 0;
  const dashLength = percentage * circumference;

  return (
    <svg width={size} height={size} className="transform -rotate-90">
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        stroke="var(--surface-2)"
        strokeWidth={strokeWidth}
      />
      <motion.circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        stroke={strokeColor}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeDasharray={`${dashLength} ${circumference - dashLength}`}
        initial={{ strokeDasharray: `0 ${circumference}` }}
        animate={{ strokeDasharray: `${dashLength} ${circumference - dashLength}` }}
        transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
      />
    </svg>
  );
}

export function MiniChart({
  data,
  type,
  width,
  height,
  color,
  className = '',
}: MiniChartProps) {
  const defaultWidth = type === 'ring' ? 32 : 48;
  const defaultHeight = type === 'ring' ? 32 : 24;
  const w = width ?? defaultWidth;
  const h = height ?? defaultHeight;

  return (
    <div className={`inline-flex items-center ${className}`}>
      {type === 'bar' && <MiniBar data={data} width={w} height={h} color={color} />}
      {type === 'line' && <MiniLine data={data} width={w} height={h} color={color} />}
      {type === 'ring' && <MiniRing data={data} size={w} height={h} color={color} />}
    </div>
  );
}
