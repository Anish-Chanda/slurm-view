// D3.js Sunburst Chart functionality

function shouldShowSecondaryLayer(chartKey) {
  return window.SLURM_CONFIG.ui.charts[chartKey].showSecondaryLayer;
}

function buildMemoryChartData(memStats, showSecondaryLayer = true) {
  if (!showSecondaryLayer) {
    return {
      name: "Memory Utilization",
      children: [
        { name: "Allocated", value: memStats.allocated },
        { name: "Idle", value: memStats.idle },
        { name: "Down", value: memStats.down },
        { name: "Other", value: memStats.other }
      ]
    };
  }

  const allocatedUsed = Math.min(memStats.allocatedUsed, memStats.allocated);
  const allocatedReserved = Math.max(0, memStats.allocated - allocatedUsed);
  const allocatedChildren = [];

  if (allocatedUsed > 0) {
    allocatedChildren.push({ name: "Used", value: allocatedUsed });
  }

  if (allocatedReserved > 0) {
    allocatedChildren.push({ name: "Unused", value: allocatedReserved });
  }

  return {
    name: "Memory Utilization",
    children: [
      { name: "Allocated", children: allocatedChildren },
      { name: "Idle", value: memStats.idle },
      { name: "Down", value: memStats.down },
      { name: "Other", value: memStats.other }
    ]
  };
}

function buildCpuChartData(cpuStats, showSecondaryLayer = true) {
  if (!showSecondaryLayer) {
    return {
      name: "CPU Utilization",
      children: [
        { name: "Allocated", value: cpuStats.allocated },
        { name: "Idle", value: cpuStats.idle },
        { name: "Other", value: cpuStats.other }
      ]
    };
  }

  const loadGroups = cpuStats && cpuStats.loadGroups ? cpuStats.loadGroups : {};
  const lowLoad = Number(loadGroups.low) || 0;
  const mediumLoad = Number(loadGroups.medium) || 0;
  const highLoad = Number(loadGroups.high) || 0;

  const allocatedChildren = [];

  if (lowLoad > 0) {
    allocatedChildren.push({ name: "Low", value: lowLoad });
  }

  if (mediumLoad > 0) {
    allocatedChildren.push({ name: "Medium", value: mediumLoad });
  }

  if (highLoad > 0) {
    allocatedChildren.push({ name: "High", value: highLoad });
  }

  const allocatedNode = allocatedChildren.length > 0
    ? { name: "Allocated", children: allocatedChildren }
    : { name: "Allocated", value: cpuStats.allocated };

  return {
    name: "CPU Utilization",
    children: [
      allocatedNode,
      { name: "Idle", value: cpuStats.idle },
      { name: "Other", value: cpuStats.other }
    ]
  };
}

function buildGpuChartData(gpuStats, showSecondaryLayer = true) {
  if (showSecondaryLayer || !Array.isArray(gpuStats.children)) {
    return gpuStats;
  }

  return {
    ...gpuStats,
    children: gpuStats.children
      .map((child) => {
        if (typeof child.value === "number") {
          return { name: child.name, value: child.value };
        }

        const childTotal = Array.isArray(child.children)
          ? child.children.reduce((sum, nestedChild) => sum + (Number(nestedChild.value) || 0), 0)
          : 0;

        return { name: child.name, value: childTotal };
      })
      .filter((child) => child.name === "Error" || child.name === "No GPUs" || child.value > 0)
  };
}

function formatChartTotal(total, totalSuffix, containerId) {
  if (containerId === "sunburst-chart-mem" && totalSuffix === "GB" && total >= 1024) {
    const totalTb = total / 1024;
    const roundedTb = totalTb >= 100 ? Math.round(totalTb) : Number(totalTb.toFixed(1));
    return `${roundedTb} TB`;
  }

  if (totalSuffix) {
    return `${Math.round(total)} ${totalSuffix}`;
  }

  return `${Math.round(total)}`;
}

