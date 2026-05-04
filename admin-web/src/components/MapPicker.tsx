import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Crosshair, Loader2, MapPin, Search } from "lucide-react";

import { Button } from "@/components/ui/Button";
import { Dialog, DialogFooter } from "@/components/ui/Dialog";
import { Input } from "@/components/ui/Input";

// Tashkent — sane default for Uzbek-deployed companies. Picked once when the
// modal opens with no prior coordinates.
const DEFAULT_CENTER: [number, number] = [41.3111, 69.2406];
const DEFAULT_ZOOM = 12;

const SCRIPT_ID = "yandex-maps-jsapi";

declare global {
  interface Window {
    ymaps?: any;
  }
}

interface Coords {
  latitude: number;
  longitude: number;
}

interface Props {
  open: boolean;
  onClose: () => void;
  initial?: Coords | null;
  onPick: (c: Coords) => void;
}

function loadYandex(apiKey: string | undefined, lang: string): Promise<void> {
  if (typeof window === "undefined") return Promise.reject(new Error("no-window"));
  if (window.ymaps && typeof window.ymaps.ready === "function") {
    return new Promise((resolve) => window.ymaps!.ready(resolve));
  }
  return new Promise((resolve, reject) => {
    const existing = document.getElementById(SCRIPT_ID) as HTMLScriptElement | null;
    if (existing) {
      existing.addEventListener("load", () => window.ymaps?.ready(resolve));
      existing.addEventListener("error", () => reject(new Error("yandex-load-error")));
      return;
    }
    const langParam = lang === "ru" ? "ru_RU" : lang === "en" ? "en_US" : "uz_UZ";
    const apiKeyParam = apiKey ? `&apikey=${encodeURIComponent(apiKey)}` : "";
    const script = document.createElement("script");
    script.id = SCRIPT_ID;
    script.src = `https://api-maps.yandex.ru/2.1/?lang=${langParam}${apiKeyParam}`;
    script.async = true;
    script.onload = () => window.ymaps?.ready(resolve);
    script.onerror = () => reject(new Error("yandex-load-error"));
    document.head.appendChild(script);
  });
}

/** Modal wrapping a Yandex Maps instance for picking lat/lng.
 *
 * Click anywhere on the map to drop / move the marker; the address is
 * reverse-geocoded for visual confirmation. ``Confirm`` returns the picked
 * coordinates to the parent. */
