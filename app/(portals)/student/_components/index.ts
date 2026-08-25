// ============================================================================
// MODULE : Student Portal — Template UI (PRD §57)
// PURPOSE: One import path for the portal's own presentation components.
//
// WHY THESE ARE NOT IN components/ui
//   components/ui is shared by the university, faculty, parent and platform
//   consoles. These pieces exist to give the STUDENT portal the look the
//   reference designs specify, and nothing else should inherit that by
//   accident. Living under the route group keeps the blast radius to this
//   portal; if the look is adopted product-wide, promoting them is a move.
//
// ALL SERVER COMPONENTS
//   Not one of them holds state or handles an event, so none carries
//   "use client". A dashboard built from these ships no JavaScript for its
//   own rendering.
// ============================================================================

export { ActivityRow, type ActivityRowProps } from "./ActivityRow";
export { DetailGrid, type DetailGridProps, type DetailItem } from "./DetailGrid";
export { MeterRow, type MeterRowProps } from "./MeterRow";
export { Panel, type PanelProps } from "./Panel";
export { ProgressRing, type ProgressRingProps } from "./ProgressRing";
export { StatTile, type StatTileProps, type StatTone } from "./StatTile";
export { StubPage, type StubPageProps } from "./StubPage";