function drawSunburstChart(data, containerId, titleText, totalSuffix) {
  document.getElementById(containerId).innerHTML = '';
  const width = 500;
  const radius = width / 2;
  
  // Prepare a semantic color scale for all charts
  let color;
  if (containerId === "sunburst-chart-gpu") {
    // For GPU chart - use semantic colors based on usage state
    color = d => {
      // Special case for zero GPUs - use allocated color to indicate "no available GPUs"
      if (d.data.name === "No GPUs") {
        return "#e63946"; // Red color for "no available GPUs"
      }
      // Special case for errors - use a distinct error color
      if (d.data.name === "Error") {
        return "#8b5cf6"; // Purple color for errors
      }
      // First level: Used vs Available
      if (d.depth === 1) {
        if (d.data.name === "Used") return "#e63946"; // Red for used
        if (d.data.name === "Available") return "#2a9d8f"; // Green for available
        if (d.data.name === "Down") return "#f4a261"; // Orange for down nodes
        if (d.data.name === "Unknown") return "#9aa3ad"; // Gray for unknown states
        return "#888888";
      } 
      // Second level: Different GPU types get different shades based on parent
      else if (d.depth === 2) {
        const parentName = d.parent.data.name;
        if (parentName === "Used") {
          // Different shades of red/orange for used GPUs
          const usedColors = ["#e63946", "#f94144", "#f3722c", "#f8961e", "#f9844a"];
          return usedColors[d.parent.children.indexOf(d) % usedColors.length];
        } else if (parentName === "Available") {
          // Different shades of green/blue for available GPUs
          const availableColors = ["#2a9d8f", "#52b788", "#76c893", "#99d98c", "#b5e48c"];
          return availableColors[d.parent.children.indexOf(d) % availableColors.length];
        } else if (parentName === "Down") {
          // Orange shades for GPUs on down nodes
          const downColors = ["#f4a261", "#f1a66b", "#edae74", "#e7b57f", "#e1bc8b"];
          return downColors[d.parent.children.indexOf(d) % downColors.length];
        } else if (parentName === "Unknown") {
          // Gray shades for GPUs on unknown/unreachable states
          const unknownColors = ["#9aa3ad", "#a6aeb7", "#b1b8c0", "#bcc3ca", "#c8ced4"];
          return unknownColors[d.parent.children.indexOf(d) % unknownColors.length];
        }
      }
      return "#888888"; // Fallback gray color
    };
  } else {
    // For CPU and Memory charts - use consistent semantic colors
    color = d => {
      if (d.depth === 1) {
        // Use consistent semantic colors for resource states
        switch (d.data.name) {
          case "Allocated": return "#e63946"; // Red for allocated/used
          case "Idle": return "#2a9d8f"; // Green for idle/available  
          case "Down": return "#f4a261"; // Orange for down/unavailable
          case "Other": return "#9aa3ad"; // Gray for other/mixed states
          default: return "#888888"; // Fallback gray
        }
      }

      if (containerId === "sunburst-chart-mem" && d.depth === 2 && d.parent.data.name === "Allocated") {
        if (d.data.name === "Used") return "#c1121f";
        if (d.data.name === "Unused") return "#f28482";
      }

      if (containerId === "sunburst-chart-cpu" && d.depth === 2 && d.parent.data.name === "Allocated") {
        if (d.data.name === "Low") return "#8ecf7b";
        if (d.data.name === "Medium") return "#f6bd60";
        if (d.data.name === "High") return "#e76f51";
      }

      return "#888888"; // Fallback for deeper levels
    };
  }
  
  // Partition layout: convert data into a hierarchy with computed angles.
  const partition = d => d3.partition()
    .size([2 * Math.PI, radius])
    (d3.hierarchy(data)
      .sum(d => d.value)
      .sort((a, b) => b.value - a.value));

  const arc = d3.arc()
    .startAngle(d => d.x0)
    .endAngle(d => d.x1)
    .padAngle(d => Math.min((d.x1 - d.x0) / 2, 0.005))
    .padRadius(radius / 2)
    .innerRadius(d => d.y0)
    .outerRadius(d => d.y1 - 1);

  const root = partition(data);

  // Create the SVG container.
  const svg = d3.create("svg")
    .attr("viewBox", [-radius, -radius, width, width]).style("height", "400px")
    .style("font", "10px sans-serif");

  // For GPU charts, use totalGPUs if available, otherwise use the sum of values
  let total = root.value;
  if (containerId === "sunburst-chart-gpu" && data.totalGPUs !== undefined) {
    total = data.totalGPUs;
  }
  
  // Add central label.
  svg.append("text")
    .attr("text-anchor", "middle")
    .attr("dy", "0.35em")
    .style("font-size", "16px")
    .style("font-weight", "bold")
    .text(titleText + " Total: " + formatChartTotal(total, totalSuffix, containerId));

  // Draw arcs.
  svg.append("g")
    .attr("fill-opacity", 0.6)
    .selectAll("path")
    .data(root.descendants().filter(d => d.depth))
    .join("path")
    .attr("fill", d => {
        // All charts now use semantic color mapping
        return color(d);
    })
    .attr("d", arc)
    .append("title")
    .text(d => `${d.ancestors().map(d => d.data.name).reverse().join("/")}\n${d3.format(",d")(d.value)}`);

  // Add labels to arcs if space permits.
  svg.append("g")
    .attr("pointer-events", "none")
    .attr("text-anchor", "middle")
    .attr("font-size", 10)
    .attr("font-family", "sans-serif")
    .selectAll("text")
    .data(root.descendants().filter(d => d.depth && ((d.y0 + d.y1) / 2 * (d.x1 - d.x0)) > 10))
    .join("text")
    .attr("transform", d => {
        const x = (d.x0 + d.x1) / 2 * 180 / Math.PI;
        const y = (d.y0 + d.y1) / 2;
        return `rotate(${x - 90}) translate(${y},0) rotate(${x < 180 ? 0 : 180})`;
    })
    .attr("dy", "0.35em")
    .text(d => d.data.name);

  // Append the SVG into the target container.
  document.getElementById(containerId).appendChild(svg.node());
}

