interface PartitionSelectProps {
  value: string | null;
  partitions: string[];
  disabled?: boolean;
  onChange: (partition: string | null) => void;
}

function PartitionSelect({ value, partitions, disabled, onChange }: PartitionSelectProps) {
  return (
    <div className="flex items-center space-x-2">
      <label htmlFor="partition-select" className="text-sm">
        Partition:
      </label>
      <select
        id="partition-select"
        className="w-[180px] rounded border p-2 text-sm disabled:opacity-60"
        value={value ?? ''}
        disabled={disabled}
        onChange={(event) =>
          onChange(event.target.value === '' ? null : event.target.value)
        }
      >
        <option value="">All partitions</option>
        {partitions.map((partition) => (
          <option key={partition} value={partition}>
            {partition}
          </option>
        ))}
      </select>
    </div>
  );
}

export { PartitionSelect };
