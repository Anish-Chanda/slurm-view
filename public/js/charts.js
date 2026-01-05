// D3.js Sunburst Chart functionality

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
        return d.data.name === "Used" ? "#e63946" : "#2a9d8f"; // Red for used, Green for available
      } 
      // Second level: Different GPU types get different shades based on parent
      else if (d.depth === 2) {
        const parentName = d.parent.data.name;
        if (parentName === "Used") {
          // Different shades of red/orange for used GPUs
          const usedColors = ["#e63946", "#f94144", "#f3722c", "#f8961e", "#f9844a"];
          return usedColors[d.parent.children.indexOf(d) % usedColors.length];
        } else {
          // Different shades of green/blue for available GPUs
          const availableColors = ["#2a9d8f", "#52b788", "#76c893", "#99d98c", "#b5e48c"];
          return availableColors[d.parent.children.indexOf(d) % availableColors.length];
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
          case "Down": return "#6c757d"; // Gray for down/unavailable
          case "Other": return "#ffc107"; // Yellow for other/mixed states
          default: return "#888888"; // Fallback gray
        }
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
    .text(titleText + " Total: " + Math.round(total) + (totalSuffix ? " " + totalSuffix : ""));

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
        const newCpuData = {
          name: "CPU Utilization",
          children: [
            { name: "Allocated", value: data.cpuStats.allocated },
            { name: "Idle", value: data.cpuStats.idle },
            { name: "Other", value: data.cpuStats.other }
          ]
        };
        
        const newMemData = {
          name: "Memory Utilization",
          children: [
            { name: "Allocated", value: data.memStats.allocated },
            { name: "Idle", value: data.memStats.idle },
            { name: "Down", value: data.memStats.down },
            { name: "Other", value: data.memStats.other }
          ]
        };
        
        // Redraw charts with new data
        drawSunburstChart(newCpuData, "sunburst-chart-cpu", "CPU");
        drawSunburstChart(newMemData, "sunburst-chart-mem", "Memory", "GB");
        drawSunburstChart(data.gpuStats, "sunburst-chart-gpu", "GPU");
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
  const cpuData = {
    name: "CPU Utilization",
    children: [
      { name: "Allocated", value: window.SLURM_CONFIG.cpuStats.allocated },
      { name: "Idle", value: window.SLURM_CONFIG.cpuStats.idle },
      { name: "Other", value: window.SLURM_CONFIG.cpuStats.other }
    ]
  };

  // Data for Memory sunburst chart
  const memData = {
    name: "Memory Utilization",
    children: [
      { name: "Allocated", value: window.SLURM_CONFIG.memStats.allocated },
      { name: "Idle", value: window.SLURM_CONFIG.memStats.idle },
      { name: "Down", value: window.SLURM_CONFIG.memStats.down },
      { name: "Other", value: window.SLURM_CONFIG.memStats.other }
    ]
  };

  // Render all charts
  drawSunburstChart(cpuData, "sunburst-chart-cpu", "CPU");
  drawSunburstChart(memData, "sunburst-chart-mem", "Memory", "GB");
  drawSunburstChart(window.SLURM_CONFIG.gpuStats, "sunburst-chart-gpu", "GPU");

  // Listen for partition selection changes
  document.getElementById('partition-select').addEventListener('change', function() {
    updateChartsForPartition(this.value);
  });
}
