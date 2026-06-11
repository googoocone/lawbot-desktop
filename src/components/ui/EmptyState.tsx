interface EmptyStateProps {
  icon?: string;
  message: string;
  description?: string;
}

export function EmptyState({
  icon = "📋",
  message,
  description,
}: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center py-12 text-center">
      <span className="text-4xl mb-3">{icon}</span>
      <p className="text-gray-700 font-medium">{message}</p>
      {description && (
        <p className="text-sm text-gray-500 mt-1">{description}</p>
      )}
    </div>
  );
}
