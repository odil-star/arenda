import type { SVGProps } from "react";

/*
 * Иконки нижней навигации: у каждой два состояния — контурное и залитое (активное).
 * Рисуем сами, потому что у lucide нет залитых вариантов, а заливка контурной иконки выглядит грязно.
 */
export interface TabIconProps extends SVGProps<SVGSVGElement> {
  solid?: boolean;
}

type Shape = { line: React.ReactNode; fill: React.ReactNode };

function make(shape: Shape) {
  return function TabIcon({ solid, ...props }: TabIconProps) {
    return (
      <svg
        viewBox="0 0 24 24"
        aria-hidden
        {...(solid
          ? { fill: "currentColor", fillRule: "evenodd" }
          : { fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round", strokeLinejoin: "round" })}
        {...props}
      >
        {solid ? shape.fill : shape.line}
      </svg>
    );
  };
}

export const HomeIcon = make({
  line: <path d="M3.5 10.6 12 3.5l8.5 7.1V19a1.5 1.5 0 0 1-1.5 1.5h-3.6v-5.2a1 1 0 0 0-1-1h-4.8a1 1 0 0 0-1 1v5.2H5A1.5 1.5 0 0 1 3.5 19z" />,
  fill: <path d="M11.4 2.6a1 1 0 0 1 1.2 0l8.5 7.1c.3.3.5.7.5 1.1V19a2.5 2.5 0 0 1-2.5 2.5h-3.6a.5.5 0 0 1-.5-.5v-5.7a.5.5 0 0 0-.5-.5h-5a.5.5 0 0 0-.5.5V21a.5.5 0 0 1-.5.5H5A2.5 2.5 0 0 1 2.5 19v-8.2c0-.4.2-.8.5-1.1z" />,
});

export const BuildingIcon = make({
  line: (
    <>
      <path d="M6.5 21V5A2 2 0 0 1 8.5 3h7a2 2 0 0 1 2 2v16" />
      <path d="M3.5 21h17M9.5 7.5h1M13.5 7.5h1M9.5 11.5h1M13.5 11.5h1M10 21v-4h4v4" />
    </>
  ),
  fill: (
    <path d="M8.5 2.5a2.5 2.5 0 0 0-2.5 2.5v15.5H3.5a1 1 0 1 0 0 2h17a1 1 0 1 0 0-2H18V5a2.5 2.5 0 0 0-2.5-2.5zM9 7h1.5v1.5H9zm4.5 0H15v1.5h-1.5zM9 11h1.5v1.5H9zm4.5 0H15v1.5h-1.5zM10 20.5V17h4v3.5z" />
  ),
});

export const WalletIcon = make({
  line: (
    <>
      <path d="M17.5 8V6.5A1.5 1.5 0 0 0 16 5H6a2.5 2.5 0 0 0 0 5h12.5a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2H6a2.5 2.5 0 0 1-2.5-2.5V7.5" />
      <circle cx="16.5" cy="15" r="1" fill="currentColor" />
    </>
  ),
  fill: (
    <path d="M6 3.5h10A2.5 2.5 0 0 1 18.5 6v1.2h.2A2.8 2.8 0 0 1 21.5 10v8.2a2.8 2.8 0 0 1-2.8 2.8H6A3 3 0 0 1 3 18V7.5A4 4 0 0 1 6 3.5zm0 2.2a1.4 1.4 0 0 0 0 2.8h10.3V6a.3.3 0 0 0-.3-.3zM16.5 13.8a1.3 1.3 0 1 0 0 2.6 1.3 1.3 0 0 0 0-2.6z" />
  ),
});

export const PeopleIcon = make({
  line: (
    <>
      <circle cx="9" cy="8" r="3.5" />
      <path d="M2.5 20c.4-3.3 3-5.5 6.5-5.5s6.1 2.2 6.5 5.5" />
      <path d="M15.5 4.7a3.3 3.3 0 0 1 0 6.1M18 14.8c2 .6 3.3 2.2 3.5 5.2" />
    </>
  ),
  fill: (
    <>
      <circle cx="9" cy="8" r="4" />
      <path d="M9 14c-3.9 0-6.9 2.3-7.4 6.1-.1.8.5 1.4 1.3 1.4h12.2c.8 0 1.4-.6 1.3-1.4C16 16.3 12.9 14 9 14z" />
      <circle cx="17.5" cy="8.7" r="2.8" />
      <path d="M17 14.1c2.6.2 4.4 1.9 4.8 5.1.1.7-.4 1.3-1.2 1.3h-3.4c.3-2.1.2-4.5-.2-6.4z" />
    </>
  ),
});

export const DocIcon = make({
  line: (
    <>
      <path d="M6.5 3h7.5l5 5v11a2 2 0 0 1-2 2h-10.5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z" />
      <path d="M14 3v5h5M8.5 13h7M8.5 17h4.5" />
    </>
  ),
  fill: (
    <path d="M6.5 2.5A2.5 2.5 0 0 0 4 5v14a2.5 2.5 0 0 0 2.5 2.5h11A2.5 2.5 0 0 0 20 19V8.8a1 1 0 0 0-.3-.7l-4.8-5.3a1 1 0 0 0-.7-.3zM14 3.9 18.6 9H15a1 1 0 0 1-1-1zM8 12.2h8v1.6H8zm0 4h5v1.6H8z" />
  ),
});

export const UserIcon = make({
  line: (
    <>
      <circle cx="12" cy="8" r="4" />
      <path d="M4.5 20.5c.5-3.6 3.5-5.5 7.5-5.5s7 1.9 7.5 5.5z" />
    </>
  ),
  fill: (
    <>
      <circle cx="12" cy="8" r="4.5" />
      <path d="M12 14.5c-4 0-7.2 2-7.9 6a1 1 0 0 0 1 1.2h13.8a1 1 0 0 0 1-1.2c-.7-4-3.9-6-7.9-6z" />
    </>
  ),
});
