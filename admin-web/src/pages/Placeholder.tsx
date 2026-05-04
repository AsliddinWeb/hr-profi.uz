import { useTranslation } from "react-i18next";
import { Card, CardBody } from "@/components/ui/Card";

export function Placeholder({ titleKey }: { titleKey: string }) {
  const { t } = useTranslation();
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold tracking-tight">{t(titleKey)}</h1>
      <Card>
        <CardBody>
          <p className="text-sm text-slate-500">Phase 2/3 — comin&apos; soon.</p>
        </CardBody>
      </Card>
    </div>
  );
}
