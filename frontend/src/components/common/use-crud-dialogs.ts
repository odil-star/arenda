import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { serverMessages } from "@/api/errors";

interface RemoveMutation {
  mutateAsync: (id: number) => Promise<void>;
  isPending: boolean;
}

/**
 * Общее состояние экранов-справочников: окно формы (создать / изменить)
 * и подтверждение удаления с toast'ом об итоге.
 */
export function useCrudDialogs<T extends { id: number }>(remove: RemoveMutation, deletedMessage: string) {
  const { t } = useTranslation();
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<T | null>(null);
  const [deleting, setDeleting] = useState<T | null>(null);

  return {
    formOpen,
    editing,
    deleting,
    openCreate: () => {
      setEditing(null);
      setFormOpen(true);
    },
    openEdit: (item: T) => {
      setEditing(item);
      setFormOpen(true);
    },
    setFormOpen,
    askDelete: setDeleting,
    cancelDelete: () => setDeleting(null),
    /** true — удалено; при ошибке показывает toast и возвращает false */
    confirmDelete: async (): Promise<boolean> => {
      if (!deleting) return false;
      try {
        await remove.mutateAsync(deleting.id);
        toast.success(deletedMessage);
        setDeleting(null);
        return true;
      } catch (error) {
        // например, объект с договорами удалить нельзя (PROTECT)
        toast.error(serverMessages(error)[0] ?? t("errors.deleteFailed"));
        return false;
      }
    },
    deletePending: remove.isPending,
  };
}
