export function formatTimeLimit(timeLimit) {
    if (!timeLimit) return "N/A";

    //convert seconds to days, hours, mins and seconds
    let seconds = parseInt(timeLimit);
    const days = Math.floor(seconds / 86400);
    seconds %= 86400;
    const hours = Math.floor(seconds / 3600);
    seconds %= 3600;
    const minutes = Math.floor(seconds / 60);
    seconds %= 60;
    let formated = '';
    if (days > 0) {
        formated += `${days}d `;
    }
    if (hours > 0) {
        formated += `${hours}h `;
    }
    if (minutes > 0) {
        formated += `${minutes}m `;
    }
    formated += `${seconds}s`;
    return formated.trim();
}
