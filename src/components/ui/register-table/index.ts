export {
  RegisterTable,
  type RegisterTableColumn,
  type RegisterTableProps,
} from "./register-table";
export {
  TableNumber,
  TablePrimary,
  TableMeta,
  TableMono,
} from "./register-table-cells";
// Tag is part of the register row anatomy (status/earth-tone cells) — re-export
// so consumers pull the full row vocabulary from a single import.
export { Tag, type TagProps } from "../tag";
