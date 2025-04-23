const { formatTime } = require("./formatTime.js");

function formatTimeLeft(timeLimit, startTime, jobState) {
  // missing data?
  if (timeLimit == null || startTime == null) {
    console.log("aah");
    return "N/A";
  }

  // Convert job state to uppercase and check if it's running
  const state = jobState.toUpperCase();
  if (state !== "RUNNING" && state !== "R") {
    return "Not started";
  }

  const nowSec = Math.floor(Date.now() / 1000);
  const endtime = nowSec + timeLimit;
  const remaining = endtime - startTime;

  return formatTime(remaining);
}

module.exports = { formatTimeLeft };
