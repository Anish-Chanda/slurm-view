import { arc, hierarchy, partition } from 'd3';
import type { HierarchyRectangularNode } from 'd3';
import { useMemo } from 'react';
import type { ChartDatum, ChartModel } from './chart-data.ts';

const RADIUS = 200;
// Ring-label sizes by hierarchy depth at the RADIUS=200 internal scale
// (~1:1 with CSS pixels at typical card widths): primary/inner labels are
// larger for scannability, secondary/outer labels smaller but readable.
const PRIMARY_LABEL_DESIRED_SIZE = 13;
const PRIMARY_LABEL_MIN_SIZE = 10;
const SECONDARY_LABEL_DESIRED_SIZE = 11;
const SECONDARY_LABEL_MIN_SIZE = 9;
// Average glyph width for the sans-serif label font, as a fraction of the
// font size. A conservative estimate: real rendering varies by browser and
// characters, so unit tests pin the decision algorithm (not pixels) and a
// manual/browser pass with hostile cases (long GPU names, tiny slices,
// large totals) is required for visual confidence. JSDOM cannot prove
// non-overflow.
const GLYPH_WIDTH_RATIO = 0.6;
// Breathing room subtracted from the radial band before fitting text, so
// labels never touch the ring edges (~6px visual at 1:1 display scale).
const LABEL_RADIAL_PADDING = 6;

const CENTER_TITLE_FONT_SIZE = 14;
const CENTER_TOTAL_BASE_FONT_SIZE = 20;
const CENTER_TOTAL_MIN_FONT_SIZE = 12;

// Label text color: near-black for legibility against the translucent
// semantic slice fills. Slice colors themselves are untouched.
const CHART_TEXT_FILL = '#111827';

function labelDesiredSizeForDepth(depth: number): number {
  return depth <= 1 ? PRIMARY_LABEL_DESIRED_SIZE : SECONDARY_LABEL_DESIRED_SIZE;
}

function labelMinSizeForDepth(depth: number): number {
  return depth <= 1 ? PRIMARY_LABEL_MIN_SIZE : SECONDARY_LABEL_MIN_SIZE;
}

type SunburstNode = HierarchyRectangularNode<ChartDatum>;

// Only leaves contribute values: internal nodes carry a display total that
// their children already cover, and summing both would double-count.
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
  // Bounded shrink-to-fit budget for this node's depth: start at the
  // desired size, shrink only as far as the minimum.
  desiredSize: number;
  minimumSize: number;
}

// Resolve the render size for an inline arc label, or null when it should
// be omitted (the sector keeps its <title> tooltip). Labels are rendered
// radially, so the radial band thickness bounds the text width while the
// angular space bounds the text height. Short labels keep the full desired
// size; longer ones shrink modestly but never below the readable minimum
// and never overflowing just to stay visible.
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

// Deterministic shrink-to-fit for the center total line: scales the font
// down from the base size when the estimated text width exceeds the
// available center-hole width, never below the minimum. Pure estimate, no
// browser font metrics or layout involved.
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

// React owns the SVG; D3 only computes hierarchy, layout, and arc paths.
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
      // Zero-value groups subtend no angle; d3 emits a degenerate line
      // path for them, so skip the segment entirely rather than drawing
      // an invisible path.
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
