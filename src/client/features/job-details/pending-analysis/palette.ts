const classes = [
  "bg-priority-blue",
  "bg-priority-teal",
  "bg-priority-violet",
  "bg-priority-indigo",
  "bg-priority-cyan",
  "bg-priority-fuchsia",
];
const known: Record<string, number> = {
  fairshare: 0,
  partition: 1,
  age: 2,
  jobsize: 3,
  qos: 4,
  site: 5,
};
function priorityColor(name: string): string {
  const index =
    known[name.toLowerCase()] ??
    [...name].reduce(
      (hash, char) => (hash * 31 + char.charCodeAt(0)) >>> 0,
      0,
    ) % classes.length;
  return classes[index];
}
export { priorityColor };
