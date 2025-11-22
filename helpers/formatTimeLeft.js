const { formatTime } = require("./formatTime.js");

function formatTimeLeft(timeLimit, startTime, jobState) {
  // missing data?
  if (timeLimit == null || startTime == null) {
    return "N/A";
  }

  // Convert job state to uppercase and check if it's running
  const state = Array.isArray(jobState) ? jobState[0].toUpperCase() : jobState.toUpperCase();
  if (state !== "RUNNING" && state !== "R") {
    return "Not started";
  }

  const nowSec = Math.floor(Date.now() / 1000);
  const endTime = startTime + timeLimit;
  const remaining = endTime - nowSec;

  // If job has exceeded its time limit, show as "Exceeded"
  if (remaining <= 0) {
    return "Exceeded";
  }

  return formatTime(remaining);
}

module.exports = { formatTimeLeft };
