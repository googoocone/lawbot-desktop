interface BadgeProps {
  label: string;
  colorClass?: string;
}

export function Badge({
  label,
  colorClass = "bg-gray-100 text-gray-700",
}: BadgeProps) {
  return (
    <span
      className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold tracking-tight whitespace-nowrap ${colorClass}`}
    >
      {label}
    </span>
  );
}
