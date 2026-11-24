/*
 * Типы сверены с backend/leasing/serializers.py и backend/users/serializers.py.
 * Суммы в API — целые сумы (IntegerField), площадь — DecimalField (строка).
 */

/** Сумма в сумах. Для DecimalField DRF отдаёт строку, поэтому допускаем и её. */
export type Money = number | string;
/** Дата в формате ISO: YYYY-MM-DD */
export type ISODate = string;
/** Дата-время ISO 8601 */
export type ISODateTime = string;

export interface Paginated<T> {
  count: number;
  next: string | null;
  previous: string | null;
  results: T[];
}

/** Ошибки API (core/exceptions.py): всегда {поле: [сообщения]}, общие — в detail / non_field_errors. */
export type ApiErrorBody = Record<string, string[] | string | undefined>;

export type Language = "ru" | "uz";

// ---------- Auth ----------
export interface Credentials {
  email: string;
  password: string;
}
export interface RegisterInput extends Credentials {
  first_name: string;
  last_name: string;
  phone: string;
}
export interface TokenPair {
  access: string;
  refresh: string;
}
export interface TokenRefreshResponse {
  access: string;
  refresh?: string;
}

/** GET /api/me/ */
export interface Me {
  id: number;
  email: string;
  first_name: string;
  last_name: string;
  phone: string;
  passport_data?: string;
  language: Language;
  telegram_linked: boolean;
  /** какие обучения пользователь уже прошёл до конца ("landlord" / "tenant") */
  tours_seen?: string[];
  /** суперпользователь: виден раздел «Админ» */
  is_admin?: boolean;
  /** admin — полный доступ, support — только просмотр, null/нет — обычный арендодатель */
  admin_role?: "admin" | "support" | null;
}

// ---------- Dashboard ----------
export interface Dashboard {
  properties: { total: number; occupied: number; vacant: number; under_repair: number };
  month: { expected: Money; received: Money };
  overdue: { count: number; amount: Money };
  upcoming_7_days: { count: number; amount: Money };
  leases_expiring_30_days: number;
  /** последние 12 месяцев, от старого к новому: "YYYY-MM" */
  months: { month: string; expected: Money; received: Money }[];
  prev_month: { expected: Money; received: Money };
  properties_income: { id: number; name: string; received: Money; overdue_count: number }[];
  /** худшие по дисциплине платежей: on_time из total за 12 месяцев */
  reliability: { id: number; name: string; total: number; on_time: number }[];
  vacant_properties: { id: number; name: string; days: number; is_listed: boolean }[];
  plan: { name: string; max_properties: number | null; used: number; paid_until: ISODate | null } | null;
}

// ---------- Properties ----------
export const PROPERTY_KINDS = ["apartment", "house", "commercial", "other"] as const;
export type PropertyKind = (typeof PROPERTY_KINDS)[number];

export const RENOVATIONS = ["none", "cosmetic", "euro", "designer"] as const;
export type Renovation = (typeof RENOVATIONS)[number];
export const FURNITURE = ["none", "partial", "full"] as const;
export type Furniture = (typeof FURNITURE)[number];
export const AMENITIES = ["fridge", "washer", "ac", "tv", "wifi", "oven", "microwave", "heating", "parking", "balcony"] as const;
export type Amenity = (typeof AMENITIES)[number];

export interface Property {
  id: number;
  name: string;
  address: string;
  kind: PropertyKind;
  area_m2: string | null;
  is_under_repair: boolean;
  notes: string;
  /** показывать в публичном поиске квартир (согласие владельца) */
  is_listed: boolean;
  listing_price: number | null;
  listing_description: string;
  rooms: number | null;
  /** телефон для связи в объявлении (пусто — номер аккаунта) */
  contact_phone: string;
  /** на номере есть Telegram — показываем гостям «Написать» */
  has_telegram: boolean;
  floor: number | null;
  floors_total: number | null;
  renovation: Renovation | "";
  furniture: Furniture | "";
  amenities: Amenity[];
  /** точка на карте (строки с 6 знаками) */
  latitude: string | null;
  longitude: string | null;
  created_at: ISODateTime;
  updated_at: ISODateTime;
}
export type PropertyInput = Pick<
  Property,
  "name" | "address" | "kind" | "area_m2" | "is_under_repair" | "notes" | "is_listed" | "listing_price" | "listing_description" | "rooms" | "contact_phone" | "has_telegram"
> &
  Partial<Pick<Property, "floor" | "floors_total" | "renovation" | "furniture" | "amenities" | "latitude" | "longitude">>;

export interface PropertyListParams {
  page?: number;
  page_size?: number;
  search?: string;
  kind?: PropertyKind;
  is_under_repair?: boolean;
}

// ---------- Tenants ----------
export interface Tenant {
  id: number;
  full_name: string;
  phone: string;
  passport: string;
  notes: string;
  language: Language;
  telegram_linked: boolean;
  created_at: ISODateTime;
  updated_at: ISODateTime;
}
export type TenantInput = Pick<Tenant, "full_name" | "phone" | "passport" | "notes" | "language">;

export interface TenantListParams {
  page?: number;
  page_size?: number;
  search?: string;
}

/** POST /properties/{id}/invite/ — ссылка-приглашение (токен виден только в этом ответе) */
export interface PropertyInvite {
  url: string;
  expires_at: ISODateTime;
  tenant: number;
}

/** POST /tenants/{id}/link-code/ — код, который арендатор отправляет боту */
export interface LinkCode {
  code: string;
  expires_at: ISODateTime;
}

// ---------- Leases ----------
export const LEASE_STATUSES = ["active", "ended"] as const;
export type LeaseStatus = (typeof LEASE_STATUSES)[number];

export interface Lease {
  id: number;
  property: number;
  property_name: string;
  tenant: number;
  tenant_name: string;
  start_date: ISODate;
  end_date: ISODate;
  rent_amount: number;
  deposit_amount: number;
  payment_day: number;
  status: LeaseStatus;
  notes: string;
  inventory: string;
  payment_details: string;
  created_at: ISODateTime;
  updated_at: ISODateTime;
}
export type LeaseInput = Pick<
  Lease,
  "property" | "tenant" | "start_date" | "end_date" | "rent_amount" | "deposit_amount" | "payment_day" | "notes" | "inventory" | "payment_details"
>;

export interface LeaseListParams {
  page?: number;
  page_size?: number;
  status?: LeaseStatus;
  property?: number;
  ordering?: "end_date" | "-end_date" | "start_date" | "-start_date";
}

// ---------- Payments ----------
export const PAYMENT_STATUSES = ["overdue", "partial", "pending", "paid"] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

export interface Payment {
  id: number;
  lease: number;
  property: number;
  property_name: string;
  tenant_name: string;
  due_date: ISODate;
  amount_due: number;
  amount_paid: number;
  remaining: number;
  status: PaymentStatus;
  paid_at: ISODateTime | null;
  note: string;
}

export interface PaymentListParams {
  page?: number;
  page_size?: number;
  status?: PaymentStatus;
  lease?: number;
  /** ISO-дата: срок оплаты не раньше */
  due_from?: string;
  /** ISO-дата: срок оплаты не позже */
  due_to?: string;
  ordering?: "due_date" | "-due_date";
}

export interface PayInput {
  amount: number;
}