export function MapPicker({ open, onClose, initial, onPick }: Props) {
  const { t, i18n } = useTranslation();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<any>(null);
  const placemarkRef = useRef<any>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [picked, setPicked] = useState<Coords | null>(initial ?? null);
  const [pickedAddress, setPickedAddress] = useState<string>("");
  const [searchQuery, setSearchQuery] = useState("");

  const apiKey = import.meta.env.VITE_YANDEX_MAPS_API_KEY;

  // Spin up / tear down the map whenever the modal opens/closes.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    setError(null);

    loadYandex(apiKey, i18n.language)
      .then(() => {
        if (cancelled || !containerRef.current) return;
        const center: [number, number] = initial
          ? [initial.latitude, initial.longitude]
          : DEFAULT_CENTER;

        const ymaps = window.ymaps!;
        // Wipe any stale instance from a prior open.
        if (mapRef.current) {
          mapRef.current.destroy();
          mapRef.current = null;
        }
        const map = new ymaps.Map(containerRef.current, {
          center,
          zoom: initial ? 16 : DEFAULT_ZOOM,
          controls: ["zoomControl", "geolocationControl", "fullscreenControl"],
        });
        mapRef.current = map;

        const placemark = new ymaps.Placemark(
          center,
          {},
          {
            preset: "islands#violetDotIconWithCaption",
            draggable: true,
          }
        );
        if (initial) map.geoObjects.add(placemark);
        placemarkRef.current = placemark;

        const reverseGeocode = (coords: [number, number]) => {
          ymaps
            .geocode(coords)
            .then((res: any) => {
              const first = res.geoObjects.get(0);
              if (first) setPickedAddress(first.getAddressLine());
            })
            .catch(() => setPickedAddress(""));
        };

        const setMarker = (coords: [number, number]) => {
          if (!map.geoObjects.indexOf(placemark) && map.geoObjects.indexOf(placemark) !== 0) {
            map.geoObjects.add(placemark);
          } else if (map.geoObjects.indexOf(placemark) === -1) {
            map.geoObjects.add(placemark);
          }
          placemark.geometry.setCoordinates(coords);
          setPicked({ latitude: coords[0], longitude: coords[1] });
          reverseGeocode(coords);
        };

        map.events.add("click", (e: any) => {
          const coords = e.get("coords") as [number, number];
          setMarker(coords);
        });
        placemark.events.add("dragend", () => {
          const coords = placemark.geometry.getCoordinates() as [number, number];
          setPicked({ latitude: coords[0], longitude: coords[1] });
          reverseGeocode(coords);
        });

        if (initial) {
          reverseGeocode([initial.latitude, initial.longitude]);
        }

        setLoading(false);
      })
      .catch((e) => {
        if (cancelled) return;
        setError(e?.message ?? "yandex-load-error");
        setLoading(false);
      });

    return () => {
      cancelled = true;
      if (mapRef.current) {
        try {
          mapRef.current.destroy();
        } catch {
          /* ignore: already destroyed */
        }
        mapRef.current = null;
      }
    };
  }, [open, apiKey, i18n.language, initial]);

  const search = () => {
    if (!searchQuery.trim() || !mapRef.current || !window.ymaps) return;
    window.ymaps
      .geocode(searchQuery, { results: 1 })
      .then((res: any) => {
        const first = res.geoObjects.get(0);
        if (!first) return;
        const coords = first.geometry.getCoordinates() as [number, number];
        mapRef.current!.setCenter(coords, 16);
        if (placemarkRef.current) {
          if (mapRef.current!.geoObjects.indexOf(placemarkRef.current) === -1) {
            mapRef.current!.geoObjects.add(placemarkRef.current);
          }
          placemarkRef.current.geometry.setCoordinates(coords);
        }
        setPicked({ latitude: coords[0], longitude: coords[1] });
        setPickedAddress(first.getAddressLine());
      })
      .catch(() => {});
  };

  const useCurrentLocation = () => {
    if (!navigator.geolocation || !mapRef.current) return;
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const coords: [number, number] = [pos.coords.latitude, pos.coords.longitude];
        mapRef.current!.setCenter(coords, 16);
        if (placemarkRef.current) {
          if (mapRef.current!.geoObjects.indexOf(placemarkRef.current) === -1) {
            mapRef.current!.geoObjects.add(placemarkRef.current);
          }
          placemarkRef.current.geometry.setCoordinates(coords);
        }
        setPicked({ latitude: coords[0], longitude: coords[1] });
        if (window.ymaps) {
          window.ymaps
            .geocode(coords)
            .then((res: any) => {
              const first = res.geoObjects.get(0);
              if (first) setPickedAddress(first.getAddressLine());
            })
            .catch(() => {});
        }
      },
      () => {},
      { enableHighAccuracy: true, timeout: 8000 }
    );
  };

  const confirm = () => {
    if (!picked) return;
    onPick(picked);
    onClose();
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={t("map_picker.title")}
      className="max-w-3xl"
    >
      <div className="space-y-3">
        <div className="flex flex-wrap items-end gap-2">
          <div className="flex-1 min-w-[220px]">
            <Input
              label={t("map_picker.search_label")}
              placeholder={t("map_picker.search_placeholder") ?? ""}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  search();
                }
              }}
              prefix={<Search className="size-4" />}
            />
          </div>
          <Button type="button" variant="secondary" onClick={search}>
            {t("map_picker.search")}
          </Button>
          <Button type="button" variant="secondary" onClick={useCurrentLocation}>
            <Crosshair className="size-4" />
            {t("map_picker.use_current")}
          </Button>
        </div>

        <div className="relative h-[420px] w-full overflow-hidden rounded-lg border border-slate-200 bg-slate-50">
          {loading && (
            <div className="absolute inset-0 z-10 flex items-center justify-center bg-white/70">
              <Loader2 className="size-6 animate-spin text-brand-600" />
            </div>
          )}
          {error && !loading && (
            <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 bg-white p-4 text-center">
              <p className="text-sm font-medium text-red-600">{t("map_picker.load_failed")}</p>
              {!apiKey && (
                <p className="max-w-md text-xs text-slate-500">
                  {t("map_picker.no_api_key")}
                </p>
              )}
            </div>
          )}
          <div ref={containerRef} className="h-full w-full" />
        </div>

        <div className="flex items-start gap-2 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
          <MapPin className="mt-0.5 size-4 shrink-0 text-brand-500" />
          {picked ? (
            <div className="flex-1 space-y-0.5">
              <div className="font-mono text-[11px] tabular-nums text-slate-700">
                {picked.latitude.toFixed(6)}, {picked.longitude.toFixed(6)}
              </div>
              {pickedAddress && <div className="text-slate-500">{pickedAddress}</div>}
            </div>
          ) : (
            <span className="text-slate-500">{t("map_picker.tap_to_pick")}</span>
          )}
        </div>
      </div>

      <DialogFooter>
        <Button type="button" variant="secondary" onClick={onClose}>
          {t("common.cancel")}
        </Button>
        <Button type="button" disabled={!picked} onClick={confirm}>
          {t("map_picker.confirm")}
        </Button>
      </DialogFooter>
    </Dialog>
  );
}
