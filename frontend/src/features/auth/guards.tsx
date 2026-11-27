import { Navigate, Outlet, useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useMe } from "@/api/hooks";
import { useRole, type Role } from "@/api/portal";
import { useAuth } from "./auth-context";

export interface FromState {
  from?: string;
}

/** Домашний маршрут роли. */
const homeFor = (role: Role) => (role === "tenant" ? "/cabinet" : "/");

/** Приватные маршруты: без токена — на /login, после входа вернём обратно. */
export function RequireAuth() {
  const { isAuthenticated } = useAuth();
  const location = useLocation();
  if (!isAuthenticated) {
    // главная для гостя — поиск свободных квартир
    if (location.pathname === "/") return <Navigate to="/listings" replace />;
    const state: FromState = { from: location.pathname + location.search };
    return <Navigate to="/login" replace state={state} />;
  }
  return <Outlet />;
}

/** Пропускает только указанную роль; другую роль отправляет в её раздел. */
export function RequireRole({ role }: { role: Role }) {
  const { t } = useTranslation();
  const query = useRole();
  if (query.isPending) {
    return (
      <div className="p-6">
        <Skeleton className="h-8 w-48" />
      </div>
    );
  }
  if (query.isError) {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center gap-3 p-6 text-center">
        <p className="text-sm text-muted-foreground">{t("errors.network.description")}</p>
        <Button variant="secondary" onClick={() => void query.refetch()}>
          {t("common.retry")}
        </Button>
      </div>
    );
  }
  if (query.data !== role) return <Navigate to={homeFor(query.data)} replace />;
  return <Outlet />;
}

/** Раздел платформенного админа: только суперпользователь, остальных — на главную. */
export function RequireAdmin() {
  const query = useMe();
  if (query.isPending) {
    return (
      <div className="p-6">
        <Skeleton className="h-8 w-48" />
      </div>
    );
  }
  if (!query.data?.is_admin) return <Navigate to="/" replace />;
  return <Outlet />;
}

/** Разделы арендодателя: платформенного админа отправляем в его раздел. */
export function LandlordOnly() {
  const query = useMe();
  const { pathname } = useLocation();
  if (query.isPending) {
    return (
      <div className="p-6">
        <Skeleton className="h-8 w-48" />
      </div>
    );
  }
  if (query.data?.is_admin) return <Navigate to={pathname === "/profile" ? "/admin/profile" : "/admin"} replace />;
  return <Outlet />;
}

/** Вход и регистрация доступны только гостям. */
export function GuestOnly() {
  const { isAuthenticated } = useAuth();
  if (isAuthenticated) return <Navigate to="/" replace />;
  return <Outlet />;
}
