function formatTime(time) {
  // Try to parse an integer number of seconds
  const totalSeconds = parseInt(time);
  if (isNaN(totalSeconds)) {
    console.log("formatTime arg is nan")
    return "N/A";
  }

  // Break into days / hours / minutes / seconds
  let seconds = totalSeconds;
  const days = Math.floor(seconds / 86400);
  seconds %= 86400;
  const hours = Math.floor(seconds / 3600);
  seconds %= 3600;
  const minutes = Math.floor(seconds / 60);
  seconds %= 60;

  // Build the string, removing trailing zero values
  const parts = [];
  if (days > 0) {
    parts.push(`${days}d`);
  }
  if (hours > 0) {
    parts.push(`${hours}h`);
  }
  if (minutes > 0) {
    parts.push(`${minutes}m`);
  }
  if (seconds > 0) {
    parts.push(`${seconds}s`);
  }
  
  // If nothing was added, return "0s"
  if (parts.length === 0) {
    return "0s";
  }

  return parts.join(' ');
}

function formatUnixTimestamp(time) {
  if (!time || isNaN(time) || time === 0) {
    return "N/A";
  }

  return new Date(time * 1000).toLocaleString();
}

module.exports = {
  formatTime,
  formatUnixTimestamp
}
