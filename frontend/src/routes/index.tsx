import { createBrowserRouter, Navigate } from "react-router-dom";
import { AppShell } from "@/components/layout/app-shell";
import { AuthForm } from "@/features/auth/auth-form";
import { GuestOnly, LandlordOnly, RequireAdmin, RequireAuth, RequireRole } from "@/features/auth/guards";
import { RoleChoicePage } from "@/features/auth/role-choice-page";
import { PhoneLoginPage } from "@/features/auth/phone-login-page";
import { JoinPage } from "@/features/join/join-page";
import { NotFoundPage } from "./not-found-page";

/* Экраны грузятся отдельными чанками: Recharts нужен только дашборду. */
export const router = createBrowserRouter([
  { path: "/join/:token", element: <JoinPage /> },
  {
    path: "/listings",
    lazy: async () => ({ Component: (await import("@/features/listings/listings-page")).ListingsPage }),
  },
  {
    path: "/listings/:id",
    lazy: async () => ({ Component: (await import("@/features/listings/listing-page")).ListingPage }),
  },
  {
    element: <GuestOnly />,
    children: [
      { path: "/login", element: <RoleChoicePage /> },
      { path: "/login/owner", element: <AuthForm key="login" mode="login" /> },
      { path: "/register", element: <AuthForm key="register" mode="register" /> },
      { path: "/login/phone", element: <PhoneLoginPage /> },
    ],
  },
  {
    element: <RequireAuth />,
    children: [
      {
        element: <RequireRole role="tenant" />,
        children: [
          {
            path: "cabinet",
            lazy: async () => ({ Component: (await import("@/features/cabinet/cabinet-page")).CabinetPage }),
          },
          {
            path: "cabinet/leases/:leaseId",
            lazy: async () => ({ Component: (await import("@/features/cabinet/house-page")).HouseCabinetPage }),
          },
          {
            path: "cabinet/contracts/:leaseId",
            lazy: async () => ({ Component: (await import("@/features/cabinet/contract-page")).ContractCabinetPage }),
          },
          {
            path: "cabinet/contracts/:leaseId/media",
            lazy: async () => ({ Component: (await import("@/features/cabinet/contract-extra-pages")).MediaCabinetPage }),
          },
          {
            path: "cabinet/support",
            lazy: async () => ({ Component: (await import("@/features/support/support-page")).CabinetSupportPage }),
          },
          {
            path: "cabinet/pay/:paymentId",
            lazy: async () => ({ Component: (await import("@/features/cabinet/pay-page")).PayCabinetPage }),
          },
        ],
      },
      {
        element: <RequireRole role="landlord" />,
        children: [
      {
        element: <AppShell />,
        children: [
          {
            element: <LandlordOnly />,
            children: [
          {
            index: true,
            lazy: async () => ({ Component: (await import("@/features/dashboard/dashboard-page")).DashboardPage }),
          },
          {
            path: "properties",
            lazy: async () => ({ Component: (await import("@/features/properties/properties-page")).PropertiesPage }),
          },
          {
            path: "properties/:id",
            lazy: async () => ({ Component: (await import("@/features/properties/property-detail-page")).PropertyDetailPage }),
          },
          {
            path: "tenants",
            lazy: async () => ({ Component: (await import("@/features/tenants/tenants-page")).TenantsPage }),
          },
          {
            path: "leases",
            lazy: async () => ({ Component: (await import("@/features/leases/leases-page")).LeasesPage }),
          },
          {
            path: "leases/new",
            lazy: async () => ({ Component: (await import("@/features/leases/lease-wizard-page")).LeaseWizardPage }),
          },
          {
            path: "leases/:id",
            lazy: async () => ({ Component: (await import("@/features/leases/lease-detail-page")).LeaseDetailPage }),
          },
          {
            path: "ads",
            lazy: async () => ({ Component: (await import("@/features/listings/ads-page")).AdsPage }),
          },
          {
            path: "ads/new",
            lazy: async () => ({ Component: (await import("@/features/listings/ad-form-page")).AdFormPage }),
          },
          {
            path: "ads/:id",
            lazy: async () => ({ Component: (await import("@/features/listings/ad-form-page")).AdFormPage }),
          },
          {
            path: "requests",
            lazy: async () => ({ Component: (await import("@/features/requests/requests-page")).RequestsPage }),
          },
          {
            path: "receipts",
            lazy: async () => ({ Component: (await import("@/features/receipts/receipts-page")).ReceiptsPage }),
          },
          {
            path: "payments",
            lazy: async () => ({ Component: (await import("@/features/payments/payments-page")).PaymentsPage }),
          },
          {
            path: "support",
            lazy: async () => ({ Component: (await import("@/features/support/support-page")).SupportPage }),
          },
          {
            path: "profile",
            lazy: async () => ({ Component: (await import("@/features/profile/profile-page")).ProfilePage }),
          },
          { path: "dashboard", element: <Navigate to="/" replace /> },
            ],
          },
          {
            element: <RequireAdmin />,
            children: [
              {
                path: "admin",
                lazy: async () => ({ Component: (await import("@/features/admin/admin-page")).AdminPage }),
              },
              {
                path: "admin/:tab",
                lazy: async () => ({ Component: (await import("@/features/admin/admin-page")).AdminPage }),
              },
            ],
          },
          { path: "*", element: <NotFoundPage /> },
        ],
      },
        ],
      },
    ],
  },
]);
