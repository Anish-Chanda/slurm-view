import { arc, hierarchy, partition } from 'd3';
import type { HierarchyRectangularNode } from 'd3';
import { useMemo } from 'react';
import type { ChartDatum, ChartModel } from './chart-data.ts';

const RADIUS = 100;

type SunburstNode = HierarchyRectangularNode<ChartDatum>;

// Only leaves contribute values: internal nodes carry a display total that
// their children already cover, and summing both would double-count.
function layoutSunburst(model: ChartModel): SunburstNode {
  const root = hierarchy<ChartDatum>(model, (datum) => datum.children).sum((datum) =>
    datum.children !== undefined && datum.children.length > 0 ? 0 : datum.value ?? 0,
  );
  return partition<ChartDatum>().size([2 * Math.PI, 1])(root);
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

interface SunburstProps {
  model: ChartModel;
  centerText: string;
  ariaLabel: string;
  colorFor: (node: SunburstNode) => string;
}

// React owns the SVG; D3 only computes hierarchy, layout, and arc paths.
function Sunburst({ model, centerText, ariaLabel, colorFor }: SunburstProps) {
  const { segments, labels } = useMemo(() => {
    const laidOut = layoutSunburst(model);

    const arcGenerator = arc<SunburstNode>()
      .startAngle((node) => node.x0)
      .endAngle((node) => node.x1)
      .padAngle((node) => Math.min((node.x1 - node.x0) / 2, 0.005))
      .innerRadius((node) => node.y0 * RADIUS)
      .outerRadius((node) => Math.max(node.y0 * RADIUS, node.y1 * RADIUS - 1));

    const renderedSegments: RenderedSegment[] = [];
    const renderedLabels: RenderedLabel[] = [];
    for (const node of laidOut.descendants()) {
      if (node.depth === 0) continue;
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
      if ((node.x1 - node.x0) * midRadius > 12) {
        const degrees = (midAngle * 180) / Math.PI;
        renderedLabels.push({
          key,
          text: node.data.name,
          transform: `rotate(${degrees - 90}) translate(${midRadius},0) rotate(${degrees < 180 ? 0 : 180})`,
        });
      }
    }
    return { segments: renderedSegments, labels: renderedLabels };
  }, [model, colorFor]);

  return (
    <svg
      viewBox={`${-RADIUS} ${-RADIUS} ${RADIUS * 2} ${RADIUS * 2}`}
      role="img"
      aria-label={ariaLabel}
      className="h-auto w-full max-w-[420px]"
    >
      <text textAnchor="middle" dy="0.35em" fontSize="11" fontWeight="bold">
        {centerText}
      </text>
      <g fillOpacity="0.6">
        {segments.map((segment) => (
          <path key={segment.key} d={segment.path} fill={segment.fill}>
            <title>{segment.tooltip}</title>
          </path>
        ))}
      </g>
      <g pointerEvents="none" textAnchor="middle" fontSize="8" fontFamily="sans-serif">
        {labels.map((label) => (
          <text key={label.key} transform={label.transform} dy="0.35em">
            {label.text}
          </text>
        ))}
      </g>
    </svg>
  );
}

export { layoutSunburst, Sunburst };
export type { SunburstNode };
