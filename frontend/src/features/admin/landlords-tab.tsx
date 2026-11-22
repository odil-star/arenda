import { Eye, KeyRound, Lock, LockOpen, Mail, MoreHorizontal } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Select } from "@/components/ui/select";
import { Avatar } from "@/components/common/avatar";
import { DataList, type Column } from "@/components/common/data-list";
import { SearchInput } from "@/components/common/search-input";
import { EmptyState } from "@/components/common/states";
import {
  adminUsersApi, useAdminUserAction, useImpersonate, type AdminUser, type AdminUserAction,
} from "@/api/admin";
import { tokens } from "@/api/tokens";
import { ExportButton } from "./export-button";
import { displayName } from "./display-name";
import { LandlordDetails, PlanBadge } from "./landlord-details";
import { useAdminRole } from "./use-admin-role";
import { serverMessages } from "@/api/errors";
import { useFormat } from "@/lib/format";
import { useUrlState } from "@/lib/hooks";
import { FilterBar } from "./filter-bar";

export function AdminLandlordsTab() {
  const { t } = useTranslation();
  const fmt = useFormat();
  const { values, page, set } = useUrlState(["search", "filter"] as const);
  const filter = values.filter === "active" || values.filter === "blocked" ? values.filter : "all";
  const query = adminUsersApi.useList({
    page,
    search: values.search,
    is_active: filter === "all" ? undefined : filter === "active" ? "true" : "false",
  });
  const { canWrite } = useAdminRole();
  const action = useAdminUserAction();
  const impersonate = useImpersonate();
  const navigate = useNavigate();
  const [viewAs, setViewAs] = useState<AdminUser>();
  const [openId, setOpenId] = useState<number>();
  const [pending, setPending] = useState<{ user: AdminUser; action: AdminUserAction }>();

  const run = async () => {
    if (!pending) return;
    try {
      await action.mutateAsync({ id: pending.user.id, action: pending.action });
      toast.success(
        t(
          pending.action === "block"
            ? "admin.landlords.blocked"
            : pending.action === "unblock"
              ? "admin.landlords.unblocked"
              : "admin.landlords.resetSent",
        ),
      );
      setPending(undefined);
    } catch (error) {
      toast.error(serverMessages(error)[0] ?? t("errors.actionFailed"));
    }
  };

  /** Просмотр глазами арендодателя: подменяем токен на «только чтение» и перезагружаем приложение. */
  const openViewAs = async () => {
    if (!viewAs) return;
    try {
      const { access, email } = await impersonate.mutateAsync(viewAs.id);
      tokens.startImpersonation(access, email);
      window.location.assign("/");
    } catch (error) {
      toast.error(serverMessages(error)[0] ?? t("admin.landlords.viewAsFailed"));
      setViewAs(undefined);
    }
  };

  const statusBadge = (u: AdminUser) =>
    u.is_active ? (
      <Badge tone="success">{t("admin.landlords.active")}</Badge>
    ) : (
      <Badge tone="danger">{t("admin.landlords.blockedBadge")}</Badge>
    );

  const columns: Column<AdminUser>[] = [
    {
      key: "name",
      header: t("admin.landlords.email"),
      cell: (u) => (
        <button type="button" onClick={() => setOpenId(u.id)} className="flex items-center gap-3 text-left hover:underline">
          <Avatar name={displayName(u)} />
          <span className="min-w-0">
            <span className="block truncate font-medium">{displayName(u)}</span>
            {displayName(u) !== u.email && <span className="block truncate text-xs text-muted-foreground">{u.email}</span>}
          </span>
        </button>
      ),
    },
    { key: "properties", header: t("admin.landlords.properties"), align: "right", cell: (u) => fmt.number(u.properties_count) },
    { key: "leases", header: t("admin.landlords.leases"), align: "right", cell: (u) => fmt.number(u.leases_count) },
    { key: "plan", header: t("admin.landlords.plan"), className: "hidden xl:table-cell", cell: (u) => <PlanBadge user={u} /> },
    { key: "joined", header: t("admin.landlords.joined"), className: "hidden xl:table-cell", cell: (u) => fmt.date(u.date_joined) },
    {
      key: "login",
      header: t("admin.landlords.lastLogin"),
      className: "hidden xl:table-cell",
      cell: (u) =>
        u.last_login ? fmt.date(u.last_login) : <span className="text-muted-foreground">{t("admin.landlords.never")}</span>,
    },
    { key: "status", header: t("admin.landlords.status"), cell: statusBadge },
  ];

  /** Действия над арендодателем: на компьютере — иконки, на телефоне — одно меню «⋯», чтобы не сжимать карточку. */
  const actionsFor = (u: AdminUser) => [
    { key: "view", label: t("admin.landlords.viewAs"), icon: Eye, disabled: !u.is_active, run: () => setViewAs(u) },
    ...(canWrite
      ? [
          {
            key: "write", label: t("admin.landlords.write"), icon: Mail, disabled: !u.is_active,
            run: () => navigate(`/admin/messages?to=${u.id}`),
          },
          {
            key: "reset", label: t("admin.landlords.resetPassword"), icon: KeyRound, disabled: !u.is_active,
            run: () => setPending({ user: u, action: "reset-password" as const }),
          },
          {
            key: "lock",
            label: u.is_active ? t("admin.landlords.block") : t("admin.landlords.unblock"),
            icon: u.is_active ? Lock : LockOpen,
            disabled: false,
            run: () => setPending({ user: u, action: u.is_active ? ("block" as const) : ("unblock" as const) }),
          },
        ]
      : []),
  ];

  const rowActions = (u: AdminUser) => {
    const list = actionsFor(u);
    return (
      <>
        <div className="hidden gap-1 md:flex">
          {list.map(({ key, label, icon: Icon, disabled, run }) => (
            <Button key={key} variant="ghost" size="icon" aria-label={label} title={label} disabled={disabled} onClick={run}>
              <Icon aria-hidden />
            </Button>
          ))}
        </div>
        <div className="md:hidden">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" aria-label={t("common.actionsFor", { name: displayName(u) })}>
                <MoreHorizontal aria-hidden />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {list.map(({ key, label, icon: Icon, disabled, run }) => (
                <DropdownMenuItem key={key} disabled={disabled} onSelect={run}>
                  <Icon aria-hidden />
                  {label}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </>
    );
  };

  const email = pending?.user.email ?? "";
  const texts = pending
    ? {
        block: [t("admin.landlords.blockTitle", { email }), t("admin.landlords.blockText"), t("admin.landlords.block")],
        unblock: [t("admin.landlords.unblockTitle", { email }), t("admin.landlords.unblockText"), t("admin.landlords.unblock")],
        "reset-password": [t("admin.landlords.resetTitle", { email }), t("admin.landlords.resetText"), t("admin.landlords.resetPassword")],
      }[pending.action]
    : ["", "", ""];

  return (
    <>
      <FilterBar
        search={<SearchInput value={values.search} onChange={(v) => set("search", v)} placeholder={t("admin.landlords.search")} />}
        active={filter !== "all" ? 1 : 0}
        actions={<ExportButton path="/admin/users/" name="landlords" params={{ search: values.search, is_active: filter === "all" ? undefined : filter === "active" ? "true" : "false" }} />}
      >
        <div className="sm:w-52">
          <Select
            aria-label={t("admin.landlords.status")}
            value={filter}
            onValueChange={(v) => set("filter", v === "all" ? null : v)}
            options={[
              { value: "all", label: t("admin.landlords.filterAll") },
              { value: "active", label: t("admin.landlords.filterActive") },
              { value: "blocked", label: t("admin.landlords.filterBlocked") },
            ]}
          />
        </div>
      </FilterBar>

      <DataList
        query={query}
        caption={t("admin.tabs.landlords")}
        columns={columns}
        page={page}
        onPageChange={(p) => set("page", p)}
        actions={rowActions}
        renderMobile={(u) => (
          <button type="button" onClick={() => setOpenId(u.id)} className="flex w-full items-center gap-3 text-left">
            <Avatar name={displayName(u)} size="lg" />
            <div className="min-w-0 space-y-0.5">
              <p className="truncate font-medium">{displayName(u)}</p>
              {displayName(u) !== u.email && <p className="truncate text-xs text-muted-foreground">{u.email}</p>}
              <p className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                {statusBadge(u)}
                {t("admin.landlords.properties")}: {u.properties_count} · {t("admin.landlords.leases")}: {u.leases_count}
              </p>
            </div>
          </button>
        )}
        empty={
          <EmptyState
            illustration={values.search ? "search" : "people"}
            title={values.search ? t("admin.landlords.emptySearch") : t("admin.landlords.empty")}
          />
        }
      />

      <LandlordDetails id={openId} onClose={() => setOpenId(undefined)} />

      <ConfirmDialog
        open={viewAs !== undefined}
        onOpenChange={(o) => !o && setViewAs(undefined)}
        title={t("admin.landlords.viewAsTitle", { email: viewAs?.email ?? "" })}
        description={t("admin.landlords.viewAsText")}
        confirmLabel={t("admin.landlords.viewAsConfirm")}
        destructive={false}
        loading={impersonate.isPending}
        onConfirm={() => void openViewAs()}
      />

      <ConfirmDialog
        open={pending !== undefined}
        onOpenChange={(o) => !o && setPending(undefined)}
        title={texts[0]}
        description={texts[1]}
        confirmLabel={texts[2]}
        destructive={pending?.action === "block"}
        loading={action.isPending}
        onConfirm={() => void run()}
      />
    </>
  );
}
