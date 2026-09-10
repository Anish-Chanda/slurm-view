import { arc, hierarchy, partition } from 'd3';
import type { HierarchyRectangularNode } from 'd3';
import { useMemo } from 'react';
import type { ChartDatum, ChartModel } from './chart-data.ts';

const RADIUS = 200;
const LABEL_FONT_SIZE = 8;
// Font sizes stay numerically the same after the scale change on purpose:
// at RADIUS 100 the 200-unit viewBox was stretched ~2x to fill ~420px CSS,
// inflating 8-unit labels to ~17px visually. At RADIUS 200 the 400-unit
// viewBox renders near 1:1, so 8-unit labels read as 8px as intended.
// Average glyph width for the sans-serif label font, as a fraction of the
// font size. A conservative estimate: real rendering varies by browser and
// characters, so unit tests pin the decision algorithm (not pixels) and a
// manual/browser pass with hostile cases (long GPU names, tiny slices,
// large totals) is required for visual confidence. JSDOM cannot prove
// non-overflow.
const GLYPH_WIDTH_RATIO = 0.6;
// Breathing room subtracted from the radial band before fitting text, so
// labels never touch the ring edges (~8px visual at 1:1 display scale).
const LABEL_RADIAL_PADDING = 8;

const CENTER_TITLE_FONT_SIZE = 9;
const CENTER_TOTAL_BASE_FONT_SIZE = 11;
const CENTER_TOTAL_MIN_FONT_SIZE = 7;

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
}

// Whether an inline arc label fits. Labels are rendered radially (along
// the radius via the rotate/translate transform), so the estimated text
// width must fit inside the radial band thickness — not the angular arc
// length — while the text height must fit the angular space. Sectors that
// fail either check omit the label and rely on the <title> tooltip.
function shouldShowLabel(name: string, fit: LabelFit): boolean {
  if (name.length === 0) return false;
  const estimatedTextWidth = name.length * LABEL_FONT_SIZE * GLYPH_WIDTH_RATIO;
  const estimatedTextHeight = LABEL_FONT_SIZE;
  const arcSpace = fit.arcSpanRadians * fit.midRadius;
  return (
    estimatedTextWidth <= fit.radialThickness - LABEL_RADIAL_PADDING &&
    estimatedTextHeight <= arcSpace
  );
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
      if (
        shouldShowLabel(node.data.name, {
          arcSpanRadians: node.x1 - node.x0,
          midRadius,
          radialThickness: (node.y1 - node.y0) * RADIUS,
        })
      ) {
        const degrees = (midAngle * 180) / Math.PI;
        renderedLabels.push({
          key,
          text: node.data.name,
          transform: `rotate(${degrees - 90}) translate(${midRadius},0) rotate(${degrees < 180 ? 0 : 180})`,
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
      className="h-auto w-full max-w-[420px]"
    >
      <text textAnchor="middle" dy="-0.4em" fontSize={CENTER_TITLE_FONT_SIZE} fill="currentColor" opacity="0.7">
        {center.title}
      </text>
      <text textAnchor="middle" dy="1em" fontSize={totalFontSize} fontWeight="bold">
        {center.total}
      </text>
      <g fillOpacity="0.6">
        {segments.map((segment) => (
          <path key={segment.key} d={segment.path} fill={segment.fill}>
            <title>{segment.tooltip}</title>
          </path>
        ))}
      </g>
      <g pointerEvents="none" textAnchor="middle" fontSize={LABEL_FONT_SIZE} fontFamily="sans-serif">
        {labels.map((label) => (
          <text key={label.key} transform={label.transform} dy="0.35em">
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
  LABEL_FONT_SIZE,
  LABEL_RADIAL_PADDING,
  centerTotalFontSize,
  layoutSunburst,
  shouldShowLabel,
  Sunburst,
};
export type { LabelFit, SunburstCenter, SunburstNode };
