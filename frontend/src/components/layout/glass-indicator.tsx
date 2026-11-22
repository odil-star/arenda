/**
 * Скользящая «таблетка» под активной вкладкой стеклянной навигации.
 * Один элемент переезжает между вкладками с лёгким пружинным «перелётом» (как в Instagram / YouTube);
 * если её удерживать и вести пальцем (`dragging`), она следует за пальцем и слегка «приподнимается».
 * Родитель должен быть `relative`, а вкладки — равными колонками сетки с отступом p-1.5.
 * `index` может быть дробным (во время перетаскивания); отрицательный — подсветка скрыта.
 */
export function GlassIndicator({
  index,
  count,
  dragging = false,
  className,
}: {
  index: number;
  count: number;
  dragging?: boolean;
  className?: string;
}) {
  return (
    <span
      aria-hidden
      className={`pointer-events-none absolute inset-y-1.5 left-1.5 liquid-pill motion-reduce:transition-none ${className ?? "rounded-full"} ${
        dragging
          ? "transition-[transform,opacity] duration-150 ease-out"
          : "transition-[transform,opacity] duration-500 ease-[cubic-bezier(0.34,1.45,0.64,1)]"
      }`}
      style={{
        width: `calc((100% - 0.75rem) / ${count})`,
        transform: `translateX(${Math.max(index, 0) * 100}%) scale(${dragging ? 1.1 : 1})`,
        opacity: index >= 0 ? 1 : 0,
      }}
    />
  );
}
