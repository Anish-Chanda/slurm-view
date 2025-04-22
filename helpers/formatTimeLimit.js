export function formatTimeLimit(timeLimit) {
    // Try to parse an integer number of seconds
    const totalSeconds = parseInt(timeLimit, 10);
    if (isNaN(totalSeconds)) {
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
  
    // Build the string, always including necessary zero‑values
    if (days > 0) {
      return `${days}d ${hours}h ${minutes}m ${seconds}s`;
    } else if (hours > 0) {
      return `${hours}h ${minutes}m ${seconds}s`;
    } else if (minutes > 0) {
      return `${minutes}m ${seconds}s`;
    } else {
      return `${seconds}s`;
    }
  }
  