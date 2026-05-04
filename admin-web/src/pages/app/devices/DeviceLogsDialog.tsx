import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";

import { api } from "@/lib/api";
import { Badge } from "@/components/ui/Badge";
import { Dialog } from "@/components/ui/Dialog";
import { TBody, TD, TH, THead, TR, Table } from "@/components/ui/Table";
import type { Device, DeviceLog, Page } from "@/lib/types";

export function DeviceLogsDialog({
  device,
  onClose,
}: {
  device: Device;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const { data, isLoading } = useQuery({
    queryKey: ["devices", device.id, "logs"],
    queryFn: async () =>
      (
        await api.get<Page<DeviceLog>>(`/devices/${device.id}/logs`, {
          params: { size: 50 },
        })
      ).data,
  });

  return (
    <Dialog
      open
      onClose={onClose}
      title={`${device.name} — ${t("devices.events")}`}
      className="max-w-3xl"
    >
      {isLoading ? (
        <p className="text-sm text-slate-500">{t("common.loading")}</p>
      ) : (data?.items?.length ?? 0) === 0 ? (
        <p className="text-sm text-slate-500">{t("common.no_data")}</p>
      ) : (
        <div className="max-h-[60vh] overflow-y-auto">
          <Table>
            <THead>
              <TR>
                <TH>{t("devices.log_event")}</TH>
                <TH>{t("devices.log_status")}</TH>
                <TH>{t("devices.log_when")}</TH>
                <TH>{t("devices.log_details")}</TH>
              </TR>
            </THead>
            <TBody>
              {data?.items.map((l) => (
                <TR key={l.id}>
                  <TD className="font-medium">{l.event_type}</TD>
                  <TD>
                    <Badge tone={l.success ? "success" : "danger"}>
                      {l.success
                        ? t("devices.log_ok_short")
                        : t("devices.log_err_short")}
                    </Badge>
                  </TD>
                  <TD className="text-xs text-slate-500">
                    {new Date(l.received_at).toLocaleString()}
                  </TD>
                  <TD className="text-xs text-slate-600">
                    {l.error || (l.payload ? "payload" : "—")}
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </div>
      )}
    </Dialog>
  );
}
