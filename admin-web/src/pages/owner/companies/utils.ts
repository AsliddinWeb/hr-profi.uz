import type { Company, CompanyPlan } from "@/lib/types";

export const PLAN_OPTS: CompanyPlan[] = ["FREE", "PRO", "ENTERPRISE"];

export const PLAN_TONE: Record<
  CompanyPlan,
  { ring: string; bg: string; text: string }
> = {
  FREE: {
    ring: "ring-slate-200",
    bg: "bg-slate-100",
    text: "text-slate-700",
  },
  PRO: {
    ring: "ring-brand-200",
    bg: "bg-brand-50",
    text: "text-brand-700",
  },
  ENTERPRISE: {
    ring: "ring-amber-200",
    bg: "bg-gradient-to-r from-amber-50 to-yellow-50",
    text: "text-amber-700",
  },
};

export interface CompanyFormState {
  name: string;
  slug: string;
  logo_url: string;
  country: string;
  timezone: string;
  currency: string;
  language_default: "uz" | "ru" | "en";
  plan: CompanyPlan;
  subscription_until: string;
  is_active: boolean;
  // Admin fields — only for create flow
  admin_username: string;
  admin_email: string;
  admin_password: string;
  admin_full_name: string;
}

export const emptyCompanyForm: CompanyFormState = {
  name: "",
  slug: "",
  logo_url: "",
  country: "UZ",
  timezone: "Asia/Tashkent",
  currency: "UZS",
  language_default: "uz",
  plan: "FREE",
  subscription_until: "",
  is_active: true,
  admin_username: "",
  admin_email: "",
  admin_password: "",
  admin_full_name: "",
};

export function fromCompany(c: Company): CompanyFormState {
  return {
    name: c.name,
    slug: c.slug,
    logo_url: c.logo_url ?? "",
    country: c.country,
    timezone: c.timezone,
    currency: c.currency,
    language_default: c.language_default,
    plan: c.plan,
    subscription_until: c.subscription_until
      ? c.subscription_until.slice(0, 10)
      : "",
    is_active: true,  // suspension is a separate action
    admin_username: "",
    admin_email: "",
    admin_password: "",
    admin_full_name: "",
  };
}

export const TIMEZONES = [
  "Asia/Tashkent",
  "Asia/Almaty",
  "Asia/Bishkek",
  "Asia/Dushanbe",
  "Asia/Ashgabat",
  "Europe/Moscow",
  "UTC",
];
export const CURRENCIES = ["UZS", "USD", "RUB", "EUR", "KZT"];
