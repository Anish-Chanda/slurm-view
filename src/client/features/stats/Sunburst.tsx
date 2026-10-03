import { arc, hierarchy, partition } from 'd3';
import type { HierarchyRectangularNode } from 'd3';
import { useMemo } from 'react';
import type { ChartDatum, ChartModel } from './chart-data.ts';

const RADIUS = 200;
// Inner labels use a larger size than outer labels at the 200-unit chart scale.
const PRIMARY_LABEL_DESIRED_SIZE = 13;
const PRIMARY_LABEL_MIN_SIZE = 10;
const SECONDARY_LABEL_DESIRED_SIZE = 11;
const SECONDARY_LABEL_MIN_SIZE = 9;
// Approximate average glyph width as a fraction of font size.
const GLYPH_WIDTH_RATIO = 0.6;
// Leave space between labels and ring edges when fitting text.
const LABEL_RADIAL_PADDING = 6;

const CENTER_TITLE_FONT_SIZE = 14;
const CENTER_TOTAL_BASE_FONT_SIZE = 20;
const CENTER_TOTAL_MIN_FONT_SIZE = 12;

// Near-black labels remain legible against translucent slice fills.
const CHART_TEXT_FILL = '#111827';

function labelDesiredSizeForDepth(depth: number): number {
  return depth <= 1 ? PRIMARY_LABEL_DESIRED_SIZE : SECONDARY_LABEL_DESIRED_SIZE;
}

function labelMinSizeForDepth(depth: number): number {
  return depth <= 1 ? PRIMARY_LABEL_MIN_SIZE : SECONDARY_LABEL_MIN_SIZE;
}

type SunburstNode = HierarchyRectangularNode<ChartDatum>;

// Internal totals are display values already represented by their leaves.
function layoutSunburst(model: ChartModel): SunburstNode {
  const root = hierarchy<ChartDatum>(model, (datum) => datum.children).sum((datum) =>
    datum.children !== undefined && datum.children.length > 0 ? 0 : datum.value ?? 0,
  );
  return partition<ChartDatum>().size([2 * Math.PI, 1])(root);
}

interface LabelFit {
  arcSpanRadians: number;
  midRadius: number;
  radialThickness: number;
  // Shrink from the desired size without crossing the minimum for this depth.
  desiredSize: number;
  minimumSize: number;
}

// Return a font size that fits the arc, or null when the label is too large.
function resolveLabelFontSize(name: string, fit: LabelFit): number | null {
  if (name.length === 0) return null;
  const maxRadialFontSize =
    (fit.radialThickness - LABEL_RADIAL_PADDING) / (name.length * GLYPH_WIDTH_RATIO);
  const candidate = Math.min(fit.desiredSize, maxRadialFontSize);
  const arcSpace = fit.arcSpanRadians * fit.midRadius;
  if (candidate < fit.minimumSize) return null;
  if (candidate > arcSpace) return null;
  return Math.floor(candidate * 10) / 10;
}

// Estimate a center-total font size from available width without browser
// font metrics.
function centerTotalFontSize(total: string, holeWidth: number): number {
  if (total.length === 0 || holeWidth <= 0) return CENTER_TOTAL_BASE_FONT_SIZE;
  const estimated = total.length * CENTER_TOTAL_BASE_FONT_SIZE * GLYPH_WIDTH_RATIO;
  if (estimated <= holeWidth) return CENTER_TOTAL_BASE_FONT_SIZE;
  const scaled = (holeWidth / estimated) * CENTER_TOTAL_BASE_FONT_SIZE;
  return Math.max(CENTER_TOTAL_MIN_FONT_SIZE, Math.round(scaled * 10) / 10);
}

interface RenderedSegment {
  key: string;
  path: string;
  fill: string;
  tooltip: string;
}

interface RenderedLabel {
  key: string;
  text: string;
  transform: string;
  fontSize: number;
  depth: number;
}

function nodeKey(node: SunburstNode): string {
  return node
    .ancestors()
    .map((ancestor) => ancestor.data.name)
    .reverse()
    .join('/');
}

interface SunburstCenter {
  title: string;
  total: string;
}

interface SunburstProps {
  model: ChartModel;
  center: SunburstCenter;
  ariaLabel: string;
  colorFor: (node: SunburstNode) => string;
}

