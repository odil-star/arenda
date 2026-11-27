import { Gem, ImageUp, Lock, Trash2 } from "lucide-react";
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { FormAlert, FormField } from "@/components/common/form-field";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input, Textarea } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useContractBrand, useResetContractBrand, useSaveContractBrand, type ContractBrand } from "@/api/brand";
import { errorKind, serverMessages } from "@/api/errors";

const MAX_LOGO = 1024 * 1024;

function BrandForm({ brand }: { brand: ContractBrand }) {
  const { t } = useTranslation();
  const save = useSaveContractBrand();
  const reset = useResetContractBrand();
  const fileRef = useRef<HTMLInputElement>(null);
  const [name, setName] = useState(brand.company_name);
  const [requisites, setRequisites] = useState(brand.requisites);
  const [logo, setLogo] = useState<File | null>(null);
  const [removeLogo, setRemoveLogo] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const dirty = name !== brand.company_name || requisites !== brand.requisites || logo !== null || removeLogo;
  const hasLogo = (brand.has_logo && !removeLogo) || logo !== null;
  const empty = !brand.company_name && !brand.requisites && !brand.has_logo;

  const pick = (file: File | undefined) => {
    if (!file) return;
    if (file.size > MAX_LOGO) return setErrors([t("brand.logoTooBig")]);
    setErrors([]);
    setLogo(file);
    setRemoveLogo(false);
  };

  const submit = async () => {
    setErrors([]);
    try {
      await save.mutateAsync({ company_name: name.trim(), requisites: requisites.trim(), logo, removeLogo });
      setLogo(null);
      setRemoveLogo(false);
      toast.success(t("cabinet.saved"));
    } catch (error) {
      const m = serverMessages(error);
      setErrors(m.length ? m : [t(`errors.${errorKind(error)}.description`)]);
    }
  };

  const doReset = async () => {
    await reset.mutateAsync();
    setName("");
    setRequisites("");
    setLogo(null);
    setRemoveLogo(false);
    toast.success(t("brand.resetDone"));
  };

  return (
    <form
      noValidate
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <FormAlert messages={errors} />
      <FormField label={t("brand.name")} optional>
        {(p) => <Input {...p} maxLength={150} value={name} onChange={(e) => setName(e.target.value)} />}
      </FormField>
      <FormField label={t("brand.requisites")} hint={t("brand.requisitesHint")} optional>
        {(p) => <Textarea {...p} rows={4} maxLength={1000} value={requisites} onChange={(e) => setRequisites(e.target.value)} />}
      </FormField>
      <div className="space-y-2">
        <p className="text-sm font-medium">{t("brand.logo")}</p>
        <div className="flex flex-wrap items-center gap-2">
          <input
            ref={fileRef}
            type="file"
            accept="image/png,image/jpeg"
            className="sr-only"
            onChange={(e) => {
              pick(e.target.files?.[0]);
              e.target.value = "";
            }}
          />
          <Button type="button" variant="secondary" size="sm" onClick={() => fileRef.current?.click()}>
            <ImageUp aria-hidden /> {hasLogo ? t("brand.logoReplace") : t("brand.logoUpload")}
          </Button>
          {hasLogo && (
            <>
              <span className="min-w-0 truncate text-sm text-muted-foreground">{logo ? logo.name : t("brand.logoSet")}</span>
              <Button type="button" variant="ghost" size="sm" onClick={() => { setLogo(null); setRemoveLogo(true); }}>
                <Trash2 aria-hidden /> {t("brand.logoRemove")}
              </Button>
            </>
          )}
        </div>
        <p className="text-xs text-muted-foreground">{t("brand.logoHint")}</p>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button type="submit" loading={save.isPending} disabled={!dirty}>
          {t("common.save")}
        </Button>
        {!empty && (
          <Button type="button" variant="secondary" loading={reset.isPending} onClick={() => void doReset()}>
            {t("brand.reset")}
          </Button>
        )}
      </div>
    </form>
  );
}

/** Prime: свой бланк договора. На Free — закрытая карточка с подсказкой про тариф. */
export function BrandCard({ onSeePlans }: { onSeePlans?: () => void }) {
  const { t } = useTranslation();
  const query = useContractBrand();

  return (
    <section aria-labelledby="brand-h" className="space-y-2">
      <h2 id="brand-h" className="flex items-center gap-2 text-base font-semibold">
        {t("brand.title")}
        <span className="inline-flex items-center gap-1 rounded-md bg-info-soft px-1.5 py-0.5 text-xs font-medium text-info">
          <Gem className="size-3" aria-hidden /> Prime
        </span>
      </h2>
      <Card className="space-y-3 p-5">
        <p className="text-sm text-muted-foreground">{t("brand.hint")}</p>
        {query.isPending ? (
          <Skeleton className="h-40 w-full" />
        ) : query.isError ? (
          <FormAlert messages={[t(`errors.${errorKind(query.error)}.description`)]} />
        ) : query.data.available ? (
          <BrandForm brand={query.data} />
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-muted p-3">
            <span className="flex items-center gap-2 text-sm">
              <Lock className="size-4 shrink-0 text-muted-foreground" aria-hidden />
              {t("brand.locked")}
            </span>
            {onSeePlans && (
              <Button size="sm" variant="secondary" onClick={onSeePlans}>
                {t("brand.seePlans")}
              </Button>
            )}
          </div>
        )}
      </Card>
    </section>
  );
}
