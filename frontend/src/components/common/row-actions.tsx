import { MoreHorizontal, Pencil, ShieldCheck, Trash2, UserPlus } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

interface RowActionsProps {
  label: string;
  onEdit: () => void;
  onDelete: () => void;
  /** Необязательное действие «Пригласить жильца» (для объектов). */
  onInvite?: () => void;
  /** Необязательное действие «Проверить жильца» (VIP). */
  onScreen?: () => void;
}

/** Меню «Изменить / Удалить» для строки списка. */
export function RowActions({ label, onEdit, onDelete, onInvite, onScreen }: RowActionsProps) {
  const { t } = useTranslation();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" aria-label={t("common.actionsFor", { name: label })}>
          <MoreHorizontal aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        {onInvite && (
          <DropdownMenuItem onSelect={onInvite}>
            <UserPlus aria-hidden />
            {t("properties.invite.action")}
          </DropdownMenuItem>
        )}
        {onScreen && (
          <DropdownMenuItem onSelect={onScreen}>
            <ShieldCheck aria-hidden />
            {t("screening.action")}
          </DropdownMenuItem>
        )}
        <DropdownMenuItem onSelect={onEdit}>
          <Pencil aria-hidden />
          {t("common.edit")}
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={onDelete} className="text-danger [&_svg]:!text-danger">
          <Trash2 aria-hidden />
          {t("common.delete")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
