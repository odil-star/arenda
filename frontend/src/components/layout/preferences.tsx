import { Check, Languages, LogOut, Monitor, Moon, ShieldCheck, Sun, UserRound } from "lucide-react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Avatar } from "@/components/common/avatar";
import { useAuth } from "@/features/auth/auth-context";
import { asLanguage } from "@/lib/format";
import { useTheme, type ThemeSetting } from "@/lib/theme-context";
import { useCurrentUser } from "./use-current-user";
import { RoleBadge } from "./user-card";

const LANGUAGES = [
  { code: "ru", short: "RU", labelKey: "language.ru" },
  { code: "uz", short: "UZ", labelKey: "language.uz" },
] as const;

export function LanguageSwitcher() {
  const { t, i18n } = useTranslation();
  const current = asLanguage(i18n.language);
  const short = LANGUAGES.find((l) => l.code === current)?.short;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" aria-label={t("language.change")} className="gap-1.5 px-2.5">
          <Languages aria-hidden />
          <span className="text-xs font-semibold">{short}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        <DropdownMenuLabel>{t("language.title")}</DropdownMenuLabel>
        {LANGUAGES.map((l) => (
          <DropdownMenuItem key={l.code} onSelect={() => void i18n.changeLanguage(l.code)}>
            <span className="flex-1">{t(l.labelKey)}</span>
            {current === l.code && <Check className="!text-primary" aria-hidden />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

const THEMES: { value: ThemeSetting; icon: typeof Sun; labelKey: "theme.light" | "theme.dark" | "theme.system" }[] = [
  { value: "light", icon: Sun, labelKey: "theme.light" },
  { value: "dark", icon: Moon, labelKey: "theme.dark" },
  { value: "system", icon: Monitor, labelKey: "theme.system" },
];

export function ThemeSwitcher() {
  const { t } = useTranslation();
  const { theme, resolved, setTheme } = useTheme();
  const Icon = resolved === "dark" ? Moon : Sun;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" aria-label={t("theme.change")}>
          <Icon aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        <DropdownMenuLabel>{t("theme.title")}</DropdownMenuLabel>
        <DropdownMenuRadioGroup value={theme} onValueChange={(v) => setTheme(v as ThemeSetting)}>
          {THEMES.map(({ value, icon: ItemIcon, labelKey }) => (
            <DropdownMenuRadioItem key={value} value={value}>
              <ItemIcon aria-hidden />
              {t(labelKey)}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Меню аккаунта в шапке — для телефона (на десктопе то же самое в карточке внизу боковой панели). */
export function UserMenu() {
  const { t } = useTranslation();
  const { signOut } = useAuth();
  const user = useCurrentUser();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" aria-label={t("auth.account")} className="lg:hidden">
          {user.name ? <Avatar name={user.name} size="sm" /> : <UserRound aria-hidden />}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-60">
        <div className="flex items-center gap-3 px-2.5 py-2">
          <Avatar name={user.name || "?"} />
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold">{user.name}</p>
            {user.role && <RoleBadge role={user.role} adminRole={user.adminRole} className="mt-1" />}
          </div>
        </div>
        {user.email && user.email !== user.name && (
          <DropdownMenuLabel className="truncate pt-0">{user.email}</DropdownMenuLabel>
        )}
        <DropdownMenuSeparator />
        {user.isAdmin && (
          <DropdownMenuItem asChild>
            <Link to="/admin">
              <ShieldCheck aria-hidden />
              {t("nav.admin")}
            </Link>
          </DropdownMenuItem>
        )}
        {user.role === "landlord" && (
          <DropdownMenuItem asChild>
            <Link to="/profile">
              <UserRound aria-hidden />
              {t("nav.profile")}
            </Link>
          </DropdownMenuItem>
        )}
        <DropdownMenuItem onSelect={signOut}>
          <LogOut aria-hidden />
          {t("auth.logout")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