function updateChartsForPartition(partition) {
  const baseUrl = window.SLURM_CONFIG.baseUri;
  const partitionBadge = document.getElementById('partition-badge');
  const selectedPartitionName = document.getElementById('selected-partition-name');
  const showCpuSecondaryLayer = shouldShowSecondaryLayer('cpu');
  const showMemorySecondaryLayer = shouldShowSecondaryLayer('memory');
  const showGpuSecondaryLayer = shouldShowSecondaryLayer('gpu');
  
  // Show/hide partition badge
  if (partition === 'all') {
    partitionBadge.classList.add('hidden');
  } else {
    // Find the partition name from the select element
    const partitionSelect = document.getElementById('partition-select');
    const selectedOption = partitionSelect.options[partitionSelect.selectedIndex];
    selectedPartitionName.textContent = selectedOption.text;
    partitionBadge.classList.remove('hidden');
  }
  
  // Fetch stats for the selected partition
  fetch(`${baseUrl}/api/stats?partition=${partition}`)
    .then(response => response.json())
    .then(data => {
      if (data.success) {
        // Create updated chart data
        const newCpuData = buildCpuChartData(data.cpuStats, showCpuSecondaryLayer);
        const newMemData = buildMemoryChartData(data.memStats, showMemorySecondaryLayer);
        const newGpuData = buildGpuChartData(data.gpuStats, showGpuSecondaryLayer);
        
        // Redraw charts with new data
        drawSunburstChart(newCpuData, "sunburst-chart-cpu", "CPU");
        drawSunburstChart(newMemData, "sunburst-chart-mem", "Memory", "GB");
        drawSunburstChart(newGpuData, "sunburst-chart-gpu", "GPU");
      } else {
        console.error("Error fetching stats:", data.error);
      }
    })
    .catch(err => {
      console.error("Error updating stats:", err);
    });
}

function initializeCharts() {
  // Data for CPU sunburst chart
  const cpuData = buildCpuChartData(window.SLURM_CONFIG.cpuStats, shouldShowSecondaryLayer('cpu'));

  // Data for Memory sunburst chart
  const memData = buildMemoryChartData(window.SLURM_CONFIG.memStats, shouldShowSecondaryLayer('memory'));
  const gpuData = buildGpuChartData(window.SLURM_CONFIG.gpuStats, shouldShowSecondaryLayer('gpu'));

  // Render all charts
  drawSunburstChart(cpuData, "sunburst-chart-cpu", "CPU");
  drawSunburstChart(memData, "sunburst-chart-mem", "Memory", "GB");
  drawSunburstChart(gpuData, "sunburst-chart-gpu", "GPU");

  // Listen for partition selection changes
  document.getElementById('partition-select').addEventListener('change', function() {
    updateChartsForPartition(this.value);
  });
}
