"use client";

interface ItemsTabProps {
  showCreateForm: boolean;
  onCreateFormClose: () => void;
}

export function ItemsTab({ showCreateForm, onCreateFormClose }: ItemsTabProps) {
  return (
    <div className="py-8 text-center text-text-secondary">
      Items tab coming soon
    </div>
  );
}
