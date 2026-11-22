import { ArrowLeft, ArrowRight, Plus } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Avatar, KindIcon } from "@/components/common/avatar";
import { PageHeader } from "@/components/common/page-header";
import { SearchInput } from "@/components/common/search-input";
import { EmptyState } from "@/components/common/states";
import { PropertyStatusBadge } from "@/components/common/status-badges";
import { leasesApi, propertiesApi, tenantsApi, useOccupiedPropertyIds } from "@/api/hooks";
import type { Property, Tenant } from "@/api/types";
import { cn } from "@/lib/utils";
import { PropertyFormDialog } from "@/features/properties/property-form-dialog";
import { TenantFormDialog } from "@/features/tenants/tenant-form-dialog";
import { MediaPicker } from "@/features/media/media-picker";
import { useUploadLeaseMedia } from "@/api/portal";
import { LeaseTermsForm, type LeaseTerms } from "./lease-terms-form";
import { PickList } from "./pick-list";

const STEPS = ["property", "tenant", "terms"] as const;
type Step = 0 | 1 | 2;

function Stepper({ step, onStep }: { step: Step; onStep: (s: Step) => void }) {
  const { t } = useTranslation();
  return (
    <ol className="mb-5 grid grid-cols-3 gap-2" aria-label={t("leases.wizard.steps")}>
      {STEPS.map((key, i) => {
        const done = i < step;
        const current = i === step;
        return (
          <li key={key}>
            <button
              type="button"
              disabled={!done}
              onClick={() => onStep(i as Step)}
              aria-current={current ? "step" : undefined}
              className="group flex min-h-11 w-full flex-col gap-1.5 text-left disabled:cursor-default"
            >
              <span className={cn("h-1 w-full rounded-full bg-border", (done || current) && "bg-primary")} />
              <span className={cn("text-xs font-medium text-muted-foreground", current && "text-foreground", done && "group-hover:text-foreground")}>
                {t("leases.wizard.stepN", { n: i + 1 })} · {t(`leases.wizard.${key}`)}
              </span>
            </button>
          </li>
        );
      })}
    </ol>
  );
}

function SelectedSummary({ property, tenant }: { property: Property | null; tenant: Tenant | null }) {
  const { t } = useTranslation();
  return (
    <dl className="mb-5 grid gap-3 rounded-lg bg-muted p-3 text-sm sm:grid-cols-2">
      <div>
        <dt className="text-xs text-muted-foreground">{t("leases.fields.property")}</dt>
        <dd className="mt-0.5 font-medium">{property?.name}</dd>
      </div>
      <div>
        <dt className="text-xs text-muted-foreground">{t("leases.fields.tenant")}</dt>
        <dd className="mt-0.5 font-medium">{tenant?.full_name}</dd>
      </div>
    </dl>
  );
}