// React renders the SVG; D3 computes the hierarchy, layout, and arc paths.
function Sunburst({ model, center, ariaLabel, colorFor }: SunburstProps) {
  const { segments, labels, totalFontSize } = useMemo(() => {
    const laidOut = layoutSunburst(model);

    const arcGenerator = arc<SunburstNode>()
      .startAngle((node) => node.x0)
      .endAngle((node) => node.x1)
      .padAngle((node) => Math.min((node.x1 - node.x0) / 2, 0.005))
      .innerRadius((node) => node.y0 * RADIUS)
      .outerRadius((node) => Math.max(node.y0 * RADIUS, node.y1 * RADIUS - 1));

    const renderedSegments: RenderedSegment[] = [];
    const renderedLabels: RenderedLabel[] = [];
    let holeWidth = 2 * RADIUS;
    for (const node of laidOut.descendants()) {
      if (node.depth === 0) continue;
      // Skip zero-value groups; D3 gives them degenerate paths.
      if ((node.value ?? 0) <= 0) continue;
      if (node.depth === 1) {
        holeWidth = Math.min(holeWidth, 2 * node.y0 * RADIUS);
      }
      const path = arcGenerator(node) ?? '';
      if (path === '') continue;
      const key = nodeKey(node);
      renderedSegments.push({
        key,
        path,
        fill: colorFor(node),
        tooltip: `${key}\n${Math.round(node.value ?? 0).toLocaleString()}`,
      });
      const midAngle = (node.x0 + node.x1) / 2;
      const midRadius = ((node.y0 + node.y1) / 2) * RADIUS;
      const labelFontSize = resolveLabelFontSize(node.data.name, {
        arcSpanRadians: node.x1 - node.x0,
        midRadius,
        radialThickness: (node.y1 - node.y0) * RADIUS,
        desiredSize: labelDesiredSizeForDepth(node.depth),
        minimumSize: labelMinSizeForDepth(node.depth),
      });
      if (labelFontSize !== null) {
        const degrees = (midAngle * 180) / Math.PI;
        renderedLabels.push({
          key,
          text: node.data.name,
          transform: `rotate(${degrees - 90}) translate(${midRadius},0) rotate(${degrees < 180 ? 0 : 180})`,
          fontSize: labelFontSize,
          depth: node.depth,
        });
      }
    }
    return {
      segments: renderedSegments,
      labels: renderedLabels,
      totalFontSize: centerTotalFontSize(center.total, holeWidth),
    };
  }, [model, colorFor, center.total]);

  return (
    <svg
      viewBox={`${-RADIUS} ${-RADIUS} ${RADIUS * 2} ${RADIUS * 2}`}
      role="img"
      aria-label={ariaLabel}
      className="mx-auto h-auto w-full max-w-[340px]"
    >
      <text textAnchor="middle" dy="-0.4em" fontSize={CENTER_TITLE_FONT_SIZE} fontWeight={600} fill="currentColor" opacity="0.85">
        {center.title}
      </text>
      <text textAnchor="middle" dy="1em" fontSize={totalFontSize} fontWeight="bold" fill={CHART_TEXT_FILL}>
        {center.total}
      </text>
      <g fillOpacity="0.6">
        {segments.map((segment) => (
          <path key={segment.key} d={segment.path} fill={segment.fill}>
            <title>{segment.tooltip}</title>
          </path>
        ))}
      </g>
      <g pointerEvents="none" textAnchor="middle" fontFamily="sans-serif" fill={CHART_TEXT_FILL}>
        {labels.map((label) => (
          <text
            key={label.key}
            transform={label.transform}
            dy="0.35em"
            fontSize={label.fontSize}
            fontWeight={label.depth <= 1 ? 600 : 400}
          >
            {label.text}
          </text>
        ))}
      </g>
    </svg>
  );
}

export {
  CENTER_TITLE_FONT_SIZE,
  CENTER_TOTAL_BASE_FONT_SIZE,
  CENTER_TOTAL_MIN_FONT_SIZE,
  LABEL_RADIAL_PADDING,
  PRIMARY_LABEL_DESIRED_SIZE,
  PRIMARY_LABEL_MIN_SIZE,
  SECONDARY_LABEL_DESIRED_SIZE,
  SECONDARY_LABEL_MIN_SIZE,
  centerTotalFontSize,
  labelDesiredSizeForDepth,
  labelMinSizeForDepth,
  layoutSunburst,
  resolveLabelFontSize,
  Sunburst,
};
export type { LabelFit, SunburstCenter, SunburstNode };
