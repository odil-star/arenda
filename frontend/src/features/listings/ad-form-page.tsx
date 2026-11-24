import { zodResolver } from "@hookform/resolvers/zod";
import { ArrowLeft, ImagePlus, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { Link, useNavigate, useParams } from "react-router-dom";
import { toast } from "sonner";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input, Textarea } from "@/components/ui/input";
import { MoneyInput } from "@/components/ui/money-input";
import { Select } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { FormAlert, FormField } from "@/components/common/form-field";
import { EmptyState, ErrorState } from "@/components/common/states";
import { applyServerErrors, errorKind, serverMessages } from "@/api/errors";
import { api } from "@/api/client";
import { propertiesApi, useMe } from "@/api/hooks";
import { AMENITIES, FURNITURE, PROPERTY_KINDS, RENOVATIONS, type Amenity, type Property, type PropertyInput } from "@/api/types";
import { LocationPicker } from "@/components/common/maps";
import { Lightbox } from "@/components/common/lightbox";
import { PropertyPhotos } from "@/features/properties/property-photos";
import { useKindOptions } from "@/features/properties/use-kind-options";
import { decimalString, integerString, optionalText, requiredText } from "@/lib/validation";

const schema = z.object({
  name: requiredText(200),
  address: requiredText(255),
  kind: z.enum(PROPERTY_KINDS),
  area_m2: decimalString({ required: false, positive: true }),
  rooms: integerString({ required: false, positive: true }),
  floor: integerString({ required: false }),
  floors_total: integerString({ required: false, positive: true }),
  renovation: z.string(),
  furniture: z.string(),
  amenities: z.array(z.string()),
  contact_phone: requiredText(32),
  has_telegram: z.boolean(),
  listing_price: integerString({ positive: true }),
  listing_description: optionalText(3000),
  is_listed: z.boolean(),
  latitude: z.string(),
  longitude: z.string(),
});
type Values = z.input<typeof schema>;
const FIELDS = ["name", "address", "kind", "area_m2", "rooms", "floor", "floors_total", "renovation", "furniture", "amenities", "contact_phone", "has_telegram", "listing_price", "listing_description", "is_listed", "latitude", "longitude"] as const;

const PHOTO_MAX = 5 * 1024 * 1024;
const MAX_NEW_PHOTOS = 20;

function toValues(p?: Property, accountPhone = ""): Values {
  return {
    name: p?.name ?? "",
    address: p?.address ?? "",
    kind: p?.kind ?? "apartment",
    area_m2: p?.area_m2 != null ? String(p.area_m2) : "",
    rooms: p?.rooms != null ? String(p.rooms) : "",
    floor: p?.floor != null ? String(p.floor) : "",
    floors_total: p?.floors_total != null ? String(p.floors_total) : "",
    renovation: p?.renovation ?? "",
    furniture: p?.furniture ?? "",
    amenities: p?.amenities ?? [],
    contact_phone: p?.contact_phone || accountPhone,
    has_telegram: p?.has_telegram ?? true,
    listing_price: p?.listing_price != null ? String(p.listing_price) : "",
    listing_description: p?.listing_description ?? "",
    is_listed: p?.is_listed ?? true,
    latitude: p?.latitude ?? "",
    longitude: p?.longitude ?? "",
  };
}

