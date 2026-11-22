import {
  AlertCircle,
  CheckCircle2,
  CircleDashed,
  CircleSlash,
  Clock,
  Hammer,
  KeyRound,
  DoorOpen,
  type LucideIcon,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import type { LeaseStatus, PaymentStatus } from "@/api/types";

type Visual = { tone: BadgeTone; icon: LucideIcon };

const paymentVisual: Record<PaymentStatus, Visual> = {
  paid: { tone: "success", icon: CheckCircle2 },
  pending: { tone: "info", icon: Clock },
  partial: { tone: "warning", icon: CircleDashed },
  overdue: { tone: "danger", icon: AlertCircle },
};

export function PaymentStatusBadge({ status }: { status: PaymentStatus }) {
  const { t } = useTranslation();
  const v = paymentVisual[status];
  return (
    <Badge tone={v.tone} icon={v.icon}>
      {t(`payments.status.${status}`)}
    </Badge>
  );
}

const leaseVisual: Record<LeaseStatus, Visual> = {
  active: { tone: "success", icon: CheckCircle2 },
  ended: { tone: "neutral", icon: CircleSlash },
};

export function LeaseStatusBadge({ status }: { status: LeaseStatus }) {
  const { t } = useTranslation();
  const v = leaseVisual[status];
  return (
    <Badge tone={v.tone} icon={v.icon}>
      {t(`leases.status.${status}`)}
    </Badge>
  );
}

export type PropertyState = "occupied" | "vacant" | "repair";

function propertyState(isUnderRepair: boolean, occupied: boolean): PropertyState {
  if (isUnderRepair) return "repair";
  return occupied ? "occupied" : "vacant";
}

const propertyVisual: Record<PropertyState, Visual> = {
  occupied: { tone: "info", icon: KeyRound },
  vacant: { tone: "success", icon: DoorOpen },
  repair: { tone: "warning", icon: Hammer },
};

interface PropertyStatusBadgeProps {
  isUnderRepair: boolean;
  /** Есть действующий договор (см. useOccupiedPropertyIds) */
  occupied: boolean;
}

export function PropertyStatusBadge({ isUnderRepair, occupied }: PropertyStatusBadgeProps) {
  const { t } = useTranslation();
  const state = propertyState(isUnderRepair, occupied);
  const v = propertyVisual[state];
  return (
    <Badge tone={v.tone} icon={v.icon}>
      {t(`properties.state.${state}`)}
    </Badge>
  );
}
