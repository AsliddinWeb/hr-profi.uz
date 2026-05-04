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
  "Asia/Baku",
  "Europe/Moscow",
  "Europe/Istanbul",
  "Europe/Kiev",
  "UTC",
];
export const CURRENCIES = ["UZS", "USD", "RUB", "EUR", "KZT", "TRY", "AED"];

/** Common target countries — flag, ISO-3166 code, native name. Used as a
 * dropdown in the company form so OWNER doesn't have to memorise codes. */
export const COUNTRIES: { code: string; flag: string; name: string }[] = [
  { code: "UZ", flag: "🇺🇿", name: "O'zbekiston" },
  { code: "KZ", flag: "🇰🇿", name: "Қазақстан" },
  { code: "KG", flag: "🇰🇬", name: "Кыргызстан" },
  { code: "TJ", flag: "🇹🇯", name: "Тоҷикистон" },
  { code: "TM", flag: "🇹🇲", name: "Türkmenistan" },
  { code: "AZ", flag: "🇦🇿", name: "Azərbaycan" },
  { code: "RU", flag: "🇷🇺", name: "Россия" },
  { code: "UA", flag: "🇺🇦", name: "Україна" },
  { code: "TR", flag: "🇹🇷", name: "Türkiye" },
  { code: "AE", flag: "🇦🇪", name: "United Arab Emirates" },
  { code: "US", flag: "🇺🇸", name: "United States" },
  { code: "GB", flag: "🇬🇧", name: "United Kingdom" },
];