/** Фото, выбранные до сохранения: загружаются сразу после создания объекта. */
function PendingPhotos({ files, onChange }: { files: File[]; onChange: (files: File[]) => void }) {
  const { t } = useTranslation();
  const input = useRef<HTMLInputElement>(null);
  const [full, setFull] = useState<number | null>(null);
  const urls = useMemo(() => files.map((f) => URL.createObjectURL(f)), [files]);
  useEffect(() => () => urls.forEach((u) => URL.revokeObjectURL(u)), [urls]);

  const add = (picked: File[]) => {
    const ok: File[] = [];
    for (const f of picked) {
      if (!["image/jpeg", "image/png"].includes(f.type)) toast.error(t("listing.photos.badType", { name: f.name }));
      else if (f.size > PHOTO_MAX) toast.error(t("listing.photos.tooBig", { name: f.name }));
      else if (files.length + ok.length >= MAX_NEW_PHOTOS) break;
      else ok.push(f);
    }
    if (ok.length) onChange([...files, ...ok]);
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-3">
        <CardTitle>{t("listing.photos.title")}</CardTitle>
        <input
          ref={input}
          type="file"
          hidden
          multiple
          accept="image/jpeg,image/png"
          onChange={(e) => {
            const picked = Array.from(e.target.files ?? []);
            e.target.value = "";
            add(picked);
          }}
        />
        <Button type="button" variant="secondary" size="sm" onClick={() => input.current?.click()}>
          <ImagePlus aria-hidden />
          {t("listing.photos.add")}
        </Button>
      </CardHeader>
      <CardContent>
        {files.length === 0 ? (
          <button
            type="button"
            onClick={() => input.current?.click()}
            className="flex h-28 w-full items-center justify-center gap-2 rounded-lg border border-dashed border-border text-sm text-muted-foreground hover:bg-muted/60"
          >
            <ImagePlus className="size-4" aria-hidden />
            {t("listing.photos.empty")}
          </button>
        ) : (
          <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {files.map((f, i) => (
              <li key={`${f.name}-${f.size}-${i}`} className="relative aspect-[4/3] overflow-hidden rounded-lg border border-border bg-muted">
                <button type="button" onClick={() => setFull(i)} aria-label={t("listing.openFullscreen")} className="block size-full cursor-zoom-in">
                  <img src={urls[i]} alt={f.name} className="size-full object-cover" />
                </button>
                <Button
                  type="button"
                  size="icon"
                  variant="secondary"
                  className="absolute right-1.5 top-1.5 size-8 opacity-90"
                  aria-label={t("listing.photos.delete")}
                  onClick={() => onChange(files.filter((_, j) => j !== i))}
                >
                  <X aria-hidden />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
      <Lightbox urls={urls} index={full} onIndexChange={setFull} title={t("listing.photos.title")} />
    </Card>
  );
}

async function uploadPhotos(propertyId: number, files: File[]): Promise<number> {
  let failed = 0;
  for (const file of files) {
    const form = new FormData();
    form.append("file", file);
    form.append("kind", "photo");
    form.append("property", String(propertyId));
    try {
      await api.post("/documents/", form, { headers: { "Content-Type": "multipart/form-data" }, timeout: 120_000 });
    } catch {
      failed += 1;
    }
  }
  return failed;
}

/** Точка на карте: по ней объявление попадает на карту в поиске. */
function LocationCard({ form }: { form: ReturnType<typeof useForm<Values>> }) {
  const { t } = useTranslation();
  const lat = form.watch("latitude");
  const lng = form.watch("longitude");
  const point: [number, number] | null = lat && lng && Number.isFinite(+lat) && Number.isFinite(+lng) ? [+lat, +lng] : null;
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-3">
        <CardTitle>{t("listing.mapPoint.title")}</CardTitle>
        {point && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => {
              form.setValue("latitude", "", { shouldDirty: true });
              form.setValue("longitude", "", { shouldDirty: true });
            }}
          >
            {t("listing.mapPoint.clear")}
          </Button>
        )}
      </CardHeader>
      <CardContent className="space-y-2">
        <LocationPicker
          value={point}
          onChange={([a, b]) => {
            form.setValue("latitude", a.toFixed(6), { shouldDirty: true });
            form.setValue("longitude", b.toFixed(6), { shouldDirty: true });
          }}
          className="z-0 h-64 w-full overflow-hidden rounded-lg border border-border"
        />
        <p className="text-xs text-muted-foreground">{t(point ? "listing.mapPoint.set" : "listing.mapPoint.hint")}</p>
      </CardContent>
    </Card>
  );
}

/** Отдельная страница объявления: создание (/ads/new) и правка (/ads/:id). */
export function AdFormPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const idParam = useParams().id;
  const id = idParam ? Number(idParam) : undefined;
  const isEdit = id !== undefined;
  const property = propertiesApi.useOne(id);
  const create = propertiesApi.useCreate();
  const update = propertiesApi.useUpdate();
  const kindOptions = useKindOptions();
  const [formErrors, setFormErrors] = useState<string[]>([]);
  const [photos, setPhotos] = useState<File[]>([]);
  const [saving, setSaving] = useState(false);

  const me = useMe();
  const accountPhone = me.data?.phone ?? "";
  const form = useForm<Values>({ resolver: zodResolver(schema), defaultValues: toValues(undefined, accountPhone) });
  const { errors } = form.formState;
  const listed = form.watch("is_listed");

  const loaded = property.data;
  useEffect(() => {
    if (loaded) form.reset(toValues(loaded, accountPhone));
  }, [loaded, form, accountPhone]);

  // номер аккаунта подтягивается, когда профиль загрузился, если поле ещё пустое
  useEffect(() => {
    if (!isEdit && accountPhone && !form.getValues("contact_phone")) form.setValue("contact_phone", accountPhone);
  }, [isEdit, accountPhone, form]);

  const back = (
    <Button asChild variant="ghost" size="sm" className="-ml-3">
      <Link to="/ads">
        <ArrowLeft aria-hidden />
        {t("ads.title")}
      </Link>
    </Button>
  );

  const onSubmit = form.handleSubmit(async (values) => {
    setFormErrors([]);
    setSaving(true);
    const input: PropertyInput = {
      name: values.name,
      address: values.address,
      kind: values.kind,
      area_m2: values.area_m2 || null,
      rooms: values.rooms ? Number(values.rooms) : null,
      floor: values.floor ? Number(values.floor) : null,
      floors_total: values.floors_total ? Number(values.floors_total) : null,
      renovation: values.renovation as PropertyInput["renovation"],
      furniture: values.furniture as PropertyInput["furniture"],
      amenities: values.amenities as Amenity[],
      is_under_repair: loaded?.is_under_repair ?? false,
      notes: loaded?.notes ?? "",
      is_listed: values.is_listed,
      contact_phone: values.contact_phone,
      has_telegram: values.has_telegram,
      listing_price: values.listing_price ? Number(values.listing_price) : null,
      listing_description: values.listing_description,
      latitude: values.latitude && values.longitude ? values.latitude : null,
      longitude: values.latitude && values.longitude ? values.longitude : null,
    };
    try {
      const saved = isEdit ? await update.mutateAsync({ id, input }) : await create.mutateAsync(input);
      const failed = await uploadPhotos(saved.id, photos);
      if (failed > 0) toast.error(t("ads.photosFailed", { count: failed }));
      toast.success(t(isEdit ? "ads.saved" : "ads.created"));
      navigate(failed > 0 ? `/ads/${saved.id}` : "/ads", { replace: true });
    } catch (error) {
      const rest = applyServerErrors(error, form.setError, FIELDS);
      setFormErrors(rest.length ? rest : serverMessages(error));
    } finally {
      setSaving(false);
    }
  });

  if (isEdit && property.isPending) {
    return (
      <div role="status" aria-label={t("common.loading")} className="space-y-4">
        {back}
        <Skeleton className="h-96 rounded-xl" />
      </div>
    );
  }
  if (isEdit && property.isError) {
    return (
      <>
        {back}
        <Card className="mt-3">
          {errorKind(property.error) === "notFound" ? (
            <EmptyState illustration="lost" title={t("propertyHub.notFound")} />
          ) : (
            <ErrorState error={property.error} onRetry={() => void property.refetch()} retrying={property.isRefetching} />
          )}
        </Card>
      </>
    );
  }

  return (
    <form onSubmit={onSubmit} noValidate>
      <div className="mb-5 space-y-3 sm:mb-6">
        {back}
        <h1 className="text-[22px] font-semibold tracking-tight sm:text-[28px]">
          {t(isEdit ? "ads.editTitle" : "ads.newTitle")}
        </h1>
      </div>

      <div className="grid grid-cols-[minmax(0,1fr)] gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <Card>
          <CardContent className="space-y-4 pt-5">
            <FormAlert messages={formErrors} />
            <FormField label={t("properties.fields.name")} error={errors.name?.message}>
              {(p) => <Input {...p} placeholder={t("properties.fields.namePlaceholder")} {...form.register("name")} />}
            </FormField>
            <FormField label={t("properties.fields.address")} error={errors.address?.message}>
              {(p) => <Input {...p} autoComplete="street-address" {...form.register("address")} />}
            </FormField>
            <div className="grid grid-cols-2 gap-4">
              <FormField label={t("properties.fields.kind")} error={errors.kind?.message} className="col-span-2">
                {(p) => (
                  <Controller
                    control={form.control}
                    name="kind"
                    render={({ field }) => (
                      <Select {...p} ref={field.ref} value={field.value} onValueChange={field.onChange} onBlur={field.onBlur} options={kindOptions} />
                    )}
                  />
                )}
              </FormField>
              <FormField label={t("properties.fields.areaShort")} error={errors.area_m2?.message} optional>
                {(p) => <Input {...p} inputMode="decimal" className="tabular" {...form.register("area_m2")} />}
              </FormField>
              <FormField label={t("listing.fields.rooms")} error={errors.rooms?.message} optional>
                {(p) => <Input {...p} inputMode="numeric" className="tabular" {...form.register("rooms")} />}
              </FormField>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <FormField label={t("listing.fields.floor")} error={errors.floor?.message} optional>
                {(p) => <Input {...p} inputMode="numeric" className="tabular" {...form.register("floor")} />}
              </FormField>
              <FormField label={t("listing.fields.floorsTotal")} error={errors.floors_total?.message} optional>
                {(p) => <Input {...p} inputMode="numeric" className="tabular" {...form.register("floors_total")} />}
              </FormField>
              <FormField label={t("listing.fields.renovation")} error={errors.renovation?.message} optional>
                {(p) => (
                  <Controller
                    control={form.control}
                    name="renovation"
                    render={({ field }) => (
                      <Select {...p} ref={field.ref} value={field.value} onValueChange={field.onChange} onBlur={field.onBlur} placeholder={t("listing.fields.notSet")} options={RENOVATIONS.map((v) => ({ value: v, label: t(`listing.renovation.${v}`) }))} />
                    )}
                  />
                )}
              </FormField>
              <FormField label={t("listing.fields.furniture")} error={errors.furniture?.message} optional>
                {(p) => (
                  <Controller
                    control={form.control}
                    name="furniture"
                    render={({ field }) => (
                      <Select {...p} ref={field.ref} value={field.value} onValueChange={field.onChange} onBlur={field.onBlur} placeholder={t("listing.fields.notSet")} options={FURNITURE.map((v) => ({ value: v, label: t(`listing.furniture.${v}`) }))} />
                    )}
                  />
                )}
              </FormField>
            </div>
            <fieldset>
              <legend className="mb-2 text-sm font-medium">{t("listing.fields.amenities")}</legend>
              <Controller
                control={form.control}
                name="amenities"
                render={({ field }) => (
                  <div className="flex flex-wrap gap-2">
                    {AMENITIES.map((a) => {
                      const on = field.value.includes(a);
                      return (
                        <label
                          key={a}
                          className={`flex min-h-10 cursor-pointer items-center rounded-full border px-3.5 text-sm transition has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-ring ${on ? "border-primary bg-primary/10 font-medium text-primary" : "border-border text-muted-foreground hover:bg-muted/60"}`}
                        >
                          <input
                            type="checkbox"
                            className="sr-only"
                            checked={on}
                            onChange={() => field.onChange(on ? field.value.filter((x) => x !== a) : [...field.value, a])}
                          />
                          {t(`listing.amenity.${a}`)}
                        </label>
                      );
                    })}
                  </div>
                )}
              />
            </fieldset>
            <FormField label={t("listing.fields.phone")} error={errors.contact_phone?.message} hint={t("listing.fields.phoneHint")}>
              {(p) => <Input {...p} type="tel" autoComplete="tel" placeholder="+998 90 123 45 67" className="tabular" {...form.register("contact_phone")} />}
            </FormField>
            <label className="flex min-h-11 cursor-pointer items-start gap-3 rounded-lg border border-border p-3 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-ring">
              <input type="checkbox" className="mt-0.5 size-4 accent-[var(--primary)]" {...form.register("has_telegram")} />
              <span>
                <span className="block text-sm font-medium">{t("listing.fields.hasTelegram")}</span>
                <span className="block text-xs text-muted-foreground">{t("listing.fields.hasTelegramHint")}</span>
              </span>
            </label>
            <FormField label={t("listing.fields.price")} error={errors.listing_price?.message}>
              {(p) => <MoneyInput {...p} className="tabular" placeholder="4 000 000" {...form.register("listing_price")} />}
            </FormField>
            <FormField label={t("listing.fields.description")} error={errors.listing_description?.message} optional>
              {(p) => <Textarea {...p} rows={6} placeholder={t("listing.fields.descriptionPlaceholder")} {...form.register("listing_description")} />}
            </FormField>
            <label className="flex min-h-11 cursor-pointer items-start gap-3 rounded-lg border border-border p-3 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-ring">
              <input type="checkbox" className="mt-0.5 size-4 accent-[var(--primary)]" {...form.register("is_listed")} />
              <span>
                <span className="block text-sm font-medium">{t("listing.fields.isListed")}</span>
                <span className="block text-xs text-muted-foreground">
                  {listed ? t("listing.fields.isListedHint") : t("ads.hiddenHint")}
                </span>
              </span>
            </label>
          </CardContent>
        </Card>

        <div className="space-y-4">
          <LocationCard form={form} />
          {isEdit && id !== undefined ? <PropertyPhotos propertyId={id} isListed={listed} /> : <PendingPhotos files={photos} onChange={setPhotos} />}
        </div>
      </div>

      <div className="sticky bottom-24 z-30 mt-5 flex justify-end gap-2 rounded-2xl border border-border bg-background/95 p-3 shadow-lg backdrop-blur lg:bottom-0 lg:-mx-6 lg:rounded-none lg:border-x-0 lg:border-b-0 lg:px-6 lg:shadow-none">
        <Button type="button" variant="secondary" onClick={() => navigate("/ads")} disabled={saving}>
          {t("common.cancel")}
        </Button>
        <Button type="submit" loading={saving}>
          {t(isEdit ? "common.save" : "ads.publishNow")}
        </Button>
      </div>
    </form>
  );
}