export function LeaseWizardPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [step, setStep] = useState<Step>(0);
  const [property, setProperty] = useState<Property | null>(null);

  // со страницы объекта приходим с ?property=<id>: объект уже выбран, начинаем с арендатора
  const [searchParams] = useSearchParams();
  const presetId = Number(searchParams.get("property")) || undefined;
  const preset = propertiesApi.useOne(presetId);
  const [presetApplied, setPresetApplied] = useState(false);
  if (preset.data && !presetApplied) {
    setPresetApplied(true);
    setProperty(preset.data);
    setStep(1);
  }
  const [tenant, setTenant] = useState<Tenant | null>(null);
  // со страницы арендаторов приходим с ?tenant=<id>: арендатор уже выбран, остаётся объект
  const presetTenantId = Number(searchParams.get("tenant")) || undefined;
  const presetTenant = tenantsApi.useOne(presetTenantId);
  const [presetTenantApplied, setPresetTenantApplied] = useState(false);
  if (presetTenant.data && !presetTenantApplied) {
    setPresetTenantApplied(true);
    setTenant(presetTenant.data);
  }
  const [propertySearch, setPropertySearch] = useState("");
  const [tenantSearch, setTenantSearch] = useState("");
  const [propertyPage, setPropertyPage] = useState(1);
  const [tenantPage, setTenantPage] = useState(1);
  const [newProperty, setNewProperty] = useState(false);
  const [newTenant, setNewTenant] = useState(false);

  const properties = propertiesApi.useList({ page: propertyPage, search: propertySearch });
  const tenants = tenantsApi.useList({ page: tenantPage, search: tenantSearch }, { enabled: step >= 1 });
  const create = leasesApi.useCreate();
  const uploadMedia = useUploadLeaseMedia();
  const [mediaFiles, setMediaFiles] = useState<File[]>([]);

  const occupied = useOccupiedPropertyIds();
  const propertyBusy = (p: Property) =>
    p.is_under_repair ? t("properties.state.repair") : occupied.ids.has(p.id) ? t("properties.state.occupied") : null;

  const submitTerms = async (terms: LeaseTerms) => {
    if (!property || !tenant) return null;
    try {
      const lease = await create.mutateAsync({ ...terms, property: property.id, tenant: tenant.id });
      toast.success(t("leases.created"));
      // фото/видео состояния квартиры: сбой одного файла не отменяет договор
      let failed = 0;
      for (const file of mediaFiles) {
        try {
          await uploadMedia.mutateAsync({ leaseId: lease.id, file });
        } catch {
          failed += 1;
        }
      }
      if (failed) toast.error(t("media.someFailed", { count: failed }));
      navigate(`/leases/${lease.id}`, { replace: true, state: { invite: true } });
      return null;
    } catch (error) {
      // ошибки по объекту/арендатору (с прошлых шагов) форма покажет над полями
      return error;
    }
  };

  const back = (
    <Button asChild variant="ghost" size="sm" className="-ml-3">
      <Link to={preset.data ? `/properties/${preset.data.id}` : "/leases"}>
        <ArrowLeft aria-hidden />
        {preset.data ? preset.data.name : t("leases.title")}
      </Link>
    </Button>
  );

  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader title={t("leases.createTitle")} back={back} />
      <Stepper step={step} onStep={setStep} />

      <Card>
        <CardContent>
          {step === 0 && (
            <section aria-labelledby="step-title" className="space-y-4">
              <div className="flex items-center justify-between gap-3">
                <h2 id="step-title" className="text-[15px] font-semibold">{t("leases.wizard.pickProperty")}</h2>
                <Button variant="ghost" size="sm" onClick={() => setNewProperty(true)}>
                  <Plus aria-hidden />
                  {t("common.new")}
                </Button>
              </div>
              <SearchInput value={propertySearch} onChange={(v) => { setPropertySearch(v); setPropertyPage(1); }} placeholder={t("properties.searchPlaceholder")} />
              <PickList
                query={properties}
                label={t("leases.wizard.pickProperty")}
                selectedId={property?.id ?? null}
                onSelect={setProperty}
                disabledReason={propertyBusy}
                page={propertyPage}
                onPageChange={setPropertyPage}
                render={(p) => (
                  <span className="flex items-center gap-3">
                    <KindIcon kind={p.kind} className="size-9" />
                    <span className="min-w-0">
                      <span className="block font-medium">{p.name}</span>
                      <span className="block truncate text-sm text-muted-foreground">{p.address}</span>
                    </span>
                  </span>
                )}
                empty={
                  propertySearch ? (
                    <EmptyState illustration="search" title={t("common.nothingFound")} className="py-8" />
                  ) : (
                    <EmptyState illustration="home" title={t("properties.emptyTitle")} className="py-8" />
                  )
                }
              />
            </section>
          )}

          {step === 1 && (
            <section aria-labelledby="step-title" className="space-y-4">
              <div className="flex items-center justify-between gap-3">
                <h2 id="step-title" className="text-[15px] font-semibold">{t("leases.wizard.pickTenant")}</h2>
                <Button variant="ghost" size="sm" onClick={() => setNewTenant(true)}>
                  <Plus aria-hidden />
                  {t("common.new")}
                </Button>
              </div>
              <SearchInput value={tenantSearch} onChange={(v) => { setTenantSearch(v); setTenantPage(1); }} placeholder={t("tenants.searchPlaceholder")} />
              <PickList
                query={tenants}
                label={t("leases.wizard.pickTenant")}
                selectedId={tenant?.id ?? null}
                onSelect={setTenant}
                page={tenantPage}
                onPageChange={setTenantPage}
                render={(tn) => (
                  <span className="flex items-center gap-3">
                    <Avatar name={tn.full_name} />
                    <span className="min-w-0">
                      <span className="block font-medium">{tn.full_name}</span>
                      <span className="block text-sm text-muted-foreground tabular">{tn.phone}</span>
                    </span>
                  </span>
                )}
                empty={
                  <EmptyState
                    illustration={tenantSearch ? "search" : "people"}
                    title={tenantSearch ? t("common.nothingFound") : t("tenants.emptyTitle")}
                    className="py-8"
                    action={
                      <Button variant="secondary" onClick={() => setNewTenant(true)}>
                        <Plus aria-hidden />
                        {t("tenants.create")}
                      </Button>
                    }
                  />
                }
              />
            </section>
          )}

          {step === 2 && (
            <section aria-labelledby="step-title">
              <h2 id="step-title" className="mb-4 text-[15px] font-semibold">{t("leases.wizard.terms")}</h2>
              <SelectedSummary property={property} tenant={tenant} />
              <LeaseTermsForm formId="lease-terms" onSubmit={submitTerms} />
              <MediaPicker files={mediaFiles} onChange={setMediaFiles} disabled={create.isPending || uploadMedia.isPending} />
            </section>
          )}
        </CardContent>

        <footer className="flex items-center justify-between gap-2 border-t border-border px-4 py-3 sm:px-5">
          <Button variant="secondary" onClick={() => setStep((s) => (s - 1) as Step)} disabled={step === 0 || create.isPending}>
            <ArrowLeft aria-hidden />
            {t("common.back")}
          </Button>
          {step < 2 ? (
            <Button
              // арендатор уже выбран заранее — со шага объекта сразу к условиям
              onClick={() => setStep((s) => (s === 0 && presetTenantApplied && tenant ? 2 : s + 1) as Step)}
              disabled={step === 0 ? !property : !tenant}
            >
              {t("common.next")}
              <ArrowRight aria-hidden />
            </Button>
          ) : (
            <Button type="submit" form="lease-terms" loading={create.isPending || uploadMedia.isPending}>
              {t("leases.createAction")}
            </Button>
          )}
        </footer>
      </Card>

      {property && step === 0 && (
        <p className="mt-3 flex items-center gap-2 text-sm text-muted-foreground" aria-live="polite">
          {t("leases.wizard.chosen")}: <span className="font-medium text-foreground">{property.name}</span>
          <PropertyStatusBadge isUnderRepair={property.is_under_repair} occupied={occupied.ids.has(property.id)} />
        </p>
      )}

      <PropertyFormDialog
        open={newProperty}
        onOpenChange={setNewProperty}
        property={null}
        onSaved={(p) => setProperty(p)}
      />
      <TenantFormDialog
        open={newTenant}
        onOpenChange={setNewTenant}
        tenant={null}
        onSaved={(tn) => setTenant(tn)}
      />
    </div>
  );
}
