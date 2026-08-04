// components/ui/index.ts
//
// Barrel for the design system. Lets a page write one import for several
// primitives instead of one line each:
//
//   import { Button, Card, Table, Badge } from "@/components/ui"
//
// Types are re-exported alongside the components so a caller can annotate a
// variant or a column definition without a second import path.

export { Alert, type AlertProps, type AlertVariant } from "./Alert";
export { Avatar, type AvatarProps } from "./Avatar";
export { Badge, type BadgeProps, type BadgeVariant } from "./Badge";
export { Breadcrumb, type BreadcrumbItem, type BreadcrumbProps } from "./Breadcrumb";
export { Button, type ButtonProps, type ButtonSize, type ButtonVariant } from "./Button";
export { Card, type CardProps } from "./Card";
export { Checkbox, type CheckboxProps } from "./Checkbox";
export { Drawer, type DrawerProps } from "./Drawer";
export { Input, type InputProps } from "./Input";
export { Modal, type ModalProps } from "./Modal";
export { Pagination, type PaginationProps } from "./Pagination";
export { SearchInput, type SearchInputProps } from "./SearchInput";
export { Select, type SelectOption, type SelectProps } from "./Select";
export { Skeleton, StatCardSkeleton, TableSkeleton, type SkeletonProps } from "./Skeleton";
export { Spinner, type SpinnerProps } from "./Spinner";
export { StatCard, type StatCardProps } from "./StatCard";
export { Switch, type SwitchProps } from "./Switch";
export { Table, type TableColumn, type TableProps } from "./Table";
export { Tabs, type TabItem, type TabsProps } from "./Tabs";
export { Textarea, type TextareaProps } from "./Textarea";
