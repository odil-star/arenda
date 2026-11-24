import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { useEffect, useRef } from "react";

/** Центр по умолчанию — Ташкент. */
const DEFAULT_CENTER: [number, number] = [41.3111, 69.2797];
const TILES = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
const ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a>';

function createMap(el: HTMLElement, center: [number, number], zoom: number) {
  const map = L.map(el, { center, zoom, scrollWheelZoom: false });
  L.tileLayer(TILES, { attribution: ATTRIBUTION, maxZoom: 19 }).addTo(map);
  return map;
}

const escapeHtml = (v: string) => v.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

export interface MapPoint {
  id: number;
  lat: number;
  lng: number;
  /** подпись на метке, например «3,5 млн» */
  label: string;
  title: string;
  address: string;
  price: string;
  href: string;
}

/** Карта выдачи: метки с ценой, по клику — всплывающая карточка со ссылкой на объявление. */
export function ListingsMap({ points, className }: { points: MapPoint[]; className?: string }) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const layer = useRef<L.LayerGroup | null>(null);

  useEffect(() => {
    if (!el.current) return;
    map.current = createMap(el.current, DEFAULT_CENTER, 11);
    layer.current = L.layerGroup().addTo(map.current);
    return () => {
      map.current?.remove();
      map.current = null;
    };
  }, []);

  useEffect(() => {
    const group = layer.current;
    const m = map.current;
    if (!group || !m) return;
    group.clearLayers();
    const bounds: L.LatLngTuple[] = [];
    for (const p of points) {
      const icon = L.divIcon({
        className: "",
        html: `<span class="map-pin">${escapeHtml(p.label)}</span>`,
        iconSize: [0, 0],
      });
      L.marker([p.lat, p.lng], { icon, title: p.title })
        .bindPopup(
          `<a class="map-popup" href="${p.href}"><strong>${escapeHtml(p.price)}</strong><br>${escapeHtml(p.title)}<br><small>${escapeHtml(p.address)}</small></a>`,
        )
        .addTo(group);
      bounds.push([p.lat, p.lng]);
    }
    if (bounds.length > 0) m.fitBounds(bounds, { padding: [40, 40], maxZoom: 15 });
  }, [points]);

  return <div ref={el} className={className} role="region" aria-label="map" />;
}

/** Выбор точки на карте для формы объявления: клик ставит метку. */
export function LocationPicker({
  value,
  onChange,
  className,
}: {
  value: [number, number] | null;
  onChange: (point: [number, number]) => void;
  className?: string;
}) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const marker = useRef<L.Marker | null>(null);
  const handler = useRef(onChange);
  handler.current = onChange;

  useEffect(() => {
    if (!el.current) return;
    const m = createMap(el.current, value ?? DEFAULT_CENTER, value ? 15 : 11);
    m.scrollWheelZoom.enable();
    m.on("click", (e: L.LeafletMouseEvent) => handler.current([+e.latlng.lat.toFixed(6), +e.latlng.lng.toFixed(6)]));
    map.current = m;
    return () => {
      m.remove();
      map.current = null;
      marker.current = null;
    };
    // карту создаём один раз; дальше только двигаем метку
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const m = map.current;
    if (!m) return;
    if (!value) {
      marker.current?.remove();
      marker.current = null;
      return;
    }
    if (marker.current) marker.current.setLatLng(value);
    else {
      const icon = L.divIcon({ className: "", html: '<span class="map-dot"></span>', iconSize: [0, 0] });
      marker.current = L.marker(value, { icon, draggable: true }).addTo(m);
      marker.current.on("dragend", () => {
        const p = marker.current!.getLatLng();
        handler.current([+p.lat.toFixed(6), +p.lng.toFixed(6)]);
      });
    }
    if (!m.getBounds().contains(value)) m.setView(value, Math.max(m.getZoom(), 14));
  }, [value]);

  return <div ref={el} className={className} />;
}
