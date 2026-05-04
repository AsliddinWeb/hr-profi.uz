import { useEnumLabel, type EnumKind } from "@/lib/enum";

interface Props {
  kind: EnumKind;
  value: string | null | undefined;
}

/**
 * Renders the localized label for a backend enum value (e.g. "FIXED" →
 * "Belgilangan"). The raw enum value is preserved on form ``<option>``
 * elements as ``value=`` so the API contract stays unchanged.
 */
export function EnumLabel({ kind, value }: Props) {
  const label = useEnumLabel();
  return <>{label(kind, value)}</>;
}
